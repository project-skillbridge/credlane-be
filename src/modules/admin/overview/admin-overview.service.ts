import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserRole } from '../../users/entities/user.entity';
import {
  TalentProfile,
  TalentProfileStatus,
} from '../../talent/entities/talent-profile.entity';
import { EmployerProfile } from '../../employer/entities/employer-profile.entity';
import { Offer } from '../../offers/entities/offer.entity';
import { AssessmentResult } from '../../assessments/entities/assessment-result.entity';
import { AssessmentType } from '../../assessments/entities/assessment-question.entity';
import { AiUsageLog } from '../../ai/ai-usage-log.entity';
import { NewUsersQueryDto } from './dto/new-users-query.dto';

export interface TrendIndicator {
  direction: 'up' | 'down' | null;
  change_percent: number | null;
}

export interface StatCard {
  value: number;
  trend: TrendIndicator;
}

export interface OverviewStats {
  total_candidates: StatCard;
  job_ready_rate: StatCard;
  active_employers: StatCard;
  offers_sent_this_month: StatCard;
  total_revenue: StatCard;
}

export interface ScoreDistributionBucket {
  range: string;
  count: number;
}

export interface ScoreDistributionResult {
  buckets: ScoreDistributionBucket[];
  total_completed: number;
  empty: boolean;
}

