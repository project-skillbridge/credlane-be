import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Not, Repository } from 'typeorm';
import {
  AssessmentAttempt,
  AssessmentQuestion,
  AssessmentResponse,
  AssessmentResult,
  AssessmentScore,
  AssessmentScoreQuestionType,
  AssessmentType,
  IntegrityConfidenceLevel,
  QuestionType,
  SlotType,
  TalentQuestionHistory,
} from '../../assessments/entities';
import { AssessmentTier } from '../../assessments/entities/assessment-result.entity';
import { ErrorMessages, SuccessMessages } from '../../../shared';
import {
  TalentProfile,
  TalentProfileStatus,
} from '../entities/talent-profile.entity';
import { VerifiedLevel } from '../../assessments/entities/assessment-question.entity';
import {
  ADVANCED_ASSESSMENT_BASE_QUESTIONS,
  ADVANCED_ASSESSMENT_MCQ_COUNT,
  ADVANCED_ASSESSMENT_SHORT_TEXT_COUNT,
  AdvancedAssessmentAiService,
  AdvancedAssessmentGeneratedQuestion,
} from './advanced-assessment-ai.service';
import { PersonalAssessmentService } from './personal-assessment.service';
import { RubricScoringService } from '../../ai/rubric-scoring.service';
import { GuidanceReportService } from '../../ai/guidance-report.service';

import { EmployerPoolProfileService } from './employer-pool-profile.service';
import { BankExhaustedAlertService } from '../../mail/bank-exhausted-alert.service';
import {
  GenerateQuestionsInput,
  GeneratedQuestion,
  QuestionGradingRubric,
  ScoredTextAnswer,
  TextAnswerInput,
} from '../../ai/ai.types';
import { QuestionGenerationService } from '../../ai/question-generation.service';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import { NotificationType } from '../../notifications/notification-type.enum';
import { UsersService } from '../../users/users.service';
import {
  FlagIntegrityEventDto,
  IntegrityEventType,
  SubmitAdvancedAssessmentDto,
} from './dto/advanced-assessment.dto';
import { IntegrityFlagResult } from './dto/integrity-event.dto';
import {
  metadataDifficulty,
  resolveCompetencyHint,
  resolveIndustryContext,
} from './assessment-utils';
import {
  competenciesForTrack,
  normaliseCompetency,
  resolveQuestionCompetency,
  sanitiseCompetencyList,
} from './competency-taxonomy';
import {
  meetsAdvancedQualityBenchmark,
  meetsSkillQualityBenchmark,
  qualifiesForAdvancedFromSkillResult,
} from './assessment-quality';
import { AdvancedAssessmentQueueService } from './advanced-assessment-queue.service';
import type { AdvancedAssessmentSubmitJobData } from './advanced-assessment-submit.types';

const ADVANCED_ASSESSMENT_DURATION_MINUTES = 60;
const RETAKE_GATE_DAYS = 14;
const ABNORMAL_LONG_TEXT_SECONDS = 5;
const ADVANCED_SHORT_TEXT_MIN_CHARS = 10;
const ADVANCED_SHORT_TEXT_MAX_CHARS = 600;
const ADVANCED_LONG_TEXT_MIN_CHARS = 60;
const ADVANCED_LONG_TEXT_MAX_CHARS = 2000;
const ADVANCED_MCQ_SCORE_WEIGHT = 0.3;

// Long-text block = 2 situational (LT-1) + 3 work-task (LT-2).
const ADVANCED_LT1_COUNT = 2;
const ADVANCED_LT2_COUNT = 3;

// Text questions keep their rubric max scores for per-question analytics.
// Final attempt percentage is weighted separately: MCQ 30%, text 70%.
const TEXT_FULL_RUBRIC_MAX = 12;

export interface AdvancedAssessmentSessionResult {
  status: string;
  message: string;
  session_id: string;
  started_at: string;
  expires_at: string;
  completed_at: string | null;
  is_expired: boolean;
  remaining_seconds: number;
  verified_level: string;
  question_count: number;
  mcq_count: number;
  open_text_count: number;
  /** True when a 15th question (LT-3) will be generated after lt2-submit. */
  pending_lt3: boolean;
  questions: AdvancedAssessmentGeneratedQuestion[];
}

export interface AdvancedAssessmentSubmitResult {
  status: 'processing';
  message: string;
  session_id: string;
}

type ScoreReadyDispatchPayload = {
  score: number;
  maxScore: number;
  percentage: number;
  tier: AssessmentTier;
};

type AdvancedAssessmentSessionPayload = {
  context?: {
    verified_level?: unknown;
    submit_enqueued_at?: string;
  };
  questions?: unknown;
};

type AdvancedQuestionBank = {
  mcq: AssessmentQuestion[];
  shortText: AssessmentQuestion[];
  longText: AssessmentQuestion[];
};

@Injectable()
export class AdvancedAssessmentService {
  private readonly logger = new Logger(AdvancedAssessmentService.name);

  constructor(
    @InjectRepository(TalentProfile)
    private readonly talentProfileRepo: Repository<TalentProfile>,

    @InjectRepository(AssessmentQuestion)
    private readonly questionRepo: Repository<AssessmentQuestion>,

    @InjectRepository(AssessmentAttempt)
    private readonly attemptRepo: Repository<AssessmentAttempt>,

    @InjectRepository(AssessmentResult)
    private readonly resultRepo: Repository<AssessmentResult>,

    private readonly personalAssessmentService: PersonalAssessmentService,
    private readonly advancedAssessmentAiService: AdvancedAssessmentAiService,
    private readonly rubricScoring: RubricScoringService,
    private readonly guidanceReport: GuidanceReportService,
    private readonly employerPoolProfileService: EmployerPoolProfileService,
    private readonly questionGeneration: QuestionGenerationService,
    private readonly usersService: UsersService,
    private readonly notificationDispatch: NotificationDispatchService,
    @Inject(forwardRef(() => AdvancedAssessmentQueueService))
    private readonly submitQueue: AdvancedAssessmentQueueService,
    private readonly bankExhaustedAlert: BankExhaustedAlertService,
  ) {}

