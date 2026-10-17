import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  In,
  IsNull,
  LessThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import {
  AssessmentAttempt,
  AssessmentQuestion,
  AssessmentResponse,
  AssessmentResult,
  AssessmentType,
  QuestionType,
  TalentQuestionHistory,
  VerifiedLevel,
} from '../../assessments/entities';
import {
  TalentProfile,
  TalentProfileStatus,
} from '../entities/talent-profile.entity';
import {
  FlagIntegrityEventDto,
  IntegrityEventType,
  IntegrityFlagResult,
} from './dto/integrity-event.dto';
import { SubmitSkillAssessmentDto } from './dto/skill-assessment.dto';
import { ErrorMessages, SuccessMessages } from '../../../shared';
import {
  SKILL_ASSESSMENT_MAX_ATTEMPTS,
  SKILL_ASSESSMENT_PASS_PERCENTAGE,
  INTEGRITY_VIOLATION_LIMIT,
  SKILL_ASSESSMENT_DURATION_MINUTES,
  SKILL_ASSESSMENT_SESSION_TIMEOUT_MS,
  SKILL_ASSESSMENT_SUBMIT_GRACE_SECONDS,
} from '../talent.constants';
import { meetsSkillQualityBenchmark } from './assessment-quality';
import {
  AssessmentAnswerBlock,
  textLengthBoundsForBlock,
} from './assessment-answer-blocks.constants';
import { GuidanceReportService } from '../../ai/guidance-report.service';
import { GuidanceReport } from '../../ai/ai.types';
import { BankExhaustedAlertService } from '../../mail/bank-exhausted-alert.service';
import { AiResourcesService } from '../../ai-resources/ai-resources.service';
import { CertificatesService } from '../certificates/certificates.service';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import { AssessmentWaitlistService } from './assessment-waitlist.service';
import { shuffleOptions } from './assessment-utils';
import { SkillGuidanceReportQueueService } from './skill-guidance-report-queue.service';

const SKILL_ASSESSMENT_MCQ_COUNT = 16;
const SKILL_PROBE_MCQ_COUNT = 2;
const SKILL_ASSESSMENT_TOTAL = 20;

type ProbeDirection = 'above' | 'below';

/** The bank has no unserved questions left to build a full session. */
class SkillBankExhaustedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'SkillBankExhaustedError';
  }
}

export interface SkillAssessmentQuestion {
  question_id: string;
  question_number: number;
  block: AssessmentAnswerBlock;
  question_type: QuestionType;
  question_text: string;
  options: string[] | null;
  min_length?: number;
  max_length?: number;
}

type SkillAssessmentSessionQuestion = SkillAssessmentQuestion & {
  correct_answer: string | null;
  is_probe?: boolean;
  probe_direction?: ProbeDirection;
};

type SkillAssessmentSessionPayload = {
  context?: {
    verified_level?: VerifiedLevel;
    attempt_number?: number;
  };
  questions?: SkillAssessmentSessionQuestion[];
};

export interface StartSkillAssessmentResult {
  status: string;
  message: string;
  session_id: string;
  attempt_number: number;
  verified_level: VerifiedLevel;
  expires_at: string | null;
  remaining_seconds: number | null;
  questions: SkillAssessmentQuestion[];
}

export interface SkillAssessmentSessionResult {
  status: string;
  message: string;
  attempt_id: string;
  session_id: string;
  attempt_number: number;
  started_at: string;
  verified_level: VerifiedLevel;
  expires_at: string | null;
  remaining_seconds: number | null;
  questions: SkillAssessmentQuestion[];
}

export interface SubmitSkillAssessmentResult {
  status: string;
  message: string;
  session_id: string;
  attempt_number: number;
  score: number;
  total: number;
  percentage: number;
  validated_level: VerifiedLevel | null;
  claimed_level: VerifiedLevel;
  downgraded: boolean;
  passed: boolean;
  failed: boolean;
  retake_available: boolean;
  max_attempts: number;
  attempts_used: number;
  guidance_report?: GuidanceReport;
  personalised_message?: string;
  /** Correct answers per competency, weakest first. */
  competency_breakdown: SkillCompetencyResult[];
}

export interface SkillCompetencyResult {
  competency: string;
  correct: number;
  total: number;
  percentage: number;
}

const LEVEL_ORDER: Record<VerifiedLevel, number> = {
  [VerifiedLevel.JUNIOR]: 0,
  [VerifiedLevel.MID]: 1,
  [VerifiedLevel.SENIOR]: 2,
  [VerifiedLevel.EXPERT]: 3,
};

function levelIsLower(a: VerifiedLevel, b: VerifiedLevel): boolean {
  return LEVEL_ORDER[a] < LEVEL_ORDER[b];
}

@Injectable()
export class SkillAssessmentService {
  private readonly logger = new Logger(SkillAssessmentService.name);

  constructor(
    @InjectRepository(TalentProfile)
    private readonly talentProfileRepo: Repository<TalentProfile>,

    @InjectRepository(AssessmentQuestion)
    private readonly questionRepo: Repository<AssessmentQuestion>,

    @InjectRepository(AssessmentAttempt)
    private readonly attemptRepo: Repository<AssessmentAttempt>,

    @InjectRepository(AssessmentResponse)
    private readonly responseRepo: Repository<AssessmentResponse>,

    @InjectRepository(AssessmentResult)
    private readonly resultRepo: Repository<AssessmentResult>,

    @InjectRepository(TalentQuestionHistory)
    private readonly historyRepo: Repository<TalentQuestionHistory>,

    private readonly guidanceReport: GuidanceReportService,
    private readonly bankExhaustedAlert: BankExhaustedAlertService,
    private readonly aiResourcesService: AiResourcesService,
    private readonly guidanceReportQueue: SkillGuidanceReportQueueService,
    private readonly assessmentWaitlist: AssessmentWaitlistService,
    private readonly certificates: CertificatesService,
    private readonly notificationDispatch: NotificationDispatchService,
  ) {}

