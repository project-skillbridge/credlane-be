import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Offer, OfferStatus } from '../../offers/entities/offer.entity';
import { User } from '../../users/entities/user.entity';
import { EmployerProfile } from '../../employer/entities/employer-profile.entity';
import { AdminListOffersQueryDto } from './dto/admin-list-offers-query.dto';
import {
  AdminOfferListResult,
  AdminOfferRow,
  FunnelStage,
  OfferFunnelResult,
  OffersPageStats,
  TrendIndicator,
} from './dto/admin-offers-responses.dto';

// ─── Constants ────────────────────────────────────────────────────

const DEFAULT_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Linear funnel stages in the offer lifecycle. An offer at a later stage has
 * implicitly passed through all earlier stages.
 *
 * Offer status now represents the interview invite lifecycle only.
 */
const FUNNEL_STAGE_ORDER: readonly OfferStatus[] = [
  OfferStatus.PENDING,
  OfferStatus.ACCEPTED,
  OfferStatus.DECLINED,
  OfferStatus.EXPIRED,
  OfferStatus.WITHDRAWN,
] as const;

/**
 * Maps a current status to all linear stages it has *passed through* (inclusive).
 * Terminal fork statuses only count their own branch.
 */
const STAGE_REACHED: Record<OfferStatus, readonly OfferStatus[]> = {
  [OfferStatus.PENDING]: [OfferStatus.PENDING],
  [OfferStatus.ACCEPTED]: [OfferStatus.PENDING, OfferStatus.ACCEPTED],
  [OfferStatus.DECLINED]: [OfferStatus.PENDING, OfferStatus.DECLINED],
  [OfferStatus.EXPIRED]: [OfferStatus.PENDING, OfferStatus.EXPIRED],
  [OfferStatus.WITHDRAWN]: [OfferStatus.PENDING, OfferStatus.WITHDRAWN],
};

const STAGE_PARENT: Partial<Record<OfferStatus, OfferStatus>> = {
  [OfferStatus.ACCEPTED]: OfferStatus.PENDING,
  [OfferStatus.DECLINED]: OfferStatus.PENDING,
  [OfferStatus.EXPIRED]: OfferStatus.PENDING,
  [OfferStatus.WITHDRAWN]: OfferStatus.PENDING,
};

/** Terminal statuses that indicate the offer has been resolved. */
const RESOLVED_STATUSES = new Set<OfferStatus>([
  OfferStatus.ACCEPTED,
  OfferStatus.DECLINED,
  OfferStatus.EXPIRED,
  OfferStatus.WITHDRAWN,
]);

@Injectable()
export class AdminOffersService {
  constructor(
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(EmployerProfile)
    private readonly employerProfileRepo: Repository<EmployerProfile>,
  ) {}

  // ─── Stat cards ───────────────────────────────────────────────

  async getStats(dateFrom?: string, dateTo?: string): Promise<OffersPageStats> {
    const { start, end, priorStart, priorEnd } = this.resolvePeriod(
      dateFrom,
      dateTo,
    );

    const [currentCounts, priorCounts, currentHireDays, priorHireDays] =
      await Promise.all([
        this.countsByStatus(start, end),
        this.countsByStatus(priorStart, priorEnd),
        this.avgHireDays(start, end),
        this.avgHireDays(priorStart, priorEnd),
      ]);

    const totalNow = currentCounts.total;
    const totalPrior = priorCounts.total;

    const acceptRateNow = this.toPercent(currentCounts.accepted, totalNow);
    const acceptRatePrior = this.toPercent(priorCounts.accepted, totalPrior);

    const hireRateNow = this.toPercent(currentCounts.hired, totalNow);
    const hireRatePrior = this.toPercent(priorCounts.hired, totalPrior);

    return {
      total_offers_sent: {
        value: totalNow,
        trend: this.computeTrend(totalNow, totalPrior),
      },
      offer_to_acceptance_rate: {
        value: acceptRateNow,
        trend: this.computeTrend(acceptRateNow, acceptRatePrior),
      },
      offer_to_hire_rate: {
        value: hireRateNow,
        trend: this.computeTrend(hireRateNow, hireRatePrior),
      },
      avg_time_offer_to_hire_days: {
        value: currentHireDays ?? 0,
        trend: this.computeTrend(currentHireDays ?? 0, priorHireDays ?? 0),
      },
    };
  }

  // ─── Funnel ───────────────────────────────────────────────────

  async getFunnel(
    dateFrom?: string,
    dateTo?: string,
  ): Promise<OfferFunnelResult> {
    const { start, end } = this.resolvePeriod(dateFrom, dateTo);

    const statusRows: { status: OfferStatus; count: string }[] =
      await this.offerRepo
        .createQueryBuilder('offer')
        .select('offer.status', 'status')
        .addSelect('COUNT(*)::int', 'count')
        .where('offer.created_at >= :start', { start })
        .andWhere('offer.created_at < :end', { end })
        .groupBy('offer.status')
        .getRawMany();

    // Accumulate: for each status bucket, credit every stage that status has
    // passed through.
    const stageCounts = new Map<string, number>();
    for (const stage of FUNNEL_STAGE_ORDER) {
      stageCounts.set(stage, 0);
    }

    let total = 0;
    for (const row of statusRows) {
      const count = Number(row.count);
      total += count;
      const reached = STAGE_REACHED[row.status] ?? [row.status];
      for (const stage of reached) {
        stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + count);
      }
    }

    // Build ordered stages with drop-off %
    const stages: FunnelStage[] = [];