  async start(userId: string): Promise<AdvancedAssessmentSessionResult> {
    const personalContext =
      await this.personalAssessmentService.getAiContext(userId);

    const savedAttempt = await this.talentProfileRepo.manager.transaction(
      async (manager) => {
        const profile = await manager.findOne(TalentProfile, {
          where: { user_id: userId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!profile) {
          throw new NotFoundException(
            ErrorMessages.ADVANCED_ASSESSMENT.PROFILE_NOT_FOUND,
          );
        }

        if (!this.hasAdvancedAssessmentContext(profile)) {
          throw new UnprocessableEntityException(
            ErrorMessages.ADVANCED_ASSESSMENT.PERSONAL_ASSESSMENT_INCOMPLETE,
          );
        }

        if (!profile.validated_level) {
          throw new UnprocessableEntityException({
            error: 'LEVEL_NOT_VERIFIED',
            message: ErrorMessages.ADVANCED_ASSESSMENT.LEVEL_NOT_VERIFIED,
          });
        }

        const completedSkillAttempts = await manager.count(AssessmentAttempt, {
          where: {
            talent_profile_id: profile.id,
            assessment_type: AssessmentType.SKILL,
            completed_at: Not(IsNull()),
          },
        });
        if (completedSkillAttempts < 1) {
          throw new UnprocessableEntityException(
            ErrorMessages.ADVANCED_ASSESSMENT.SKILL_GATE_REQUIRED,
          );
        }

        const latestSkillResult = await this.findLatestSkillResult(
          manager,
          profile.id,
        );
        if (!latestSkillResult) {
          throw new UnprocessableEntityException(
            ErrorMessages.ADVANCED_ASSESSMENT.SKILL_GATE_REQUIRED,
          );
        }

        if (!profile.skill_assessment_completed_at) {
          throw new UnprocessableEntityException(
            ErrorMessages.ADVANCED_ASSESSMENT.SKILL_GATE_REQUIRED,
          );
        }

        if (!meetsSkillQualityBenchmark(latestSkillResult.percentage ?? 0)) {
          throw new UnprocessableEntityException({
            error: 'SKILL_QUALITY_REQUIRED',
            message: ErrorMessages.SKILL_ASSESSMENT.QUALITY_REQUIRED,
          });
        }

        if (!qualifiesForAdvancedFromSkillResult(latestSkillResult)) {
          throw new UnprocessableEntityException({
            error: 'SKILL_PASS_REQUIRED',
            message: ErrorMessages.SKILL_ASSESSMENT.PASS_REQUIRED,
          });
        }

        this.assertAdvancedRetakeUnlocked(profile);

        const inFlightSubmit = await this.findInFlightAdvancedSubmit(
          manager,
          profile.id,
        );
        if (inFlightSubmit) {
          throw this.buildAdvancedSubmitProcessingConflict(inFlightSubmit.id);
        }

        const activeAttempt = await manager
          .createQueryBuilder(AssessmentAttempt, 'attempt')
          .where('attempt.talent_profile_id = :talentProfileId', {
            talentProfileId: profile.id,
          })
          .andWhere('attempt.assessment_type = :assessmentType', {
            assessmentType: AssessmentType.ADVANCED,
          })
          .andWhere('attempt.completed_at IS NULL')
          .andWhere('attempt.force_submitted = false')
          .andWhere(
            '(attempt.expires_at IS NULL OR attempt.expires_at > :now)',
            { now: new Date() },
          )
          .orderBy('attempt.started_at', 'DESC')
          .getOne();

        if (activeAttempt) {
          throw new ConflictException({
            error: 'CONFLICT',
            message: ErrorMessages.ADVANCED_ASSESSMENT.ACTIVE_SESSION_EXISTS,
            existing_session_id: activeAttempt.id,
          });
        }

        const eligibleQuestions = await this.findEligibleQuestions(
          manager,
          profile,
        );
        const selectedQuestions = await this.selectQuestionBlocks(
          manager,
          profile,
          personalContext,
          eligibleQuestions,
        );

        const aiResult = this.advancedAssessmentAiService.generateQuestions(
          {
            ...personalContext,
            track: profile.track,
            verified_level: profile.validated_level,
          },
          selectedQuestions,
        );

        if (aiResult.questions.length !== ADVANCED_ASSESSMENT_BASE_QUESTIONS) {
          this.logger.error(
            `[BANK_EXHAUSTED] expected=${ADVANCED_ASSESSMENT_BASE_QUESTIONS} ` +
              `got=${aiResult.questions.length} ` +
              `talentProfileId=${profile.id} ` +
              `track=${profile.track ?? 'unknown'} ` +
              `verified_level=${profile.validated_level ?? 'unknown'}`,
          );
          this.throwAdvancedBankExhausted(profile, aiResult.questions.length);
        }

        const startedAt = new Date();
        const expiresAt = new Date(
          startedAt.getTime() +
            ADVANCED_ASSESSMENT_DURATION_MINUTES * 60 * 1000,
        );

        const attempt = await manager.save(
          AssessmentAttempt,
          manager.create(AssessmentAttempt, {
            talent_profile_id: profile.id,
            assessment_type: AssessmentType.ADVANCED,
            started_at: startedAt,
            completed_at: null,
            expires_at: expiresAt,
            generated_questions_json: {
              context: aiResult.context,
              questions: aiResult.questions,
            },
          }),
        );

        await manager.save(
          TalentQuestionHistory,
          aiResult.questions.map((question) =>
            manager.create(TalentQuestionHistory, {
              talent_profile_id: profile.id,
              question_id: question.question_id,
              attempt_id: attempt.id,
              user_answer: { served: true },
              is_correct: null,
              raw_score: null,
              max_score: null,
              answered_at: startedAt,
            }),
          ),
        );

        return attempt;
      },
    );

    this.logger.log(
      `Advanced assessment started: attempt=${savedAttempt.id} user=${userId}`,
    );

    return this.toSessionResult(
      savedAttempt,
      SuccessMessages.ADVANCED_ASSESSMENT.STARTED,
    );
  }

  private hasAdvancedAssessmentContext(profile: TalentProfile): boolean {
    return Boolean(
      profile.track?.trim() &&
      (profile.personal_assessment_completed_at ||
        profile.claimed_level ||
        profile.validated_level),
    );
  }

  async getSession(
    userId: string,
    sessionId: string,
  ): Promise<AdvancedAssessmentSessionResult> {
    const profile = await this.talentProfileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      throw new NotFoundException(
        ErrorMessages.ADVANCED_ASSESSMENT.PROFILE_NOT_FOUND,
      );
    }
    this.assertAdvancedRetakeUnlocked(profile);

    const attempt = await this.attemptRepo.findOne({
      where: {
        id: sessionId,
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.ADVANCED,
      },
    });
    if (!attempt) {
      throw new NotFoundException(
        ErrorMessages.ADVANCED_ASSESSMENT.SESSION_NOT_FOUND,
      );
    }

    return this.toSessionResult(
      attempt,
      SuccessMessages.ADVANCED_ASSESSMENT.SESSION_RESUMED,
    );
  }

  async submit(
    userId: string,
    dto: SubmitAdvancedAssessmentDto,
  ): Promise<AdvancedAssessmentSubmitResult> {
    const { profile, sessionQuestions } = await this.validateSubmitForEnqueue(
      userId,
      dto,
    );

    const answerMap = new Map(
      dto.answers.map((answer) => [answer.questionId, answer]),
    );
    for (const question of sessionQuestions) {
      const isMcq =
        question.question_type === QuestionType.SINGLE_PICK ||
        question.question_type === QuestionType.MULTI_PICK;
      if (isMcq) continue;
      const submitted = answerMap.get(question.question_id);
      const answer = submitted ? String(submitted.answer) : '';
      this.assertTextLength(question, answer);
    }

    await this.talentProfileRepo.manager.transaction(async (manager) => {
      const lockedAttempt = await manager.findOne(AssessmentAttempt, {
        where: {
          id: dto.sessionId,
          talent_profile_id: profile.id,
          assessment_type: AssessmentType.ADVANCED,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedAttempt) {
        throw new NotFoundException(
          ErrorMessages.ADVANCED_ASSESSMENT.ATTEMPT_NOT_FOUND,
        );
      }
      if (lockedAttempt.completed_at) {
        throw new BadRequestException(
          ErrorMessages.ADVANCED_ASSESSMENT.ATTEMPT_ALREADY_SUBMITTED,
        );
      }
      if (lockedAttempt.force_submitted) {
        throw new BadRequestException(
          ErrorMessages.ADVANCED_ASSESSMENT.SESSION_VOIDED,
        );
      }
      if (this.isAdvancedSubmitInFlight(lockedAttempt)) {
        throw new BadRequestException(
          ErrorMessages.ADVANCED_ASSESSMENT.ATTEMPT_ALREADY_SUBMITTED,
        );
      }

      const otherInFlight = await this.findInFlightAdvancedSubmit(
        manager,
        profile.id,
        lockedAttempt.id,
      );
      if (otherInFlight) {
        throw this.buildAdvancedSubmitProcessingConflict(otherInFlight.id);
      }

      lockedAttempt.generated_questions_json = this.withSubmitEnqueuedAt(
        lockedAttempt,
        new Date().toISOString(),
      );
      await manager.save(AssessmentAttempt, lockedAttempt);

      const lockedFrom = new Date();
      const unlocksAt = new Date(lockedFrom);
      unlocksAt.setDate(unlocksAt.getDate() + RETAKE_GATE_DAYS);
      await manager.update(
        TalentProfile,
        { id: profile.id },
        {
          assessment_locked_from: lockedFrom,
          assessment_locked_until: unlocksAt,
          advanced_retake_required: true,
        },
      );
    });

    try {
      await this.submitQueue.enqueue({
        userId,
        sessionId: dto.sessionId,
        answers: dto.answers.map((answer) => ({
          questionId: answer.questionId,
          answer: answer.answer,
          timeSpentSeconds: answer.timeSpentSeconds,
        })),
      });
    } catch {
      await this.clearSubmitEnqueuedAt(dto.sessionId);
      await this.talentProfileRepo.update(
        { id: profile.id },
        {
          assessment_locked_from: null,
          assessment_locked_until: null,
          advanced_retake_required: false,
        },
      );
      throw new ServiceUnavailableException({
        error: 'SUBMIT_QUEUE_UNAVAILABLE',
        message: ErrorMessages.ADVANCED_ASSESSMENT.SUBMIT_QUEUE_UNAVAILABLE,
      });
    }

    this.logger.log(
      `Advanced assessment submit queued: attempt=${dto.sessionId} user=${userId}`,
    );

    return {
      status: 'processing',
      message: SuccessMessages.ADVANCED_ASSESSMENT.QUEUED,
      session_id: dto.sessionId,
    };
  }

  /**
   * Background worker entry: scoring, persistence, guidance, employer pool,
   * notifications. Idempotent when the attempt is already completed.
   */
  async processSubmitJob(data: AdvancedAssessmentSubmitJobData): Promise<void> {
    const profile = await this.talentProfileRepo.findOne({
      where: { user_id: data.userId },
    });
    if (!profile) {
      this.logger.warn(
        `Advanced submit job skipped: profile not found user=${data.userId}`,
      );
      return;
    }

    const attempt = await this.attemptRepo.findOne({
      where: {
        id: data.sessionId,
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.ADVANCED,
      },
    });
    if (!attempt) {
      this.logger.warn(
        `Advanced submit job skipped: attempt not found session=${data.sessionId}`,
      );
      return;
    }
    if (attempt.completed_at) {
      const result = await this.backfillPendingGuidanceReport(profile, attempt);
      if (result) {
        const payload = this.scoreReadyDispatchPayloadFromResult(result);
        if (payload) {
          this.dispatchScoreReadyNotification(data.userId, payload);
        }
      }
      return;
    }
    if (attempt.force_submitted) {
      this.logger.warn(
        `Advanced submit job skipped: session voided session=${data.sessionId}`,
      );
      return;
    }

    const isExpired = attempt.expires_at
      ? attempt.expires_at <= new Date()
      : false;

    const sessionQuestions = this.readSessionQuestions(attempt);
    if (sessionQuestions.length === 0) {
      throw new BadRequestException(
        ErrorMessages.ADVANCED_ASSESSMENT.SESSION_CORRUPT,
      );
    }

    const userId = data.userId;
    const dtoAnswers = data.answers;
    const answerMap = new Map(
      dtoAnswers.map((answer) => [answer.questionId, answer]),
    );

    let mcqRawScore = 0;
    let mcqTotal = 0;
    const mcqCorrectMap = new Map<string, boolean>();
    const textInputs: TextAnswerInput[] = [];
    const responsesToSave: Partial<AssessmentResponse>[] = [];
    // Map keyed by question_id so each text answer scored by the AI rubric
    // can be associated back to its question for assessment_scores writes.
    const abnormalTimingByQuestion = new Map<string, boolean>();
    let hasAbnormalTiming = false;

    for (const question of sessionQuestions) {
      const submitted = answerMap.get(question.question_id);
      const isMcq =
        question.question_type === QuestionType.SINGLE_PICK ||
        question.question_type === QuestionType.MULTI_PICK;

      if (isMcq) {
        mcqTotal++;
        const correct = this.scoreMcq(question, submitted?.answer ?? null);
        mcqRawScore += correct ? 1 : 0;
        mcqCorrectMap.set(question.question_id, correct);
        responsesToSave.push({
          attempt_id: attempt.id,
          question_id: question.question_id,
          question_text: question.question_text,
          user_answer: submitted?.answer ?? '',
          is_correct: correct,
          ai_evaluation_json: null,
          answered_at: new Date(),
        });
        continue;
      }

      const answer = submitted ? String(submitted.answer) : '';

      const isLongText = question.block === 'long_text';
      const abnormal =
        isLongText &&
        submitted?.timeSpentSeconds !== undefined &&
        submitted.timeSpentSeconds < ABNORMAL_LONG_TEXT_SECONDS &&
        answer.length > 0;
      if (abnormal) {
        hasAbnormalTiming = true;
        abnormalTimingByQuestion.set(question.question_id, true);
      }

      const metadata = (question.metadata ?? {}) as Record<string, unknown>;
      const rawRubric = metadata.grading_rubric;
      const gradingRubric =
        rawRubric !== null &&
        typeof rawRubric === 'object' &&
        !Array.isArray(rawRubric)
          ? (rawRubric as QuestionGradingRubric)
          : null;

      textInputs.push({
        question_id: question.question_id,
        question_text: question.question_text,
        answer,
        grading_rubric: gradingRubric,
        is_lt3: question.slot_type === SlotType.REFLECTION,
      });
      responsesToSave.push({
        attempt_id: attempt.id,
        question_id: question.question_id,
        question_text: question.question_text,
        user_answer: answer,
        is_correct: null,
        ai_evaluation_json: null,
        answered_at: new Date(),
      });
    }

    const scoredTextAnswers = await this.rubricScoring.scoreAnswers(textInputs);

    const pendingCount = scoredTextAnswers.filter(
      (s) => s.rubric.pending,
    ).length;
    if (pendingCount > 0) {
      throw new Error(
        `Rubric scoring pending for ${pendingCount}/${scoredTextAnswers.length} text answers — will retry`,
      );
    }

    let textRawScore = 0;
    let textMaxScore = 0;
    const scoredByQuestion = new Map<string, ScoredTextAnswer>();
    for (const scored of scoredTextAnswers) {
      textRawScore += scored.raw_score;
      textMaxScore += scored.max_score;
      scoredByQuestion.set(scored.question_id, scored);

      const response = responsesToSave.find(
        (entry) => entry.question_id === scored.question_id,
      );
      if (response) {
        response.ai_evaluation_json = { ...scored.rubric };
      }
    }

    const weightedScore = this.toWeightedAssessmentScore(
      mcqRawScore,
      mcqTotal,
      textRawScore,
      textMaxScore,
      ADVANCED_MCQ_SCORE_WEIGHT,
    );
    const totalRawScore = weightedScore.score;
    const maxScore = weightedScore.maxScore;
    const percentage = weightedScore.percentage;

    const mcqGatePassed = mcqRawScore > 0;
    if (mcqTotal === 0) {
      this.logger.error(
        `Advanced assessment MCQ gate failed: no MCQs attempt=${attempt.id} user=${userId}`,
      );
    }

    const failed = !meetsAdvancedQualityBenchmark(percentage);
    const tier = failed
      ? AssessmentTier.NOT_READY
      : this.resolveTier(percentage, mcqGatePassed);
    const integrityConfidence = this.resolveIntegrityConfidence(
      attempt.tab_switch_count,
      attempt.copy_paste_count ?? 0,
      hasAbnormalTiming,
    );

    const strongCompetencies = this.extractCompetencies(
      sessionQuestions,
      scoredTextAnswers,
      profile.track,
      'strong',
    );
    const weakCompetencies = this.extractCompetencies(
      sessionQuestions,
      scoredTextAnswers,
      profile.track,
      'weak',
    );

    const guidanceInput = failed
      ? null
      : ({
          report_type:
            tier === AssessmentTier.JOB_READY ? 'job_ready' : 'emerging',
          assessment_type: 'advanced',
          track: profile.track ?? 'general',
          claimed_level: profile.claimed_level ?? VerifiedLevel.JUNIOR,
          validated_level: profile.validated_level ?? VerifiedLevel.JUNIOR,
          percentage,
          strong_competencies: strongCompetencies,
          weak_competencies: weakCompetencies,
        } satisfies Parameters<GuidanceReportService['generate']>[0]);

    const personalContext =
      !failed && tier === AssessmentTier.JOB_READY
        ? await this.personalAssessmentService.getAiContext(userId)
        : null;

    let resultLookup: { id: string } | { attempt_id: string } | null = null;

    await this.talentProfileRepo.manager.transaction(async (manager) => {
      await manager.save(AssessmentResponse, responsesToSave);

      // Write one assessment_scores row per session question.
      const scoreRows = this.buildAssessmentScoreRows({
        attempt,
        talentProfileId: profile.id,
        sessionQuestions,
        scoredByQuestion,
        abnormalTimingByQuestion,
        integrityConfidence,
        answerMap,
        mcqCorrectMap,
      });
      if (scoreRows.length > 0) {
        await manager.save(AssessmentScore, scoreRows);
      }

      attempt.completed_at = new Date();
      await manager.save(AssessmentAttempt, attempt);

      const result = manager.create(AssessmentResult, {
        attempt_id: attempt.id,
        score: Math.round(totalRawScore),
        max_score: maxScore,
        percentage,
        tier,
        validated_level: null,
        guidance_report: null,
        integrity_confidence: integrityConfidence,
      });
      const savedResult = await manager.save(AssessmentResult, result);
      resultLookup = savedResult.id
        ? { id: savedResult.id }
        : { attempt_id: attempt.id };

      if (!failed) {
        const lockedFrom = new Date();
        const unlocksAt = new Date(lockedFrom);
        unlocksAt.setDate(unlocksAt.getDate() + RETAKE_GATE_DAYS);

        const profilePatch: Partial<TalentProfile> = {
          advanced_assessment_completed_at: new Date(),
          status: this.tierToProfileStatus(tier),
          assessment_locked_from: lockedFrom,
          assessment_locked_until: unlocksAt,
          advanced_retake_required: true,
        };

        await manager.update(TalentProfile, { id: profile.id }, profilePatch);
      }
    });

    if (resultLookup && guidanceInput) {
      try {
        this.logger.log(`Generating guidance report for attempt=${attempt.id}`);
        await this.persistGuidanceReport(resultLookup, guidanceInput);
        this.logger.log(`Guidance report persisted for attempt=${attempt.id}`);
      } catch (error) {
        this.logger.error(
          `Guidance report generation failed for attempt=${attempt.id}: ${String(error)}`,
        );
      }
    }

    if (!failed && tier === AssessmentTier.JOB_READY && personalContext) {
      try {
        const competencyByQuestion = new Map<string, string | null>();
        for (const question of sessionQuestions) {
          competencyByQuestion.set(
            question.question_id,
            resolveQuestionCompetency({ metadata: question.metadata }),
          );
        }

        await this.employerPoolProfileService.upsert({
          profile,
          userId,
          tier,
          percentage,
          scoredTextAnswers,
          competencyByQuestion,
          integrityClean: integrityConfidence === 'high',
          personalContext,
        });
      } catch (error) {
        this.logger.error(
          `Employer pool profile generation failed for user=${userId}: ${String(error)}`,
        );
      }
    }

    this.logger.log(
      `Advanced assessment submitted: attempt=${attempt.id} user=${userId} score=${totalRawScore}/${maxScore} (${percentage}%) tier=${tier} failed=${failed} expired=${isExpired}`,
    );

    this.dispatchScoreReadyNotification(userId, {
      score: Math.round(totalRawScore),
      maxScore,
      percentage,
      tier,
    });

    if (isExpired) {
      this.logger.log(
        `Advanced assessment auto-submitted on expired session: attempt=${attempt.id}`,
      );
    }
  }

  /**
   * When a BullMQ retry runs after the DB commit succeeded but guidance
   * generation failed, completed_at blocks a full re-score. Rebuild guidance
   * from the persisted result + assessment_scores instead.
   */
  private async backfillPendingGuidanceReport(
    profile: TalentProfile,
    attempt: AssessmentAttempt,
  ): Promise<AssessmentResult | null> {
    const result = await this.resultRepo.findOne({
      where: { attempt_id: attempt.id },
    });
    if (!result) {
      this.logger.warn(
        `Guidance backfill skipped: no result for attempt=${attempt.id}`,
      );
      return null;
    }
    if (result.guidance_report != null) {
      return result;
    }

    const percentage = result.percentage ?? 0;
    if (!meetsAdvancedQualityBenchmark(percentage)) {
      return result;
    }

    const tier = result.tier;
    if (!tier || tier === AssessmentTier.NOT_READY) {
      return result;
    }

    const sessionQuestions = this.readSessionQuestions(attempt);
    if (sessionQuestions.length === 0) {
      this.logger.warn(
        `Guidance backfill skipped: corrupt session attempt=${attempt.id}`,
      );
      return result;
    }

    const scoreRows = await this.talentProfileRepo.manager.find(
      AssessmentScore,
      { where: { attempt_id: attempt.id } },
    );
    const scoredTextAnswers =
      this.scoredTextAnswersFromAssessmentScores(scoreRows);
    const guidanceInput = {
      report_type: tier === AssessmentTier.JOB_READY ? 'job_ready' : 'emerging',
      assessment_type: 'advanced' as const,
      track: profile.track ?? 'general',
      claimed_level: profile.claimed_level ?? VerifiedLevel.JUNIOR,
      validated_level: profile.validated_level ?? VerifiedLevel.JUNIOR,
      percentage,
      strong_competencies: this.extractCompetencies(
        sessionQuestions,
        scoredTextAnswers,
        profile.track,
        'strong',
      ),
      weak_competencies: this.extractCompetencies(
        sessionQuestions,
        scoredTextAnswers,
        profile.track,
        'weak',
      ),
    } satisfies Parameters<GuidanceReportService['generate']>[0];

    const resultLookup = result.id
      ? { id: result.id }
      : { attempt_id: attempt.id };

    try {
      await this.persistGuidanceReport(resultLookup, guidanceInput);
      this.logger.log(
        `Guidance report backfilled: attempt=${attempt.id} session=${attempt.id}`,
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `Guidance report backfill failed: attempt=${attempt.id}: ${String(error)}`,
      );
      throw error;
    }
  }

  private scoreReadyDispatchPayloadFromResult(
    result: AssessmentResult,
  ): ScoreReadyDispatchPayload | null {
    if (!result.tier) {
      this.logger.warn(
        `Score-ready notification skipped: missing tier for attempt=${result.attempt_id}`,
      );
      return null;
    }

    return {
      score: result.score ?? 0,
      maxScore: result.max_score ?? 100,
      percentage: result.percentage ?? 0,
      tier: result.tier,
    };
  }

  private dispatchScoreReadyNotification(
    userId: string,
    payload: ScoreReadyDispatchPayload,
  ): void {
    void this.notificationDispatch.dispatch(
      NotificationType.ADVANCED_ASSESSMENT_SCORE_READY,
      userId,
      payload,
    );
  }

  private scoredTextAnswersFromAssessmentScores(
    scoreRows: AssessmentScore[],
  ): ScoredTextAnswer[] {
    return scoreRows
      .filter((row) => row.question_type !== AssessmentScoreQuestionType.MCQ)
      .map((row) => {
        const evalJson = row.ai_evaluation_json ?? {};
        return {
          question_id: row.question_id,
          raw_score: row.raw_score,
          max_score: row.max_score,
          rubric: {
            relevance: Number(evalJson.relevance) || 0,
            reasoning: Number(evalJson.reasoning) || 0,
            specificity: Number(evalJson.specificity) || 0,
            completeness: Number(evalJson.completeness) || 0,
            total: row.raw_score,
            feedback:
              typeof evalJson.feedback === 'string' ? evalJson.feedback : '',
          },
        };
      });
  }

  private async persistGuidanceReport(
    resultLookup: { id: string } | { attempt_id: string },
    input: Parameters<GuidanceReportService['generate']>[0],
  ): Promise<void> {
    const generated = await this.guidanceReport.generate(input);
    await this.resultRepo.update(resultLookup, {
      guidance_report: { ...generated },
    });
  }

  private async validateSubmitForEnqueue(
    userId: string,
    dto: SubmitAdvancedAssessmentDto,
  ): Promise<{
    profile: TalentProfile;
    attempt: AssessmentAttempt;
    sessionQuestions: AdvancedAssessmentGeneratedQuestion[];
  }> {
    const profile = await this.talentProfileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      throw new NotFoundException(
        ErrorMessages.ADVANCED_ASSESSMENT.PROFILE_NOT_FOUND,
      );
    }
    this.assertAdvancedRetakeUnlocked(profile);

    const attempt = await this.attemptRepo.findOne({
      where: {
        id: dto.sessionId,
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.ADVANCED,
      },
    });
    if (!attempt) {
      throw new NotFoundException(
        ErrorMessages.ADVANCED_ASSESSMENT.ATTEMPT_NOT_FOUND,
      );
    }
    if (attempt.completed_at) {
      throw new BadRequestException(
        ErrorMessages.ADVANCED_ASSESSMENT.ATTEMPT_ALREADY_SUBMITTED,
      );
    }
    if (attempt.force_submitted) {
      throw new BadRequestException(
        ErrorMessages.ADVANCED_ASSESSMENT.SESSION_VOIDED,
      );
    }
    if (attempt.expires_at && attempt.expires_at <= new Date()) {
      throw new ForbiddenException({
        error: 'SESSION_EXPIRED',
        message: ErrorMessages.ADVANCED_ASSESSMENT.SESSION_EXPIRED,
      });
    }
    if (this.isAdvancedSubmitInFlight(attempt)) {
      throw new BadRequestException(
        ErrorMessages.ADVANCED_ASSESSMENT.ATTEMPT_ALREADY_SUBMITTED,
      );
    }

    const sessionQuestions = this.readSessionQuestions(attempt);
    if (sessionQuestions.length === 0) {
      throw new BadRequestException(
        ErrorMessages.ADVANCED_ASSESSMENT.SESSION_CORRUPT,
      );
    }

    return { profile, attempt, sessionQuestions };
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
        ErrorMessages.ADVANCED_ASSESSMENT.PROFILE_NOT_FOUND,
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
            assessment_type: AssessmentType.ADVANCED,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!attempt) {
          throw new NotFoundException(
            ErrorMessages.ADVANCED_ASSESSMENT.ATTEMPT_NOT_FOUND,
          );
        }
        if (attempt.completed_at || attempt.force_submitted) {
          throw new BadRequestException(
            ErrorMessages.ADVANCED_ASSESSMENT.ATTEMPT_ALREADY_SUBMITTED,
          );
        }
        if (attempt.expires_at && attempt.expires_at <= new Date()) {
          throw new ForbiddenException({
            error: 'SESSION_EXPIRED',
            message: ErrorMessages.ADVANCED_ASSESSMENT.SESSION_EXPIRED,
          });
        }

        await manager.increment(
          AssessmentAttempt,
          {
            id: attempt.id,
            talent_profile_id: profile.id,
            assessment_type: AssessmentType.ADVANCED,
          },
          counterField,
          1,
        );

        const tabSwitchCount =
          attempt.tab_switch_count +
          (counterField === 'tab_switch_count' ? 1 : 0);
        const copyPasteCount =
          attempt.copy_paste_count +
          (counterField === 'copy_paste_count' ? 1 : 0);

        const lockedFrom = new Date();
        const unlocksAt = new Date(lockedFrom);
        unlocksAt.setDate(unlocksAt.getDate() + RETAKE_GATE_DAYS);

        await manager.update(
          AssessmentAttempt,
          { id: attempt.id },
          { force_submitted: true, completed_at: new Date() },
        );
        await manager.update(
          TalentProfile,
          { id: profile.id },
          {
            assessment_locked_from: lockedFrom,
            assessment_locked_until: unlocksAt,
            advanced_retake_required: true,
          },
        );

        return {
          attemptId: attempt.id,
          tabSwitchCount,
          copyPasteCount,
        };
      },
    );