  private async resolveSkillAttemptNumber(
    talentProfileId: string,
    attempt: AssessmentAttempt,
    payload: SkillAssessmentSessionPayload,
    manager?: EntityManager,
  ): Promise<number> {
    const fromPayload = payload.context?.attempt_number;
    if (
      typeof fromPayload === 'number' &&
      Number.isInteger(fromPayload) &&
      fromPayload >= 1
    ) {
      return fromPayload;
    }

    const attemptRepository = manager
      ? manager.getRepository(AssessmentAttempt)
      : this.attemptRepo;

    const ordinal = await attemptRepository.count({
      where: {
        talent_profile_id: talentProfileId,
        assessment_type: AssessmentType.SKILL,
        started_at: LessThanOrEqual(attempt.started_at),
      },
    });

    return Math.max(1, ordinal);
  }

  private countCompletedSkillAttempts(
    talentProfileId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const attemptRepository = manager
      ? manager.getRepository(AssessmentAttempt)
      : this.attemptRepo;

    return attemptRepository.count({
      where: {
        talent_profile_id: talentProfileId,
        assessment_type: AssessmentType.SKILL,
        completed_at: Not(IsNull()),
      },
    });
  }

  private async assertSkillAssessmentAttemptsRemaining(
    profile: TalentProfile,
    manager?: EntityManager,
  ): Promise<void> {
    if (profile.advanced_assessment_completed_at) {
      return;
    }

    const attemptRepository = manager
      ? manager.getRepository(AssessmentAttempt)
      : this.attemptRepo;

    const completedAttempts = await this.countCompletedSkillAttempts(
      profile.id,
      manager,
    );
    if (completedAttempts >= SKILL_ASSESSMENT_MAX_ATTEMPTS) {
      throw new ForbiddenException(
        this.buildSkillMaxAttemptsReachedResponse(completedAttempts),
      );
    }

    if (manager) {
      const activeAttempt = await attemptRepository.findOne({
        where: {
          talent_profile_id: profile.id,
          assessment_type: AssessmentType.SKILL,
          completed_at: IsNull(),
          force_submitted: false,
        },
      });

      if (activeAttempt) {
        const elapsed =
          Date.now() - new Date(activeAttempt.started_at).getTime();

        if (
          elapsed >= SKILL_ASSESSMENT_SESSION_TIMEOUT_MS ||
          this.isPastSubmitDeadline(activeAttempt)
        ) {
          // Session is stale — mark it as abandoned so it counts toward max attempts
          await attemptRepository.update(activeAttempt.id, {
            completed_at: new Date(),
            force_submitted: true,
          });

          // Recount after marking stale session — it now counts as completed
          const updatedCount = await this.countCompletedSkillAttempts(
            profile.id,
            manager,
          );
          if (updatedCount >= SKILL_ASSESSMENT_MAX_ATTEMPTS) {
            throw new ForbiddenException(
              this.buildSkillMaxAttemptsReachedResponse(updatedCount),
            );
          }
        } else {
          throw new ConflictException({
            error: 'CONFLICT',
            message: ErrorMessages.SKILL_ASSESSMENT.ACTIVE_SESSION_EXISTS,
            existing_session_id: activeAttempt.id,
          });
        }
      }
    }
  }

  private buildSkillMaxAttemptsReachedResponse(attemptsUsed: number): {
    error: 'SKILL_MAX_ATTEMPTS_REACHED';
    message: string;
    attempts_used: number;
    max_attempts: number;
    unlock_condition: 'complete_advanced_assessment';
  } {
    return {
      error: 'SKILL_MAX_ATTEMPTS_REACHED',
      message: ErrorMessages.SKILL_ASSESSMENT.MAX_ATTEMPTS_REACHED,
      attempts_used: attemptsUsed,
      max_attempts: SKILL_ASSESSMENT_MAX_ATTEMPTS,
      unlock_condition: 'complete_advanced_assessment',
    };
  }