    for (const stage of FUNNEL_STAGE_ORDER) {
      const count = stageCounts.get(stage) ?? 0;

      const parentStage = STAGE_PARENT[stage];
      const parentCount = parentStage
        ? (stageCounts.get(parentStage) ?? 0)
        : null;

      if (count === 0 && parentCount === null) {
        // Skip stages with zero count before we have any data
        stages.push({ stage, count: 0, drop_off_percent: null });
        continue;
      }

      let dropOff: number | null = null;
      if (parentCount !== null && parentCount > 0) {
        dropOff = Math.round(((parentCount - count) / parentCount) * 100);
      }

      stages.push({ stage, count, drop_off_percent: dropOff });
    }

    return {
      stages,
      total,
      empty: total === 0,
    };
  }

  // ─── All Offers table ─────────────────────────────────────────

  async findAll(query: AdminListOffersQueryDto): Promise<AdminOfferListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.offerRepo
      .createQueryBuilder('offer')
      .leftJoin('offer.candidate', 'candidate')
      .leftJoin('offer.employer', 'employer')
      .leftJoin(EmployerProfile, 'ep', 'ep.user_id = offer.employer_user_id')
      .addSelect([
        'candidate.id',
        'candidate.first_name',
        'candidate.last_name',
        'employer.id',
        'employer.first_name',
        'employer.last_name',
      ])
      .addSelect('ep.company_name', 'ep_company_name');

    // ── Filters ──
    if (query.status) {
      qb.andWhere('offer.status = :status', { status: query.status });
    }
    if (query.dateFrom) {
      qb.andWhere('offer.created_at >= :dateFrom', {
        dateFrom: new Date(query.dateFrom),
      });
    }
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setDate(end.getDate() + 1);
      qb.andWhere('offer.created_at < :dateTo', {
        dateTo: end,
      });
    }

    // ── Search ──
    if (query.search) {
      const searchParam = `%${query.search}%`;
      qb.andWhere(
        `(
          CONCAT(candidate.first_name, ' ', candidate.last_name) ILIKE :search
          OR ep.company_name ILIKE :search
          OR CONCAT(employer.first_name, ' ', employer.last_name) ILIKE :search
        )`,
        { search: searchParam },
      );
    }

    qb.orderBy('offer.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [offers, total] = await qb.getManyAndCount();

    // Batch-load employer profiles for company_name
    const employerUserIds = [...new Set(offers.map((o) => o.employer_user_id))];
    const profiles = employerUserIds.length
      ? await this.employerProfileRepo.find({
          where: employerUserIds.map((id) => ({ user_id: id })),
          select: ['user_id', 'company_name'],
        })
      : [];
    const companyNameMap = new Map(
      profiles.map((p) => [p.user_id, p.company_name]),
    );

    const rows: AdminOfferRow[] = offers.map((offer) => {
      const candidate = offer.candidate;
      const employer = offer.employer;
      const candidateName = candidate
        ? `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim() ||
          'Unknown candidate'
        : 'Unknown candidate';

      const companyName = companyNameMap.get(offer.employer_user_id);
      const employerFullname = employer
        ? `${employer.first_name ?? ''} ${employer.last_name ?? ''}`.trim()
        : '';
      const employerName =
        companyName || employerFullname || 'Unknown employer';

      return {
        id: offer.id,
        candidate_name: candidateName,
        employer_name: employerName,
        role_title: offer.role_title,
        status: offer.status,
        date_sent: offer.created_at,
        date_resolved: this.resolveDate(offer),
      };
    });

    return {
      offers: rows,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    };
  }

  // ─── Private helpers ──────────────────────────────────────────

  private resolveDate(offer: Offer): Date | null {
    if (RESOLVED_STATUSES.has(offer.status)) {
      return offer.responded_at ?? offer.updated_at;
    }
    return null;
  }

  private resolvePeriod(
    dateFrom?: string,
    dateTo?: string,
  ): { start: Date; end: Date; priorStart: Date; priorEnd: Date } {
    const end = dateTo ? new Date(dateTo) : new Date();
    const start = dateFrom
      ? new Date(dateFrom)
      : new Date(end.getTime() - DEFAULT_PERIOD_MS);

    const periodMs = end.getTime() - start.getTime();
    const priorEnd = new Date(start.getTime());
    const priorStart = new Date(start.getTime() - periodMs);

    return { start, end, priorStart, priorEnd };
  }

  private async countsByStatus(
    start: Date,
    end: Date,
  ): Promise<{
    total: number;
    accepted: number;
    hired: number;
  }> {
    const rows: { status: OfferStatus; cnt: string }[] = await this.offerRepo
      .createQueryBuilder('offer')
      .select('offer.status', 'status')
      .addSelect('COUNT(*)::int', 'cnt')
      .where('offer.created_at >= :start', { start })
      .andWhere('offer.created_at < :end', { end })
      .groupBy('offer.status')
      .getRawMany();

    let total = 0;
    let accepted = 0;
    let hired = 0;

    for (const row of rows) {
      const count = Number(row.cnt);
      total += count;
      if (row.status === OfferStatus.ACCEPTED) accepted += count;
      if (row.status === OfferStatus.ACCEPTED) hired += count;
    }

    return { total, accepted, hired };
  }

  private async avgHireDays(start: Date, end: Date): Promise<number | null> {
    const result: { avg_days: string | null } | undefined = await this.offerRepo
      .createQueryBuilder('offer')
      .select(
        `AVG(EXTRACT(EPOCH FROM (COALESCE(offer.responded_at, offer.updated_at) - offer.created_at)) / 86400)`,
        'avg_days',
      )
      .where('offer.created_at >= :start', { start })
      .andWhere('offer.created_at < :end', { end })
      .andWhere('offer.status = :status', { status: OfferStatus.ACCEPTED })
      .getRawOne();

    if (!result?.avg_days) return null;
    return Math.round(parseFloat(result.avg_days));
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