    this.logger.warn(
      `Session voided - integrity ${dto.eventType}: attempt=${result.attemptId} user=${userId}`,
    );

    return {
      status: 'voided',
      message: ErrorMessages.ADVANCED_ASSESSMENT.SESSION_VOIDED,
      tabSwitchCount: result.tabSwitchCount,
      copyPasteCount: result.copyPasteCount,
      sessionVoided: true,
      action: 'logout',
    };
  }

  private scoreMcq(
    question: AdvancedAssessmentGeneratedQuestion,
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

  private resolveTier(
    percentage: number,
    mcqGatePassed = true,
  ): AssessmentTier {
    if (percentage < 50) return AssessmentTier.NOT_READY;
    if (percentage >= 75 && mcqGatePassed) return AssessmentTier.JOB_READY;
    return AssessmentTier.EMERGING;
  }

  private toWeightedAssessmentScore(
    mcqScore: number,
    mcqMaxScore: number,
    textScore: number,
    textMaxScore: number,
    mcqWeight: number,
  ): { score: number; maxScore: number; percentage: number } {
    const hasMcq = mcqMaxScore > 0;
    const hasText = textMaxScore > 0;
    if (!hasMcq && !hasText) {
      return { score: 0, maxScore: 0, percentage: 0 };
    }

    const mcqPercentage = mcqMaxScore > 0 ? (mcqScore / mcqMaxScore) * 100 : 0;
    const textPercentage =
      textMaxScore > 0 ? (textScore / textMaxScore) * 100 : 0;
    let percentage: number;

    if (hasMcq && hasText) {
      percentage = Math.round(
        mcqPercentage * mcqWeight + textPercentage * (1 - mcqWeight),
      );
    } else {
      percentage = Math.round(hasMcq ? mcqPercentage : textPercentage);
    }

    return {
      score: percentage,
      maxScore: 100,
      percentage,
    };
  }

  private tierToProfileStatus(tier: AssessmentTier): TalentProfileStatus {
    if (tier === AssessmentTier.JOB_READY) {
      return TalentProfileStatus.JOB_READY;
    }
    return TalentProfileStatus.EMERGING;
  }

  /**
   * Integrity confidence:
   *   abnormal long-text timing -> low
   *   any tab switch OR any copy-paste -> medium
   *   otherwise -> high
   */
  private resolveIntegrityConfidence(
    tabSwitchCount: number,
    copyPasteCount: number,
    hasAbnormalTiming: boolean,
  ): IntegrityConfidenceLevel {
    if (hasAbnormalTiming) return 'low';
    if (tabSwitchCount >= 1 || copyPasteCount >= 1) return 'medium';
    return 'high';
  }

  private isAdvancedSubmitInFlight(attempt: AssessmentAttempt): boolean {
    if (attempt.completed_at || attempt.force_submitted) {
      return false;
    }
    const enqueuedAt =
      this.readSessionPayload(attempt).context?.submit_enqueued_at;
    return typeof enqueuedAt === 'string' && enqueuedAt.length > 0;
  }

  private async findInFlightAdvancedSubmit(
    manager: EntityManager,
    talentProfileId: string,
    excludeAttemptId?: string,
  ): Promise<AssessmentAttempt | null> {
    const query = manager
      .createQueryBuilder(AssessmentAttempt, 'attempt')
      .where('attempt.talent_profile_id = :talentProfileId', {
        talentProfileId,
      })
      .andWhere('attempt.assessment_type = :assessmentType', {
        assessmentType: AssessmentType.ADVANCED,
      })
      .andWhere('attempt.completed_at IS NULL')
      .andWhere('attempt.force_submitted = false')
      .andWhere(
        "attempt.generated_questions_json -> 'context' ->> 'submit_enqueued_at' IS NOT NULL",
      )
      .andWhere(
        "length(attempt.generated_questions_json -> 'context' ->> 'submit_enqueued_at') > 0",
      );

    if (excludeAttemptId) {
      query.andWhere('attempt.id != :excludeAttemptId', { excludeAttemptId });
    }

    return query.getOne() ?? null;
  }

  private buildAdvancedSubmitProcessingConflict(
    sessionId: string,
  ): ConflictException {
    return new ConflictException({
      error: 'ADVANCED_SUBMIT_PROCESSING',
      message: ErrorMessages.ADVANCED_ASSESSMENT.SUBMIT_PROCESSING,
      session_id: sessionId,
    });
  }

  private withSubmitEnqueuedAt(
    attempt: AssessmentAttempt,
    enqueuedAt: string,
  ): Record<string, any> {
    const payload = this.readSessionPayload(attempt);
    return {
      ...payload,
      context: {
        ...(payload.context ?? {}),
        submit_enqueued_at: enqueuedAt,
      },
      questions: payload.questions,
    };
  }

  private async clearSubmitEnqueuedAt(sessionId: string): Promise<void> {
    const attempt = await this.attemptRepo.findOne({
      where: { id: sessionId },
    });
    if (!attempt?.generated_questions_json) {
      return;
    }

    const payload = this.readSessionPayload(attempt);
    const context = { ...(payload.context ?? {}) };
    delete context.submit_enqueued_at;

    const clearedPayload = {
      ...payload,
      context,
      questions: payload.questions,
    };

    attempt.generated_questions_json = clearedPayload as Record<string, any>;
    await this.attemptRepo.save(attempt);
  }

  private assertAdvancedRetakeUnlocked(profile: TalentProfile): void {
    if (
      !profile.assessment_locked_until ||
      profile.assessment_locked_until <= new Date()
    ) {
      return;
    }

    throw new ForbiddenException(
      this.buildAdvancedRetakeLockedResponse(profile),
    );
  }

  private buildAdvancedRetakeLockedResponse(
    profile: TalentProfile,
  ): Record<string, unknown> {
    const probationEndsAt = profile.assessment_locked_until as Date;
    const probationStartedAt =
      profile.assessment_locked_from ??
      new Date(
        probationEndsAt.getTime() - RETAKE_GATE_DAYS * 24 * 60 * 60 * 1000,
      );

    return {
      error: 'ADVANCED_RETAKE_LOCKED',
      message: ErrorMessages.ADVANCED_ASSESSMENT.RETAKE_LOCKED(
        probationEndsAt.toISOString(),
      ),
      probation_started_at: probationStartedAt.toISOString(),
      probation_ends_at: probationEndsAt.toISOString(),
      remaining_seconds: Math.max(
        0,
        Math.ceil((probationEndsAt.getTime() - Date.now()) / 1000),
      ),
    };
  }

  /**
   * Pulls competency labels from the question metadata (track taxonomy)
   * for use in the guidance report. Strong = >=70% on the rubric, weak =
   * <50%. Dedupes + filters against the taxonomy for the candidate's track.
   */
  private extractCompetencies(
    sessionQuestions: AdvancedAssessmentGeneratedQuestion[],
    scored: ScoredTextAnswer[],
    track: string | null,
    band: 'strong' | 'weak',
  ): string[] {
    const competencyByQuestion = new Map<string, string | null>();
    for (const question of sessionQuestions) {
      competencyByQuestion.set(
        question.question_id,
        resolveQuestionCompetency({ metadata: question.metadata }),
      );
    }

    const minRatio = band === 'strong' ? 0.7 : 0;
    const maxRatio = band === 'strong' ? 1.01 : 0.5;

    const raw: string[] = [];
    for (const score of scored) {
      if (score.max_score <= 0) continue;
      const ratio = score.raw_score / score.max_score;
      if (ratio < minRatio || ratio >= maxRatio) continue;
      const competency = competencyByQuestion.get(score.question_id);
      if (competency) raw.push(competency);
    }

    return sanitiseCompetencyList(track, raw);
  }

  /**
   * Builds one assessment_scores row per session question.
   * - MCQ rows: raw_score = 1 if correct else 0, max_score = 1, no rubric.
   * - Text rows: raw_score/max_score come from the rubric output.
   * - integrity_flag = true on a per-question basis when abnormal timing
   *   was detected on that specific text answer.
   * - integrity_confidence = the attempt-level confidence.
   */
  private buildAssessmentScoreRows(input: {
    attempt: AssessmentAttempt;
    talentProfileId: string;
    sessionQuestions: AdvancedAssessmentGeneratedQuestion[];
    scoredByQuestion: Map<string, ScoredTextAnswer>;
    abnormalTimingByQuestion: Map<string, boolean>;
    integrityConfidence: IntegrityConfidenceLevel;
    answerMap: Map<string, { answer: string | string[] }>;
    mcqCorrectMap: Map<string, boolean>;
  }): Partial<AssessmentScore>[] {
    const rows: Partial<AssessmentScore>[] = [];
    const {
      attempt,
      talentProfileId,
      sessionQuestions,
      scoredByQuestion,
      abnormalTimingByQuestion,
      integrityConfidence,
      answerMap: _answerMap,
      mcqCorrectMap,
    } = input;

    for (const question of sessionQuestions) {
      const competency = resolveQuestionCompetency({
        metadata: question.metadata,
      });
      const isMcq =
        question.question_type === QuestionType.SINGLE_PICK ||
        question.question_type === QuestionType.MULTI_PICK;

      if (isMcq) {
        const correct = mcqCorrectMap.get(question.question_id) ?? false;
        rows.push({
          attempt_id: attempt.id,
          talent_profile_id: talentProfileId,
          question_id: question.question_id,
          question_type: AssessmentScoreQuestionType.MCQ,
          raw_score: correct ? 1 : 0,
          max_score: 1,
          pct_score: correct ? 100 : 0,
          competency,
          integrity_flag: false,
          integrity_confidence: integrityConfidence,
          ai_evaluation_json: null,
        });
        continue;
      }

      const scored = scoredByQuestion.get(question.question_id);
      const rawScore = scored?.raw_score ?? 0;
      const maxScore = scored?.max_score ?? TEXT_FULL_RUBRIC_MAX;
      const pctScore = maxScore > 0 ? (rawScore / maxScore) * 100 : 0;
      const integrityFlag =
        abnormalTimingByQuestion.get(question.question_id) === true;

      rows.push({
        attempt_id: attempt.id,
        talent_profile_id: talentProfileId,
        question_id: question.question_id,
        question_type:
          question.block === 'long_text'
            ? AssessmentScoreQuestionType.LONG_TEXT
            : AssessmentScoreQuestionType.SHORT_TEXT,
        raw_score: rawScore,
        max_score: maxScore,
        pct_score: Math.round(pctScore * 100) / 100,
        competency,
        integrity_flag: integrityFlag,
        integrity_confidence: integrityConfidence,
        ai_evaluation_json: scored?.rubric ? { ...scored.rubric } : null,
      });
    }

    return rows;
  }

  private resolveSessionTimerState(
    attempt: AssessmentAttempt,
    expiresAt: Date,
  ): { remaining_seconds: number; is_expired: boolean } {
    if (attempt.completed_at) {
      return { remaining_seconds: 0, is_expired: true };
    }

    if (this.isAdvancedSubmitInFlight(attempt)) {
      const wallExpired = expiresAt.getTime() <= Date.now();
      return { remaining_seconds: 0, is_expired: wallExpired };
    }

    const remaining_seconds = Math.max(
      0,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    );

    return {
      remaining_seconds,
      is_expired: remaining_seconds === 0,
    };
  }

  private remainingSeconds(attempt: AssessmentAttempt): number {
    if (!attempt.expires_at) {
      return 0;
    }

    return this.resolveSessionTimerState(attempt, attempt.expires_at)
      .remaining_seconds;
  }

  private assertTextLength(
    question: AdvancedAssessmentGeneratedQuestion,
    answer: string,
  ): void {
    const trimmed = answer.trim();
    if (!trimmed) {
      return;
    }

    if (question.block === 'short_text') {
      if (
        trimmed.length < ADVANCED_SHORT_TEXT_MIN_CHARS ||
        trimmed.length > ADVANCED_SHORT_TEXT_MAX_CHARS
      ) {
        throw new UnprocessableEntityException(
          `Question ${question.question_number} must be between ${ADVANCED_SHORT_TEXT_MIN_CHARS} and ${ADVANCED_SHORT_TEXT_MAX_CHARS} characters`,
        );
      }
      return;
    }

    if (
      trimmed.length < ADVANCED_LONG_TEXT_MIN_CHARS ||
      trimmed.length > ADVANCED_LONG_TEXT_MAX_CHARS
    ) {
      throw new UnprocessableEntityException(
        `Question ${question.question_number} must be between ${ADVANCED_LONG_TEXT_MIN_CHARS} and ${ADVANCED_LONG_TEXT_MAX_CHARS} characters`,
      );
    }
  }

  private async findLatestSkillResult(
    manager: EntityManager,
    talentProfileId: string,
  ): Promise<AssessmentResult | null> {
    return manager
      .createQueryBuilder(AssessmentResult, 'result')
      .innerJoin(AssessmentAttempt, 'attempt', 'attempt.id = result.attempt_id')
      .where('attempt.talent_profile_id = :talentProfileId', {
        talentProfileId,
      })
      .andWhere('attempt.assessment_type = :assessmentType', {
        assessmentType: AssessmentType.SKILL,
      })
      .andWhere('result.validated_level IS NOT NULL')
      .orderBy('attempt.completed_at', 'DESC', 'NULLS LAST')
      .addOrderBy('result.created_at', 'DESC')
      .getOne();
  }

  private async findEligibleQuestions(
    manager: EntityManager,
    profile: TalentProfile,
  ): Promise<AssessmentQuestion[]> {
    const verifiedLevel = profile.validated_level ?? VerifiedLevel.JUNIOR;
    const track = profile.track ?? 'general';
    const historyExclusion = `NOT EXISTS (
      SELECT 1
      FROM talent_question_history history
      INNER JOIN assessment_attempts attempt
        ON attempt.id = history.attempt_id
      WHERE history.question_id = question.id
      AND history.talent_profile_id = :talentProfileId
      AND (
        attempt.completed_at IS NOT NULL
        OR attempt.force_submitted = true
      )
    )`;

    const live = await manager
      .createQueryBuilder(AssessmentQuestion, 'question')
      .where('question.assessment_type = :assessmentType', {
        assessmentType: AssessmentType.ADVANCED,
      })
      .andWhere('question.is_live = true')
      .andWhere('question.track = :track', { track })
      .andWhere('question.verified_level = :verifiedLevel', { verifiedLevel })
      .andWhere(historyExclusion, { talentProfileId: profile.id })
      .orderBy('RANDOM()')
      .getMany();

    const generated = await manager
      .createQueryBuilder(AssessmentQuestion, 'question')
      .where('question.assessment_type = :assessmentType', {
        assessmentType: AssessmentType.ADVANCED,
      })
      .andWhere('question.is_live = false')
      .andWhere('question.track = :track', { track })
      .andWhere('question.verified_level = :verifiedLevel', { verifiedLevel })
      .andWhere(historyExclusion, { talentProfileId: profile.id })
      .orderBy('RANDOM()')
      .getMany();

    return [...live, ...generated];
  }

  private async selectQuestionBlocks(
    manager: EntityManager,
    profile: TalentProfile,
    personalContext: Record<string, unknown>,
    questions: AssessmentQuestion[],
  ): Promise<AdvancedQuestionBank> {
    const bankMcq = questions.filter((question) => this.isMcq(question));
    const bankText = questions.filter((question) => !this.isMcq(question));
    const bankShort = bankText.filter(
      (question) => this.textBlock(question) === 'short_text',
    );
    // Long-text base = 2 SITUATIONAL (LT-1) + 3 WORK_TASK (LT-2).
    const bankLongSituational = bankText.filter(
      (question) =>
        this.textBlock(question) === 'long_text' &&
        question.slot_type === SlotType.SITUATIONAL,
    );
    const bankLongWorkTask = bankText.filter(
      (question) =>
        this.textBlock(question) === 'long_text' &&
        question.slot_type === SlotType.WORK_TASK,
    );

    const mcq = [...bankMcq.slice(0, ADVANCED_ASSESSMENT_MCQ_COUNT)];
    const shortText = [
      ...bankShort.slice(0, ADVANCED_ASSESSMENT_SHORT_TEXT_COUNT),
    ];
    const longSituational = [
      ...bankLongSituational.slice(0, ADVANCED_LT1_COUNT),
    ];
    const longWorkTask = [...bankLongWorkTask.slice(0, ADVANCED_LT2_COUNT)];

    const generatedQuestions: Array<
      GeneratedQuestion & { block: 'mcq' | 'short_text' | 'long_text' }
    > = [];
    const industryContext = resolveIndustryContext(personalContext);
    const competencyHint = resolveCompetencyHint(personalContext);
    const verifiedLevel = profile.validated_level ?? VerifiedLevel.JUNIOR;
    const track = profile.track ?? 'general';

    const mcqDeficit = ADVANCED_ASSESSMENT_MCQ_COUNT - mcq.length;
    if (mcqDeficit > 0) {
      const generated = await this.safeGenerateQuestions({
        track,
        verified_level: verifiedLevel,
        assessment_type: 'advanced',
        question_type: QuestionType.SINGLE_PICK,
        slot_type: SlotType.WORK_TASK,
        competency: competencyHint,
        industry_context: industryContext,
        count: mcqDeficit,
      });
      generatedQuestions.push(
        ...generated.map((question) => ({
          ...question,
          block: 'mcq' as const,
        })),
      );
    }

    const shortDeficit =
      ADVANCED_ASSESSMENT_SHORT_TEXT_COUNT - shortText.length;
    if (shortDeficit > 0) {
      const generated = await this.safeGenerateQuestions({
        track,
        verified_level: verifiedLevel,
        assessment_type: 'advanced',
        question_type: QuestionType.REQUIRED_TEXT,
        slot_type: SlotType.SITUATIONAL,
        competency: competencyHint,
        industry_context: industryContext,
        count: shortDeficit,
      });
      generatedQuestions.push(
        ...generated.map((question) => ({
          ...question,
          block: 'short_text' as const,
        })),
      );
    }

    const situationalDeficit = ADVANCED_LT1_COUNT - longSituational.length;
    if (situationalDeficit > 0) {
      this.logger.warn(
        `[BANK_LOW] LT-1 (SITUATIONAL) deficit=${situationalDeficit} track=${track} level=${verifiedLevel}`,
      );
      const generated = await this.safeGenerateQuestions({
        track,
        verified_level: verifiedLevel,
        assessment_type: 'advanced',
        question_type: QuestionType.OPTIONAL_TEXT,
        slot_type: SlotType.SITUATIONAL,
        competency: competencyHint,
        industry_context: industryContext,
        count: situationalDeficit,
      });
      generatedQuestions.push(
        ...generated.map((question) => ({
          ...question,
          slot_type: SlotType.SITUATIONAL,
          block: 'long_text' as const,
        })),
      );
    }

    const workTaskDeficit = ADVANCED_LT2_COUNT - longWorkTask.length;
    if (workTaskDeficit > 0) {
      this.logger.warn(
        `[BANK_LOW] LT-2 (WORK_TASK) deficit=${workTaskDeficit} track=${track} level=${verifiedLevel}`,
      );
      const generated = await this.safeGenerateQuestions({
        track,
        verified_level: verifiedLevel,
        assessment_type: 'advanced',
        question_type: QuestionType.OPTIONAL_TEXT,
        slot_type: SlotType.WORK_TASK,
        competency: competencyHint,
        industry_context: industryContext,
        count: workTaskDeficit,
      });
      generatedQuestions.push(
        ...generated.map((question) => ({
          ...question,
          slot_type: SlotType.WORK_TASK,
          block: 'long_text' as const,
        })),
      );
    }

    const persistedGenerated = await this.persistGeneratedQuestions(
      manager,
      track,
      verifiedLevel,
      generatedQuestions,
    );

    const generatedMcq = persistedGenerated.filter((question) =>
      this.isMcq(question),
    );
    const generatedShort = persistedGenerated.filter(
      (question) =>
        !this.isMcq(question) && this.textBlock(question) === 'short_text',
    );
    const generatedSituational = persistedGenerated.filter(
      (question) =>
        !this.isMcq(question) &&
        this.textBlock(question) === 'long_text' &&
        question.slot_type === SlotType.SITUATIONAL,
    );
    const generatedWorkTask = persistedGenerated.filter(
      (question) =>
        !this.isMcq(question) &&
        this.textBlock(question) === 'long_text' &&
        question.slot_type === SlotType.WORK_TASK,
    );

    // Long text is ordered LT-1, LT-1, LT-2, LT-2.
    const longText: AssessmentQuestion[] = [
      ...longSituational,
      ...generatedSituational,
    ]
      .slice(0, ADVANCED_LT1_COUNT)
      .concat(
        [...longWorkTask, ...generatedWorkTask].slice(0, ADVANCED_LT2_COUNT),
      );

    return {
      mcq: [...mcq, ...generatedMcq].slice(0, ADVANCED_ASSESSMENT_MCQ_COUNT),
      shortText: [...shortText, ...generatedShort].slice(
        0,
        ADVANCED_ASSESSMENT_SHORT_TEXT_COUNT,
      ),
      longText,
    };
  }

  private async safeGenerateQuestions(
    input: GenerateQuestionsInput,
  ): Promise<GeneratedQuestion[]> {
    try {
      return await this.questionGeneration.generateQuestions(input);
    } catch (error) {
      this.logger.error(
        `[BANK_LOW] AI generation failed for count=${input.count} question_type=${input.question_type} slot_type=${input.slot_type}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async persistGeneratedQuestions(
    manager: EntityManager,
    track: string,
    verifiedLevel: VerifiedLevel,
    generated: Array<
      GeneratedQuestion & { block: 'mcq' | 'short_text' | 'long_text' }
    >,
  ): Promise<AssessmentQuestion[]> {
    if (generated.length === 0) {
      return [];
    }

    const nextQuestionNumber = await this.nextAdvancedQuestionNumber(manager);
    const trackHasTaxonomy = competenciesForTrack(track).length > 0;

    const questions = generated.map((question, index) => {
      // Validate AI-generated competency against the track taxonomy. If
      // the model returned junk (or the track is unknown), fall back to
      // the first valid competency for the track.
      const normalisedCompetency = trackHasTaxonomy
        ? normaliseCompetency(track, question.competency)
        : (question.competency ?? null);
      const slotType =
        question.slot_type ??
        (question.block === 'long_text'
          ? SlotType.WORK_TASK
          : SlotType.SITUATIONAL);

      return manager.create(AssessmentQuestion, {
        assessment_type: AssessmentType.ADVANCED,
        question_type: question.question_type,
        question_text: question.question_text,
        question_number: nextQuestionNumber + index,
        options: question.options,
        correct_answer: question.correct_answer,
        track,
        verified_level: verifiedLevel,
        competency: normalisedCompetency,
        slot_type: slotType,
        metadata: this.buildGeneratedQuestionMetadata({
          track,
          verifiedLevel,
          questionType: question.question_type,
          competency: normalisedCompetency,
          slotType,
          block: question.block,
          industryContext: question.industry_context,
        }),
        is_live: false,
      });
    });

    return manager.save(AssessmentQuestion, questions);
  }

  private buildGeneratedQuestionMetadata(input: {
    track: string;
    verifiedLevel: VerifiedLevel;
    questionType: QuestionType;
    competency: string | null;
    slotType: SlotType;
    block: 'mcq' | 'short_text' | 'long_text';
    industryContext: string | null;
  }): Record<string, unknown> {
    const isTextQuestion =
      input.questionType === QuestionType.REQUIRED_TEXT ||
      input.questionType === QuestionType.OPTIONAL_TEXT;

    return {
      difficulty: metadataDifficulty(input.verifiedLevel),
      estimated_time_seconds: isTextQuestion ? 600 : 90,
      tags: [
        'generated',
        'advanced',
        input.track,
        input.verifiedLevel,
        input.competency,
        input.slotType,
        input.block,
      ].filter((tag): tag is string => Boolean(tag)),
      generated: true,
      answer_block: input.block,
      lt3_reflection: input.slotType === SlotType.REFLECTION,
      industry_context: input.industryContext,
      track: input.track,
      verified_level: input.verifiedLevel,
      competency: input.competency,
    };
  }

  private async nextAdvancedQuestionNumber(
    manager: EntityManager,
  ): Promise<number> {
    const row = await manager
      .createQueryBuilder(AssessmentQuestion, 'question')
      .select('MAX(question.question_number)', 'max')
      .where('question.assessment_type = :assessmentType', {
        assessmentType: AssessmentType.ADVANCED,
      })
      .getRawOne<{ max: string | null }>();

    return Number(row?.max ?? 0) + 1;
  }

  private isMcq(question: AssessmentQuestion): boolean {
    return (
      question.question_type === QuestionType.SINGLE_PICK ||
      question.question_type === QuestionType.MULTI_PICK
    );
  }

  private textBlock(question: AssessmentQuestion): 'short_text' | 'long_text' {
    const metadata = question.metadata ?? {};
    const marker = String(
      metadata.answer_block ??
        metadata.response_block ??
        metadata.answer_length ??
        metadata.expected_response_length ??
        metadata.expectedAnswerLength ??
        '',
    ).toLowerCase();

    if (marker.includes('long')) return 'long_text';
    if (marker.includes('short')) return 'short_text';

    return question.question_type === QuestionType.OPTIONAL_TEXT
      ? 'long_text'
      : 'short_text';
  }

  private throwAdvancedBankExhausted(
    profile: TalentProfile,
    gotQuestions: number,
  ): never {
    this.bankExhaustedAlert.notify({
      assessmentType: 'advanced',
      detail: `Expected ${ADVANCED_ASSESSMENT_BASE_QUESTIONS} questions but assembled ${gotQuestions}`,
      talentProfileId: profile.id,
      userId: profile.user_id,
      track: profile.track,
      verifiedLevel: profile.validated_level,
      expectedQuestions: ADVANCED_ASSESSMENT_BASE_QUESTIONS,
      gotQuestions,
    });
    throw new ServiceUnavailableException({
      error: 'BANK_EXHAUSTED',
      message: ErrorMessages.ADVANCED_ASSESSMENT.BANK_EXHAUSTED,
      track: profile.track ?? null,
      verified_level: profile.validated_level ?? null,
      expected_questions: ADVANCED_ASSESSMENT_BASE_QUESTIONS,
      got_questions: gotQuestions,
    });
  }

  private toSessionResult(
    attempt: AssessmentAttempt,
    message: string,
  ): AdvancedAssessmentSessionResult {
    const questions = this.readSessionQuestions(attempt);
    const expiresAt = attempt.expires_at;

    if (!expiresAt || questions.length === 0) {
      throw new ServiceUnavailableException(
        ErrorMessages.ADVANCED_ASSESSMENT.SESSION_CORRUPT,
      );
    }

    const timer = this.resolveSessionTimerState(attempt, expiresAt);
    const mcqCount = questions.filter(
      (question) => question.block === 'mcq',
    ).length;
    const openTextCount = questions.filter(
      (question) =>
        question.block === 'short_text' || question.block === 'long_text',
    ).length;

    return {
      status: 'success',
      message,
      session_id: attempt.id,
      started_at: attempt.started_at.toISOString(),
      expires_at: expiresAt.toISOString(),
      completed_at: attempt.completed_at?.toISOString() ?? null,
      is_expired: timer.is_expired,
      remaining_seconds: timer.remaining_seconds,
      verified_level: this.readSessionVerifiedLevel(attempt),
      question_count: questions.length,
      mcq_count: mcqCount,
      open_text_count: openTextCount,
      pending_lt3: false,
      questions,
    };
  }

  private readSessionPayload(
    attempt: AssessmentAttempt,
  ): AdvancedAssessmentSessionPayload {
    const payload = attempt.generated_questions_json;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      this.logger.warn(
        `Session payload corrupt for attempt ${attempt.id}: type=${typeof payload} isArray=${Array.isArray(payload)}`,
      );
      return {};
    }
    return payload as AdvancedAssessmentSessionPayload;
  }

  private readSessionVerifiedLevel(attempt: AssessmentAttempt): string {
    const verifiedLevel =
      this.readSessionPayload(attempt).context?.verified_level;
    return typeof verifiedLevel === 'string' ? verifiedLevel : '';
  }

  private readSessionQuestions(
    attempt: AssessmentAttempt,
  ): AdvancedAssessmentGeneratedQuestion[] {
    const questions = this.readSessionPayload(attempt).questions;
    return Array.isArray(questions)
      ? (questions as AdvancedAssessmentGeneratedQuestion[])
      : [];
  }
}