export interface AiUsageBucket {
  label: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface AiFeatureSummary {
  calls: number;
  total_tokens: number;
  cost_usd: number;
}

export interface AiGenerationConsumptionResult {
  buckets: AiUsageBucket[];
  by_feature: Record<string, AiFeatureSummary>;
  totals: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
  empty: boolean;
}

const SCORE_DISTRIBUTION_EMPTY_THRESHOLD = 10;
const SCORE_BUCKET_SIZE = 10;

/**
 * Periods are trailing-30-days vs the 30 days before that. The spec doesn't
 * define a period selector for Overview stat cards (unlike the Payments
 * revenue chart), so this is a reasonable default rather than a literal spec
 * requirement.
 */
const TREND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AdminOverviewService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(TalentProfile)
    private readonly talentProfileRepo: Repository<TalentProfile>,
    @InjectRepository(EmployerProfile)
    private readonly employerProfileRepo: Repository<EmployerProfile>,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(AssessmentResult)
    private readonly assessmentResultRepo: Repository<AssessmentResult>,
    @InjectRepository(AiUsageLog)
    private readonly aiUsageLogRepo: Repository<AiUsageLog>,
  ) {}

  async getStats(): Promise<OverviewStats> {
    const now = new Date();
    const periodStart = new Date(now.getTime() - TREND_WINDOW_MS);

    const [
      totalCandidates,
      candidatesAtPriorPeriod,
      jobReadyCount,
      jobReadyAtPriorPeriod,
      totalCandidatesAtPriorPeriod,
      activeEmployers,
      activeEmployersAtPriorPeriod,
      offersThisMonth,
      offersPriorMonth,
    ] = await Promise.all([
      this.userRepo.count({ where: { role: UserRole.TALENT } }),
      this.userRepo
        .createQueryBuilder('u')
        .where('u.role = :role', { role: UserRole.TALENT })
        .andWhere('u.created_at <= :date', { date: periodStart })
        .getCount(),
      this.talentProfileRepo.count({
        where: { status: TalentProfileStatus.JOB_READY },
      }),
      this.talentProfileRepo
        .createQueryBuilder('tp')
        .where('tp.status = :status', { status: TalentProfileStatus.JOB_READY })
        .andWhere('tp.created_at <= :date', { date: periodStart })
        .getCount(),
      this.talentProfileRepo
        .createQueryBuilder('tp')
        .where('tp.created_at <= :date', { date: periodStart })
        .getCount(),
      this.employerProfileRepo.count({ where: { is_verified: true } }),
      this.employerProfileRepo
        .createQueryBuilder('ep')
        .where('ep.is_verified = true')
        .andWhere('ep.created_at <= :date', { date: periodStart })
        .getCount(),
      this.countOffersBetween(this.startOfMonth(now), now),
      this.countOffersBetween(
        this.startOfMonth(this.addMonths(now, -1)),
        this.startOfMonth(now),
      ),
    ]);

    const jobReadyRateNow = this.toPercent(jobReadyCount, totalCandidates);
    const jobReadyRatePrior = this.toPercent(
      jobReadyAtPriorPeriod,
      totalCandidatesAtPriorPeriod,
    );

    return {
      total_candidates: {
        value: totalCandidates,
        trend: this.computeTrend(totalCandidates, candidatesAtPriorPeriod),
      },
      job_ready_rate: {
        value: jobReadyRateNow,
        trend: this.computeTrend(jobReadyRateNow, jobReadyRatePrior),
      },
      active_employers: {
        value: activeEmployers,
        trend: this.computeTrend(activeEmployers, activeEmployersAtPriorPeriod),
      },
      offers_sent_this_month: {
        value: offersThisMonth,
        trend: this.computeTrend(offersThisMonth, offersPriorMonth),
      },
      // No payments system exists yet (spec OQ-03/04/05 pending) — slot left
      // at zero with no trend rather than fabricating revenue data.
      total_revenue: {
        value: 0,
        trend: { direction: null, change_percent: null },
      },
    };
  }

  async getScoreDistribution(track?: string): Promise<ScoreDistributionResult> {
    const qb = this.assessmentResultRepo
      .createQueryBuilder('result')
      .innerJoin('result.attempt', 'attempt')
      .innerJoin('attempt.talent_profile', 'talent_profile')
      .where('attempt.assessment_type = :type', {
        type: AssessmentType.ADVANCED,
      })
      .andWhere('result.percentage IS NOT NULL');

    if (track) {
      qb.andWhere('talent_profile.track = :track', { track });
    }

    const rows: { percentage: number }[] = await qb
      .select('result.percentage', 'percentage')
      .getRawMany();

    const totalCompleted = rows.length;
    const bucketCounts = new Map<number, number>();
    for (let i = 0; i < 100; i += SCORE_BUCKET_SIZE) {
      bucketCounts.set(i, 0);
    }

    for (const row of rows) {
      const pct = Math.min(99, Math.max(0, row.percentage));
      const bucketStart =
        Math.floor(pct / SCORE_BUCKET_SIZE) * SCORE_BUCKET_SIZE;
      bucketCounts.set(bucketStart, (bucketCounts.get(bucketStart) ?? 0) + 1);
    }

    const buckets: ScoreDistributionBucket[] = Array.from(
      bucketCounts.entries(),
    ).map(([start, count]) => ({
      range: `${start}-${start + SCORE_BUCKET_SIZE - 1}`,
      count,
    }));

    return {
      buckets,
      total_completed: totalCompleted,
      empty: totalCompleted < SCORE_DISTRIBUTION_EMPTY_THRESHOLD,
    };
  }

  async getAiGenerationConsumption(
    period: string,
  ): Promise<AiGenerationConsumptionResult> {
    // Map tag prefixes to display feature names
    const featureSql = `
      CASE
        WHEN tag LIKE 'rubric_scoring%' THEN 'scoring'
        WHEN tag = 'guidance_report'    THEN 'report'
        WHEN tag = 'resource_generation' THEN 'resources'
        WHEN tag = 'question_generation' THEN 'question_gen'
        WHEN tag = 'lt3_generation'      THEN 'lt3_gen'
        ELSE tag
      END
    `;

    const truncUnit =
      period === 'yearly'
        ? 'year'
        : period === 'weekly'
          ? 'week'
          : period === 'daily'
            ? 'day'
            : 'month';

    // How many buckets to look back
    const lookback =
      period === 'yearly'
        ? '5 years'
        : period === 'daily'
          ? '30 days'
          : '12 months';

    const bucketRows = await this.aiUsageLogRepo.query<
      {
        label: string;
        calls: string;
        input_tokens: string;
        output_tokens: string;
        cost_usd: string;
      }[]
    >(
      `
      SELECT
        to_char(date_trunc($1, created_at), 'YYYY-MM-DD') AS label,
        COUNT(*)::int                                       AS calls,
        COALESCE(SUM(input_tokens), 0)::int                AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int               AS output_tokens,
        COALESCE(SUM(cost_usd), 0)::numeric(18,10)         AS cost_usd
      FROM ai_usage_logs
      WHERE created_at >= now() - $2::interval
      GROUP BY date_trunc($1, created_at)
      ORDER BY date_trunc($1, created_at)
      `,
      [truncUnit, lookback],
    );

    const featureRows = await this.aiUsageLogRepo.query<
      {
        feature: string;
        calls: string;
        total_tokens: string;
        cost_usd: string;
      }[]
    >(
      `
      SELECT
        (${featureSql})                             AS feature,
        COUNT(*)::int                               AS calls,
        COALESCE(SUM(total_tokens), 0)::int         AS total_tokens,
        COALESCE(SUM(cost_usd), 0)::numeric(18,10)  AS cost_usd
      FROM ai_usage_logs
      WHERE created_at >= now() - $1::interval
      GROUP BY 1
      ORDER BY calls DESC
      `,
      [lookback],
    );

    const buckets: AiUsageBucket[] = bucketRows.map((r) => ({
      label: r.label,
      calls: Number(r.calls),
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      cost_usd: Number(r.cost_usd),
    }));

    const by_feature: Record<string, AiFeatureSummary> = {};
    for (const r of featureRows) {
      by_feature[r.feature] = {
        calls: Number(r.calls),
        total_tokens: Number(r.total_tokens),
        cost_usd: Number(r.cost_usd),
      };
    }

    const totals = buckets.reduce(
      (acc, b) => ({
        calls: acc.calls + b.calls,
        input_tokens: acc.input_tokens + b.input_tokens,
        output_tokens: acc.output_tokens + b.output_tokens,
        cost_usd: acc.cost_usd + b.cost_usd,
      }),
      { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
    );

    return { buckets, by_feature, totals, empty: totals.calls === 0 };
  }

  async getNewUsers(query: NewUsersQueryDto): Promise<{
    items: Array<{
      name: string;
      type: 'talent' | 'employer';
      signup_date: Date;
      status: string;
    }>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [users, total] = await this.userRepo.findAndCount({
      where: [{ role: UserRole.TALENT }, { role: UserRole.EMPLOYER }],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const talentIds = users
      .filter((u) => u.role === UserRole.TALENT)
      .map((u) => u.id);
    const employerIds = users
      .filter((u) => u.role === UserRole.EMPLOYER)
      .map((u) => u.id);

    const [talentProfiles, employerProfiles] = await Promise.all([
      talentIds.length
        ? this.talentProfileRepo.find({ where: { user_id: In(talentIds) } })
        : Promise.resolve([]),
      employerIds.length
        ? this.employerProfileRepo.find({
            where: { user_id: In(employerIds) },
          })
        : Promise.resolve([]),
    ]);

    const talentByUserId = new Map(
      talentIds.length ? talentProfiles.map((p) => [p.user_id, p]) : [],
    );
    const employerByUserId = new Map(
      employerIds.length ? employerProfiles.map((p) => [p.user_id, p]) : [],
    );

    const items = users.map((user) => {
      if (user.role === UserRole.TALENT) {
        const profile = talentByUserId.get(user.id);
        return {
          name: user.fullname,
          type: 'talent' as const,
          signup_date: user.createdAt,
          status: this.mapTalentStatus(profile?.status),
        };
      }
      const profile = employerByUserId.get(user.id);
      return {
        name: profile?.company_name ?? user.fullname,
        type: 'employer' as const,
        signup_date: user.createdAt,
        status: profile?.is_verified ? 'Verified' : 'Unverified',
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private mapTalentStatus(status?: string): string {
    switch (status) {
      case 'job_ready':
        return 'Job Ready';
      case 'emerging':
        return 'Emerging';
      case 'not_ready':
        return 'Onboarding';
      default:
        return 'Onboarding';
    }
  }

  private async countOffersBetween(start: Date, end: Date): Promise<number> {
    return this.offerRepo
      .createQueryBuilder('offer')
      .where('offer.created_at >= :start', { start })
      .andWhere('offer.created_at < :end', { end })
      .getCount();
  }

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private addMonths(date: Date, months: number): Date {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
  }

  private toPercent(numerator: number, denominator: number): number {
    if (denominator === 0) return 0;
    return Math.round((numerator / denominator) * 100);
  }

  private computeTrend(current: number, prior: number): TrendIndicator {
    if (prior === 0) {
      return current === 0
        ? { direction: null, change_percent: null }
        : { direction: 'up', change_percent: 100 };
    }
    const changePercent = Math.round(((current - prior) / prior) * 100);
    return {
      direction: changePercent >= 0 ? 'up' : 'down',
      change_percent: changePercent,
    };
  }
}