  /**
   * Picks a full session from questions this talent has not been served yet.
   * Throws SkillBankExhaustedError when the bank cannot fill one. Read-only, so
   * it also backs the availability check and the waitlist notifier.
   */
  private async planFreshSession(
    manager: EntityManager,
    profile: TalentProfile,
    verifiedLevel: VerifiedLevel,
  ): Promise<{
    selectedQuestions: AssessmentQuestion[];
    aboveProbeQuestions: AssessmentQuestion[];
    belowProbeQuestions: AssessmentQuestion[];
  }> {
    const bankQuestions = await this.findEligibleSkillQuestions(
      manager,
      profile,
      verifiedLevel,
    );
    let selectedQuestions: AssessmentQuestion[];
    try {
      selectedQuestions = this.selectSkillQuestionMix(bankQuestions);
    } catch (err) {
      throw new SkillBankExhaustedError(
        err instanceof Error ? err.message : String(err),
      );
    }

    let aboveProbeQuestions: AssessmentQuestion[] = [];
    const aboveLevel = this.levelAbove(verifiedLevel);
    if (aboveLevel) {
      const aboveBank = await this.findEligibleSkillQuestions(
        manager,
        profile,
        aboveLevel,
      );
      aboveProbeQuestions = this.selectSkillProbeMix(aboveBank);
    }

    let belowProbeQuestions: AssessmentQuestion[] = [];
    const belowLevel = this.levelBelowForProbe(verifiedLevel);
    if (belowLevel) {
      const belowBank = await this.findEligibleSkillQuestions(
        manager,
        profile,
        belowLevel,
      );
      belowProbeQuestions = this.selectSkillProbeMix(belowBank);
    }

    const probeTotal = aboveProbeQuestions.length + belowProbeQuestions.length;
    const deficit =
      SKILL_ASSESSMENT_TOTAL - selectedQuestions.length - probeTotal;

    if (deficit > 0) {
      const usedIds = new Set(
        [
          ...selectedQuestions,
          ...aboveProbeQuestions,
          ...belowProbeQuestions,
        ].map((q) => q.id),
      );
      const extras = bankQuestions
        .filter((q) => !usedIds.has(q.id) && this.isPickQuestion(q))
        .slice(0, deficit);
      if (extras.length < deficit) {
        throw new SkillBankExhaustedError(
          `Could not fill ${deficit} deficit question(s) after probe selection`,
        );
      }
      selectedQuestions = [...selectedQuestions, ...extras];
    }

    return { selectedQuestions, aboveProbeQuestions, belowProbeQuestions };
  }

  /**
   * Whether a fresh session could be built for this talent right now. Used by
   * the retake gate and the waitlist notifier; never alerts or writes.
   */
  async hasFreshCapacity(profile: TalentProfile): Promise<boolean> {
    if (!profile.claimed_level || !profile.track) {
      return true; // other gates explain what is missing; not a capacity issue
    }
    try {
      await this.planFreshSession(
        this.talentProfileRepo.manager,
        profile,
        profile.claimed_level,
      );
      return true;
    } catch (err) {
      if (err instanceof SkillBankExhaustedError) {
        return false;
      }
      throw err;
    }
  }

