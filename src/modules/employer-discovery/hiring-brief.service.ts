import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { HiringBrief } from '../ai/ai.schemas';
import { HiringBriefGeneratorService } from '../ai/hiring-brief.service';
import {
  AssessmentAttempt,
  AssessmentResponse,
  AssessmentResult,
  AssessmentScore,
  AssessmentType,
} from '../assessments/entities';
import { TalentProfile } from '../talent/entities/talent-profile.entity';
import { CandidateHiringBrief } from './entities/candidate-hiring-brief.entity';
import {
  BriefAssessmentKind,
  BriefResponseRow,
  BriefScoreRow,
  BriefSource,
  buildHiringBriefInput,
} from './hiring-brief-input';

export type HiringBriefStats = {
  skill_percentage: number | null;
  job_ready_percentage: number | null;
  job_ready_tier: string | null;
  competencies: {
    assessment: BriefAssessmentKind;
    name: string;
    score: number;
    questions: number;
  }[];
  open_answers_reviewed: number;
  questions_missed: number;
};

export type HiringBriefResponse =
  | { status: 'ready'; brief: HiringBrief; stats: HiringBriefStats }
  | { status: 'generating' | 'unavailable' | 'no_assessment' };

/** How long to leave a candidate alone after a failed generation. */
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

type LatestResult = { result: AssessmentResult; attemptId: string };

@Injectable()
export class HiringBriefService {
  private readonly logger = new Logger(HiringBriefService.name);
  private readonly inFlight = new Set<string>();
  private readonly failedAt = new Map<string, number>();

  constructor(
    @InjectRepository(TalentProfile)
    private readonly profileRepo: Repository<TalentProfile>,
    @InjectRepository(AssessmentResult)
    private readonly resultRepo: Repository<AssessmentResult>,
    @InjectRepository(CandidateHiringBrief)
    private readonly briefRepo: Repository<CandidateHiringBrief>,
    private readonly generator: HiringBriefGeneratorService,
  ) {}

  async getBrief(candidateUserId: string): Promise<HiringBriefResponse> {
    const profile = await this.profileRepo.findOne({
      where: { user_id: candidateUserId },
    });
    if (!profile) return { status: 'no_assessment' };

    const [skill, advanced] = await Promise.all([
      this.latestResult(profile.id, AssessmentType.SKILL),
      this.latestResult(profile.id, AssessmentType.ADVANCED),
    ]);
    if (!skill && !advanced) return { status: 'no_assessment' };

    const sourceKey = `${skill?.result.id ?? '-'}:${advanced?.result.id ?? '-'}`;
    const cached = await this.briefRepo.findOne({
      where: { talent_profile_id: profile.id },
    });
    if (cached && cached.source_key === sourceKey) {
      return {
        status: 'ready',
        brief: cached.brief as HiringBrief,
        stats: cached.stats as HiringBriefStats,
      };
    }

    if (this.inFlight.has(profile.id)) return { status: 'generating' };
    const failed = this.failedAt.get(profile.id);
    if (failed && Date.now() - failed < FAILURE_COOLDOWN_MS) {
      return cached
        ? {
            status: 'ready',
            brief: cached.brief as HiringBrief,
            stats: cached.stats as HiringBriefStats,
          }
        : { status: 'unavailable' };
    }

    this.inFlight.add(profile.id);
    void this.generateAndStore(profile, skill, advanced, sourceKey).finally(
      () => this.inFlight.delete(profile.id),
    );
    return { status: 'generating' };
  }

  private async generateAndStore(
    profile: TalentProfile,
    skill: LatestResult | null,
    advanced: LatestResult | null,
    sourceKey: string,
  ): Promise<void> {
    try {
      const source = await this.collectSource(profile, skill, advanced);
      const input = buildHiringBriefInput(source);
      const brief = await this.generator.generate(input);
      const stats: HiringBriefStats = {
        skill_percentage: source.skill?.percentage ?? null,
        job_ready_percentage: source.job_ready?.percentage ?? null,
        job_ready_tier: source.job_ready?.tier ?? null,
        competencies: input.competencies,
        open_answers_reviewed: input.open_answers.length,
        questions_missed: source.responses.filter((r) => r.is_correct === false)
          .length,
      };
      await this.briefRepo.upsert(
        {
          talent_profile_id: profile.id,
          source_key: sourceKey,
          brief: brief as never,
          stats: stats as never,
        },
        ['talent_profile_id'],
      );
      this.failedAt.delete(profile.id);
    } catch (error: unknown) {
      this.failedAt.set(profile.id, Date.now());
      this.logger.error(
        `Hiring brief failed for profile=${profile.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async collectSource(
    profile: TalentProfile,
    skill: LatestResult | null,
    advanced: LatestResult | null,
  ): Promise<BriefSource> {
    const kindByAttempt = new Map<string, BriefAssessmentKind>();
    if (skill) kindByAttempt.set(skill.attemptId, 'skill');
    if (advanced) kindByAttempt.set(advanced.attemptId, 'job_ready');
    const attemptIds = [...kindByAttempt.keys()];
    const manager = this.resultRepo.manager;

    const [scoreRows, responseRows] = await Promise.all([
      manager.find(AssessmentScore, { where: { attempt_id: In(attemptIds) } }),
      manager.find(AssessmentResponse, {
        where: { attempt_id: In(attemptIds) },
        relations: { question: true },
        order: { answered_at: 'ASC' },
      }),
    ]);

    const scores: BriefScoreRow[] = scoreRows.map((s) => ({
      assessment: kindByAttempt.get(s.attempt_id) ?? 'skill',
      competency: s.competency,
      pct_score: s.pct_score,
    }));
    const responses: BriefResponseRow[] = responseRows.map((r) => ({
      assessment: kindByAttempt.get(r.attempt_id) ?? 'skill',
      question_text: r.question_text ?? r.question?.question_text ?? null,
      user_answer: r.user_answer as unknown,
      is_correct: r.is_correct,
      competency: r.question?.competency ?? null,
      ai_evaluation_json: r.ai_evaluation_json,
    }));

    return {
      track: profile.track ?? 'general',
      claimed_level: profile.claimed_level ?? 'unknown',
      validated_level: profile.validated_level ?? 'unknown',
      skill: skill ? { percentage: skill.result.percentage ?? 0 } : null,
      job_ready: advanced
        ? {
            percentage: advanced.result.percentage ?? 0,
            tier: advanced.result.tier,
          }
        : null,
      integrity: advanced?.result.integrity_confidence ?? null,
      scores,
      responses,
    };
  }

  private async latestResult(
    talentProfileId: string,
    type: AssessmentType,
  ): Promise<LatestResult | null> {
    const row = await this.resultRepo
      .createQueryBuilder('result')
      .innerJoin(AssessmentAttempt, 'attempt', 'attempt.id = result.attempt_id')
      .where('attempt.talent_profile_id = :talentProfileId', {
        talentProfileId,
      })
      .andWhere('attempt.assessment_type = :type', { type })
      .orderBy('attempt.completed_at', 'DESC', 'NULLS LAST')
      .addOrderBy('result.created_at', 'DESC')
      .getOne();
    return row ? { result: row, attemptId: row.attempt_id } : null;
  }
}