  /** Lets the UI show "available soon" before the user clicks Start. */
  async getAvailability(
    userId: string,
  ): Promise<{ can_start: boolean; waitlisted: boolean }> {
    const profile = await this.talentProfileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      throw new NotFoundException(
        ErrorMessages.SKILL_ASSESSMENT.PROFILE_NOT_FOUND,
      );
    }
    const activeAttempt = await this.attemptRepo.findOne({
      where: {
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.SKILL,
        completed_at: IsNull(),
        force_submitted: false,
      },
    });
    const canStart =
      Boolean(activeAttempt) || (await this.hasFreshCapacity(profile));
    return {
      can_start: canStart,
      waitlisted:
        !canStart &&
        (await this.assessmentWaitlist.isWaitlisted(profile.id, 'skill')),
    };
  }

  /**
   * Called outside the transaction (which has rolled back): alerts the team,
   * waitlists the talent, and answers with a neutral message that never
   * mentions the bank.
   */
  private async handleBankExhausted(
    profile: TalentProfile,
    verifiedLevel: VerifiedLevel,
    err: SkillBankExhaustedError,
  ): Promise<never> {
    this.bankExhaustedAlert.notify({
      assessmentType: 'skill',
      detail: err.message,
      talentProfileId: profile.id,
      userId: profile.user_id,
      track: profile.track,
      verifiedLevel,
    });
    await this.assessmentWaitlist.join(profile, 'skill', verifiedLevel);
    throw new ServiceUnavailableException({
      error: 'ASSESSMENT_PREPARING',
      message: ErrorMessages.SKILL_ASSESSMENT.NO_QUESTIONS_AVAILABLE,
      waitlisted: true,
    });
  }

  async start(userId: string): Promise<StartSkillAssessmentResult> {
    const profile = await this.talentProfileRepo.findOne({
      where: { user_id: userId },
    });

    if (!profile) {
      throw new NotFoundException(
        ErrorMessages.SKILL_ASSESSMENT.PROFILE_NOT_FOUND,
      );
    }

    if (!profile.personal_assessment_completed_at) {
      throw new UnprocessableEntityException(
        ErrorMessages.SKILL_ASSESSMENT.PERSONAL_ASSESSMENT_INCOMPLETE,
      );
    }
    if (!profile.claimed_level) {
      throw new UnprocessableEntityException(
        ErrorMessages.SKILL_ASSESSMENT.CLAIMED_LEVEL_MISSING,
      );
    }
    if (!profile.track) {
      throw new UnprocessableEntityException(
        ErrorMessages.SKILL_ASSESSMENT.TRACK_MISSING,
      );
    }
    const verifiedLevel = profile.claimed_level;
    const { savedAttempt, orderedQuestions, attemptNumber } =
      await this.talentProfileRepo.manager
        .transaction(async (manager) => {
          const lockedProfile = await manager.findOne(TalentProfile, {
            where: { id: profile.id },
            lock: { mode: 'pessimistic_write' },
          });

          if (!lockedProfile) {
            throw new NotFoundException(
              ErrorMessages.SKILL_ASSESSMENT.PROFILE_NOT_FOUND,
            );
          }

          await this.assertSkillAssessmentAttemptsRemaining(
            lockedProfile,
            manager,
          );

          // Questions a talent has already been served are never offered again,
          // so a retake cannot repeat items. A bank too shallow for a fresh set
          // raises SkillBankExhaustedError, handled outside the transaction.
          const {
            selectedQuestions,
            aboveProbeQuestions,
            belowProbeQuestions,
          } = await this.planFreshSession(
            manager,
            lockedProfile,
            verifiedLevel,
          );

          const allSelected = [
            ...selectedQuestions,
            ...aboveProbeQuestions,
            ...belowProbeQuestions,
          ];
          const primaryCount = selectedQuestions.length;
          const aboveCount = aboveProbeQuestions.length;
          const orderedQuestions = allSelected.map((question, index) => {
            let is_probe = false;
            let probe_direction: ProbeDirection | undefined;
            if (index >= primaryCount) {
              is_probe = true;
              probe_direction =
                index < primaryCount + aboveCount ? 'above' : 'below';
            }
            return {
              question_id: question.id,
              question_number: index + 1,
              block: this.blockForQuestionType(question.question_type),
              question_type: question.question_type,
              question_text: question.question_text,
              options: shuffleOptions(question.options),
              correct_answer: question.correct_answer,
              is_probe,
              probe_direction,
            };
          });
          const completedAttempts = await this.countCompletedSkillAttempts(
            lockedProfile.id,
            manager,
          );
          const attemptNumber = completedAttempts + 1;
          const startedAt = new Date();
          const expiresAt = new Date(
            startedAt.getTime() + SKILL_ASSESSMENT_DURATION_MINUTES * 60 * 1000,
          );
          const attempt = await manager.save(
            AssessmentAttempt,
            manager.create(AssessmentAttempt, {
              talent_profile_id: lockedProfile.id,
              assessment_type: AssessmentType.SKILL,
              started_at: startedAt,
              completed_at: null,
              expires_at: expiresAt,
              generated_questions_json: {
                context: {
                  verified_level: verifiedLevel,
                  attempt_number: attemptNumber,
                },
                questions: orderedQuestions,
              },
            }),
          );

          // Questions can be re-served on a retake when the bank is small, so
          // re-link the existing history row instead of violating the unique key.
          await manager
            .createQueryBuilder()
            .insert()
            .into(TalentQuestionHistory)
            .values(
              allSelected.map((question) =>
                manager.create(TalentQuestionHistory, {
                  talent_profile_id: lockedProfile.id,
                  question_id: question.id,
                  attempt_id: attempt.id,
                  user_answer: { served: true },
                  is_correct: null,
                  raw_score: null,
                  max_score: null,
                  answered_at: startedAt,
                }),
              ),
            )
            .orUpdate(
              [
                'attempt_id',
                'user_answer',
                'is_correct',
                'raw_score',
                'max_score',
                'answered_at',
              ],
              ['talent_profile_id', 'question_id'],
            )
            .execute();

          return { savedAttempt: attempt, orderedQuestions, attemptNumber };
        })
        .catch((err: unknown) => {
          if (err instanceof SkillBankExhaustedError) {
            return this.handleBankExhausted(profile, verifiedLevel, err);
          }
          throw err;
        });

    this.logger.log(
      `Skill assessment started: attempt=${savedAttempt.id} attempt_number=${attemptNumber} user=${userId} track=${profile.track} level=${verifiedLevel}`,
    );

    return {
      status: 'success',
      message: SuccessMessages.SKILL_ASSESSMENT.STARTED,
      session_id: savedAttempt.id,
      attempt_number: attemptNumber,
      verified_level: verifiedLevel,
      ...this.timerFields(savedAttempt),
      questions: this.toPublicSessionQuestions(orderedQuestions),
    };
  }

  /** Sessions started before the limit existed have no expires_at and stay untimed. */
  private timerFields(attempt: AssessmentAttempt): {
    expires_at: string | null;
    remaining_seconds: number | null;
  } {
    if (!attempt.expires_at)
      return { expires_at: null, remaining_seconds: null };
    return {
      expires_at: attempt.expires_at.toISOString(),
      remaining_seconds: Math.max(
        0,
        Math.floor((attempt.expires_at.getTime() - Date.now()) / 1000),
      ),
    };
  }

  private isPastSubmitDeadline(attempt: AssessmentAttempt): boolean {
    if (!attempt.expires_at) return false;
    return (
      Date.now() >
      attempt.expires_at.getTime() +
        SKILL_ASSESSMENT_SUBMIT_GRACE_SECONDS * 1000
    );
  }

  async getSession(
    userId: string,
    sessionId: string,
  ): Promise<SkillAssessmentSessionResult> {
    const profile = await this.talentProfileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      throw new NotFoundException(
        ErrorMessages.SKILL_ASSESSMENT.PROFILE_NOT_FOUND,
      );
    }

    const attempt = await this.attemptRepo.findOne({
      where: {
        id: sessionId,
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.SKILL,
      },
    });
    if (!attempt) {
      throw new NotFoundException(
        ErrorMessages.SKILL_ASSESSMENT.ATTEMPT_NOT_FOUND,
      );
    }

    const payload = this.readSessionPayload(attempt);
    const questions = this.readSessionQuestions(attempt);
    if (questions.length === 0) {
      throw new BadRequestException(
        ErrorMessages.SKILL_ASSESSMENT.ATTEMPT_CORRUPT,
      );
    }

    const attemptNumber = await this.resolveSkillAttemptNumber(
      profile.id,
      attempt,
      payload,
    );

    return {
      status: 'success',
      message: SuccessMessages.SKILL_ASSESSMENT.SESSION_RESUMED,
      attempt_id: attempt.id,
      session_id: attempt.id,
      attempt_number: attemptNumber,
      started_at: attempt.started_at.toISOString(),
      verified_level:
        payload.context?.verified_level ??
        profile.claimed_level ??
        VerifiedLevel.JUNIOR,
      ...this.timerFields(attempt),
      questions: this.toPublicSessionQuestions(questions),
    };
  }

  async submit(
    userId: string,
    dto: SubmitSkillAssessmentDto,
  ): Promise<SubmitSkillAssessmentResult> {
    const profile = await this.talentProfileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      throw new NotFoundException(
        ErrorMessages.SKILL_ASSESSMENT.PROFILE_NOT_FOUND,
      );
    }

    const attempt = await this.attemptRepo.findOne({
      where: {
        id: dto.attemptId,
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.SKILL,
      },
    });
    if (!attempt) {
      throw new NotFoundException(
        ErrorMessages.SKILL_ASSESSMENT.ATTEMPT_NOT_FOUND,
      );
    }
    if (attempt.completed_at) {
      throw new BadRequestException(
        ErrorMessages.SKILL_ASSESSMENT.ATTEMPT_ALREADY_SUBMITTED,
      );
    }

    if (this.isPastSubmitDeadline(attempt)) {
      // Too late to score: the attempt is spent, same as an abandoned session.
      await this.attemptRepo.update(attempt.id, {
        completed_at: new Date(),
        force_submitted: true,
      });
      throw new BadRequestException({
        error: 'SKILL_TIME_EXPIRED',
        message: ErrorMessages.SKILL_ASSESSMENT.TIME_EXPIRED,
      });
    }

    const sessionQuestions = this.readSessionQuestions(attempt);
    if (sessionQuestions.length === 0) {
      throw new BadRequestException(
        ErrorMessages.SKILL_ASSESSMENT.ATTEMPT_CORRUPT,
      );
    }

    const questionEntities = await this.questionRepo.findBy({
      id: In(sessionQuestions.map((question) => question.question_id)),
    });
    const entityMap = new Map(
      questionEntities.map((question) => [question.id, question]),
    );
    const answerMap = new Map(
      dto.answers.map((answer) => [answer.questionId, answer]),
    );

    let primaryMcqCorrect = 0;
    let primaryMcqTotal = 0;
    let aboveProbeMcqCorrect = 0;
    let aboveProbeMcqTotal = 0;
    let belowProbeMcqCorrect = 0;
    let belowProbeMcqTotal = 0;
    const responsesToSave: Partial<AssessmentResponse>[] = [];
    const historyPatches = new Map<string, Partial<TalentQuestionHistory>>();
    const competencyTally = new Map<
      string,
      { correct: number; total: number }
    >();

    for (const question of sessionQuestions) {
      const submitted = answerMap.get(question.question_id);
      const entity = entityMap.get(question.question_id);

      if (question.is_probe) {
        if (question.probe_direction === 'below') {
          belowProbeMcqTotal++;
        } else {
          aboveProbeMcqTotal++;
        }
      } else {
        primaryMcqTotal++;
      }
      const isCorrect = this.scoreGeneratedMcq(
        question,
        submitted?.answer ?? null,
      );
      if (isCorrect) {
        if (question.is_probe) {
          if (question.probe_direction === 'below') {
            belowProbeMcqCorrect++;
          } else {
            aboveProbeMcqCorrect++;
          }
        } else {
          primaryMcqCorrect++;
        }
      }

      if (entity?.competency) {
        const tally = competencyTally.get(entity.competency) ?? {
          correct: 0,
          total: 0,
        };
        tally.total++;
        if (isCorrect) tally.correct++;
        competencyTally.set(entity.competency, tally);
      }

      responsesToSave.push({
        attempt_id: attempt.id,
        question_id: entity?.id ?? null,
        question_text: question.question_text,
        user_answer: submitted?.answer ?? null,
        is_correct: isCorrect,
        answered_at: new Date(),
      });

      if (entity) {
        historyPatches.set(question.question_id, {
          user_answer: submitted?.answer ?? null,
          is_correct: isCorrect,
          raw_score: isCorrect ? 1 : 0,
          max_score: 1,
          answered_at: new Date(),
        });
      }
    }

    const claimedPercentage = this.toPercentage(
      primaryMcqCorrect,
      primaryMcqTotal,
    );
    const aboveLevelPercentage = this.toPercentage(
      aboveProbeMcqCorrect,
      aboveProbeMcqTotal,
    );
    const belowLevelPercentage = this.toPercentage(
      belowProbeMcqCorrect,
      belowProbeMcqTotal,
    );

    const totalScore =
      primaryMcqCorrect + aboveProbeMcqCorrect + belowProbeMcqCorrect;
    const totalMaxScore =
      primaryMcqTotal + aboveProbeMcqTotal + belowProbeMcqTotal;
    const percentage = this.toPercentage(totalScore, totalMaxScore);
    const primaryMcqGatePassed = primaryMcqTotal === 0 || primaryMcqCorrect > 0;
    const aboveProbeMcqGatePassed =
      aboveProbeMcqTotal === 0 || aboveProbeMcqCorrect > 0;

    if (primaryMcqTotal === 0) {
      this.logger.warn(
        `Skill assessment primary MCQ gate bypassed: no primary MCQs attempt=${attempt.id} user=${userId}`,
      );
    }
    if (aboveProbeMcqTotal > 0 && aboveProbeMcqCorrect === 0) {
      this.logger.warn(
        `Skill assessment above-level MCQ gate bypassed: no above-level MCQs attempt=${attempt.id} user=${userId}`,
      );
    }

    const failed = !meetsSkillQualityBenchmark(percentage);
    const claimed = profile.claimed_level ?? VerifiedLevel.JUNIOR;
    const validatedLevel = failed
      ? null
      : this.resolveValidatedLevel(
          claimedPercentage,
          aboveLevelPercentage,
          belowLevelPercentage,
          percentage,
          claimed,
          primaryMcqGatePassed,
          aboveProbeMcqGatePassed,
        );
    const downgraded =
      !failed &&
      validatedLevel !== null &&
      levelIsLower(validatedLevel, claimed);
    const passed = !failed && validatedLevel !== null;
    const tier = this.resolveSkillTier(percentage);

    if (!passed) {
      void this.guidanceReportQueue.enqueue({
        attemptId: attempt.id,
        track: profile.track ?? 'general',
        claimed_level: claimed,
        validated_level:
          validatedLevel ?? profile.validated_level ?? VerifiedLevel.JUNIOR,
        percentage,
      });
    }

    await this.talentProfileRepo.manager.transaction(async (manager) => {
      await manager.save(AssessmentResponse, responsesToSave);
      if (historyPatches.size > 0) {
        const historyValues = Array.from(
          historyPatches.entries(),
          ([questionId, patch]) => ({
            talent_profile_id: profile.id,
            question_id: questionId,
            attempt_id: attempt.id,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            user_answer: patch.user_answer,
            is_correct: patch.is_correct,
            raw_score: patch.raw_score,
            max_score: patch.max_score,
            answered_at: patch.answered_at ?? new Date(),
          }),
        );
        await manager
          .createQueryBuilder()
          .insert()
          .into(TalentQuestionHistory)
          .values(historyValues)
          .orUpdate(
            [
              'user_answer',
              'is_correct',
              'raw_score',
              'max_score',
              'answered_at',
            ],
            ['talent_profile_id', 'question_id'],
          )
          .execute();
      }

      attempt.completed_at = new Date();
      await manager.save(AssessmentAttempt, attempt);

      const result = manager.create(AssessmentResult, {
        attempt_id: attempt.id,
        score: Math.round(totalScore),
        max_score: totalMaxScore,
        percentage,
        claimed_percentage: claimedPercentage,
        validated_level: validatedLevel,
        tier: null,
        guidance_report: null,
      });
      await manager.save(AssessmentResult, result);

      if (!failed && validatedLevel) {
        await manager.update(
          TalentProfile,
          { id: profile.id },
          {
            validated_level: validatedLevel,
            skill_assessment_completed_at: new Date(),
            status: this.skillTierToProfileStatus(tier, passed),
          },
        );
      } else {
        await manager.update(
          TalentProfile,
          { id: profile.id },
          {
            status: TalentProfileStatus.NOT_READY,
          },
        );
      }
    });

    this.logger.log(
      `Skill assessment submitted: attempt=${attempt.id} user=${userId} score=${totalScore}/${totalMaxScore} pct=${percentage} validated=${validatedLevel ?? 'n/a'} failed=${failed} passed=${passed} downgraded=${downgraded}`,
    );

    // Issue (or renew) the shareable certificate. Never blocks the result.
    let certificateCode: string | undefined;
    if (passed && validatedLevel && profile.track) {
      certificateCode = await this.certificates
        .issueForSkillPass(profile.id, profile.track, validatedLevel)
        .then((cert) => cert?.code)
        .catch((err) => {
          this.logger.error(
            `Certificate issue failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
          return undefined;
        });
    }

    // Warm resource cache for the validated level on pass
    if (!failed && validatedLevel && profile.track) {
      this.aiResourcesService
        .warmCache(profile.track, validatedLevel)
        .catch((err) => {
          this.logger.error(
            `Resource cache warming after skill assessment failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        });
    }

    const attemptNumber = await this.resolveSkillAttemptNumber(
      profile.id,
      attempt,
      this.readSessionPayload(attempt),
    );

    const attemptsUsed = await this.countCompletedSkillAttempts(profile.id);
    const hasAttemptsRemaining =
      Boolean(profile.advanced_assessment_completed_at) ||
      attemptsUsed < SKILL_ASSESSMENT_MAX_ATTEMPTS;
    const retakeAvailable = !passed && hasAttemptsRemaining;

    // Tell the talent about the outcome in-app. Never blocks the result.
    if (profile.track) {
      const payload = {
        level: validatedLevel ?? claimed,
        track: profile.track,
        percentage,
        certificateCode,
        retakeAvailable,
      };
      const notify = passed
        ? this.notificationDispatch.notifySkillAssessmentPassed(userId, payload)
        : this.notificationDispatch.notifySkillAssessmentFailed(
            userId,
            payload,
          );
      void notify.catch((err) => {
        this.logger.error(
          `Skill result notification failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
    }

    return {
      status: failed ? 'failed' : 'success',
      message: failed
        ? SuccessMessages.SKILL_ASSESSMENT.FAILED
        : SuccessMessages.SKILL_ASSESSMENT.SUBMITTED,
      session_id: attempt.id,
      attempt_number: attemptNumber,
      score: Math.round(totalScore),
      total: totalMaxScore,
      percentage,
      validated_level: validatedLevel,
      claimed_level: claimed,
      downgraded,
      passed,
      failed,
      retake_available: retakeAvailable,
      max_attempts: SKILL_ASSESSMENT_MAX_ATTEMPTS,
      attempts_used: attemptsUsed,
      competency_breakdown: this.toCompetencyBreakdown(competencyTally),
      ...(downgraded && {
        personalised_message: SuccessMessages.SKILL_ASSESSMENT.DOWNGRADE_NOTICE,
      }),
    };
  }

  /** Weakest competency first, so the page can lead with what to work on. */
  private toCompetencyBreakdown(
    tally: Map<string, { correct: number; total: number }>,
  ): SkillCompetencyResult[] {
    return [...tally.entries()]
      .map(([competency, { correct, total }]) => ({
        competency,
        correct,
        total,
        percentage: Math.round((correct / total) * 100),
      }))
      .sort(
        (a, b) =>
          a.percentage - b.percentage ||
          a.competency.localeCompare(b.competency),
      );
  }

  private async findEligibleSkillQuestions(
    manager: EntityManager,
    profile: TalentProfile,
    verifiedLevel: VerifiedLevel,
    skipExclusion = false,
  ): Promise<AssessmentQuestion[]> {
    const qb = manager
      .createQueryBuilder(AssessmentQuestion, 'question')
      .where('question.assessment_type = :assessmentType', {
        assessmentType: AssessmentType.SKILL,
      })
      .andWhere('question.is_live = true')
      .andWhere('question.track = :track', { track: profile.track })
      .andWhere('question.verified_level = :verifiedLevel', { verifiedLevel })
      .andWhere('question.question_type IN (:...mcqTypes)', {
        mcqTypes: [QuestionType.SINGLE_PICK, QuestionType.MULTI_PICK],
      });

    if (!skipExclusion) {
      qb.andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM talent_question_history history
          WHERE history.question_id = question.id
          AND history.talent_profile_id = :talentProfileId
        )`,
        { talentProfileId: profile.id },
      );
    }

    return qb.orderBy('RANDOM()').getMany();
  }

  private selectSkillQuestionMix(
    bankQuestions: AssessmentQuestion[],
  ): AssessmentQuestion[] {
    const mcqs = bankQuestions
      .filter((question) => this.isPickQuestion(question))
      .slice(0, SKILL_ASSESSMENT_MCQ_COUNT);

    if (mcqs.length < SKILL_ASSESSMENT_MCQ_COUNT) {
      // Throw a plain Error so the caller (start()) can retry before alerting.
      throw new Error(
        `Primary bank mix insufficient: mcq=${mcqs.length}/${SKILL_ASSESSMENT_MCQ_COUNT}`,
      );
    }

    return mcqs;
  }

  private isPickQuestion(question: {
    question_type: QuestionType | null | undefined;
  }): boolean {
    return (
      question.question_type === QuestionType.SINGLE_PICK ||
      question.question_type === QuestionType.MULTI_PICK
    );
  }

  private readSessionPayload(
    attempt: AssessmentAttempt,
  ): SkillAssessmentSessionPayload {
    const payload = attempt.generated_questions_json;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }
    return payload as SkillAssessmentSessionPayload;
  }

  private readSessionQuestions(
    attempt: AssessmentAttempt,
  ): SkillAssessmentSessionQuestion[] {
    const questions = this.readSessionPayload(attempt).questions;
    if (!Array.isArray(questions)) {
      return [];
    }

    const sessionQuestions = questions;
    if (sessionQuestions.some((question) => !this.isPickQuestion(question))) {
      throw new BadRequestException(
        ErrorMessages.SKILL_ASSESSMENT.ATTEMPT_CORRUPT,
      );
    }

    return sessionQuestions;
  }

  private toPublicSessionQuestions(
    questions: SkillAssessmentSessionQuestion[],
  ): SkillAssessmentQuestion[] {
    return questions.map(({ correct_answer: _ignored, ...question }) => {
      const block =
        question.block ?? this.blockForQuestionType(question.question_type);
      const bounds = textLengthBoundsForBlock(block);
      return {
        ...question,
        block,
        ...(bounds && { min_length: bounds.min, max_length: bounds.max }),
      };
    });
  }

  private blockForQuestionType(
    _questionType: QuestionType,
  ): AssessmentAnswerBlock {
    return 'mcq';
  }

  private scoreGeneratedMcq(
    question: SkillAssessmentSessionQuestion,
    answer: string | string[] | null,
  ): boolean {
    if (!answer || !question.correct_answer) {
      return false;
    }

    const userAnswer = Array.isArray(answer)
      ? answer
          .map((a) => a.trim())
          .sort()
          .join(',')
          .toLowerCase()
      : String(answer).toLowerCase().trim();

    const correctAnswer = Array.isArray(answer)
      ? String(question.correct_answer)
          .toLowerCase()
          .split(',')
          .map((a) => a.trim())
          .sort()
          .join(',')
      : String(question.correct_answer).toLowerCase().trim();

    return userAnswer === correctAnswer;
  }

  private selectSkillProbeMix(
    bankQuestions: AssessmentQuestion[],
  ): AssessmentQuestion[] {
    const mcqs = bankQuestions
      .filter((question) => this.isPickQuestion(question))
      .slice(0, SKILL_PROBE_MCQ_COUNT);

    if (mcqs.length < SKILL_PROBE_MCQ_COUNT) {
      // Probe questions are best-effort; deficit filler handles the gap
      this.logger.warn(
        `Probe bank mix insufficient: mcq=${mcqs.length}/${SKILL_PROBE_MCQ_COUNT}`,
      );
    }

    return mcqs;
  }

  private toPercentage(score: number, maxScore: number): number {
    return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  }

  private levelAbove(level: VerifiedLevel): VerifiedLevel | null {
    const levels = Object.values(VerifiedLevel);
    const index = levels.indexOf(level);
    if (index < 0 || index >= levels.length - 1) {
      return null;
    }
    return levels[index + 1] ?? null;
  }

  private levelBelowForProbe(level: VerifiedLevel): VerifiedLevel | null {
    const levels = Object.values(VerifiedLevel);
    const index = levels.indexOf(level);
    if (index <= 0) {
      return null;
    }
    return levels[index - 1] ?? null;
  }

  private resolveValidatedLevel(
    claimedPercentage: number,
    aboveLevelPercentage: number,
    belowLevelPercentage: number,
    overallPercentage: number,
    claimedLevel: VerifiedLevel,
    primaryMcqGatePassed = true,
    aboveProbeMcqGatePassed = true,
  ): VerifiedLevel {
    if (overallPercentage < 55) {
      return LEVEL_ORDER[claimedLevel] > LEVEL_ORDER[VerifiedLevel.JUNIOR]
        ? VerifiedLevel.JUNIOR
        : claimedLevel;
    }

    if (
      claimedPercentage >= 95 &&
      aboveLevelPercentage >= 70 &&
      aboveProbeMcqGatePassed &&
      this.levelAbove(claimedLevel)
    ) {
      return this.levelAbove(claimedLevel) as VerifiedLevel;
    }

    if (
      claimedPercentage >= SKILL_ASSESSMENT_PASS_PERCENTAGE &&
      primaryMcqGatePassed
    ) {
      return claimedLevel;
    }

    const belowLevel = this.levelBelowForProbe(claimedLevel);
    if (claimedPercentage < 60 && belowLevelPercentage >= 60 && belowLevel) {
      return belowLevel;
    }

    return this.levelBelow(claimedLevel);
  }

  private levelBelow(level: VerifiedLevel): VerifiedLevel {
    const levels = Object.values(VerifiedLevel);
    const index = levels.indexOf(level);
    return levels[Math.max(0, index - 1)] ?? VerifiedLevel.JUNIOR;
  }

  private resolveSkillTier(percentage: number): TalentProfileStatus {
    if (percentage >= 50) {
      return TalentProfileStatus.EMERGING;
    }
    return TalentProfileStatus.NOT_READY;
  }

  private skillTierToProfileStatus(
    tier: TalentProfileStatus,
    passed: boolean,
  ): TalentProfileStatus {
    if (passed) {
      return TalentProfileStatus.IN_PROGRESS;
    }
    return tier;
  }

  async flag(
    userId: string,
    sessionId: string,
    dto: FlagIntegrityEventDto,
  ): Promise<IntegrityFlagResult> {
    const profile = await this.talentProfileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      throw new NotFoundException(
        ErrorMessages.SKILL_ASSESSMENT.PROFILE_NOT_FOUND,
      );
    }

    const counterField =
      dto.eventType === IntegrityEventType.TAB_SWITCH
        ? 'tab_switch_count'
        : 'copy_paste_count';

    const result = await this.talentProfileRepo.manager.transaction(
      async (manager) => {
        const attempt = await manager.findOne(AssessmentAttempt, {
          where: {
            id: sessionId,
            talent_profile_id: profile.id,
            assessment_type: AssessmentType.SKILL,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!attempt) {
          throw new NotFoundException(
            ErrorMessages.SKILL_ASSESSMENT.ATTEMPT_NOT_FOUND,
          );
        }
        if (attempt.completed_at || attempt.force_submitted) {
          throw new BadRequestException(
            ErrorMessages.SKILL_ASSESSMENT.ATTEMPT_ALREADY_SUBMITTED,
          );
        }

        await manager.increment(
          AssessmentAttempt,
          {
            id: attempt.id,
            talent_profile_id: profile.id,
            assessment_type: AssessmentType.SKILL,
          },
          counterField,
          1,
        );

        const updatedAttempt = await manager.findOne(AssessmentAttempt, {
          where: { id: attempt.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!updatedAttempt) {
          throw new NotFoundException(
            ErrorMessages.SKILL_ASSESSMENT.ATTEMPT_NOT_FOUND,
          );
        }

        const voided =
          updatedAttempt.tab_switch_count >= INTEGRITY_VIOLATION_LIMIT ||
          updatedAttempt.copy_paste_count >= INTEGRITY_VIOLATION_LIMIT;
        if (voided) {
          await manager.update(
            AssessmentAttempt,
            { id: attempt.id },
            { force_submitted: true, completed_at: new Date() },
          );
        }

        return {
          voided,
          attemptId: attempt.id,
          tabSwitchCount: updatedAttempt.tab_switch_count,
          copyPasteCount: updatedAttempt.copy_paste_count,
        };
      },
    );

    if (!result.voided) {
      return {
        status: 'recorded',
        message: `Violation recorded (${Math.max(result.tabSwitchCount, result.copyPasteCount)} of ${INTEGRITY_VIOLATION_LIMIT}). The session ends at ${INTEGRITY_VIOLATION_LIMIT}.`,
        tabSwitchCount: result.tabSwitchCount,
        copyPasteCount: result.copyPasteCount,
        sessionVoided: false,
        action: 'warn',
      };
    }

    this.logger.warn(
      `Skill session voided - integrity ${dto.eventType}: attempt=${result.attemptId} user=${userId}`,
    );

    return {
      status: 'voided',
      message: ErrorMessages.SKILL_ASSESSMENT.SESSION_VOIDED,
      tabSwitchCount: result.tabSwitchCount,
      copyPasteCount: result.copyPasteCount,
      sessionVoided: true,
      action: 'logout',
    };
  }
}
