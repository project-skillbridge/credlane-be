import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';
import { User } from '../users/entities/user.entity';
import { EmployerContactRequest } from './entities/employer-contact-request.entity';
import { EmployerSavedCandidate } from './entities/employer-saved-candidate.entity';
import { DiscoveryCandidatesQueryDto } from './dto/discovery-candidates-query.dto';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { EmployerVerificationService } from '../employer/employer-verification.service';
import { Offer, OfferStatus } from '../offers/entities/offer.entity';
import { EmployerBillingService } from '../employer-billing/employer-billing.service';
import { VerifiedProfileService } from '../verified-profile/verified-profile.service';
import { EmployerCandidateProfileResponseDto } from './dto/employer-candidate-profile.dto';
import {
  DiscoveryCandidateCard,
  DiscoveryCandidateRawRow,
  mapDiscoveryCandidateCard,
} from './discovery-candidate.mapper';

export type CandidateCard = DiscoveryCandidateCard;

export type DiscoveryListResult = {
  candidates: CandidateCard[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  empty_state_message: string | null;
};

type CandidateRawRow = DiscoveryCandidateRawRow & {
  poolId?: string;
  notes?: string | null;
};

type SavedCandidateIdRow = {
  s_candidate_user_id: string;
};

type CandidateOfferStatusRow = {
  offer_candidate_user_id: string;
  offer_status: OfferStatus.PENDING | OfferStatus.ACCEPTED;
};

@Injectable()
export class EmployerDiscoveryService {
  private readonly logger = new Logger(EmployerDiscoveryService.name);

  constructor(
    @InjectRepository(EmployerPoolProfile)
    private readonly poolProfileRepo: Repository<EmployerPoolProfile>,
    @InjectRepository(EmployerSavedCandidate)
    private readonly savedCandidateRepo: Repository<EmployerSavedCandidate>,
    @InjectRepository(EmployerContactRequest)
    private readonly contactRequestRepo: Repository<EmployerContactRequest>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(EmployerProfile)
    private readonly employerProfileRepo: Repository<EmployerProfile>,
    private readonly notificationDispatch: NotificationDispatchService,
    private readonly verificationService: EmployerVerificationService,
    private readonly verifiedProfileService: VerifiedProfileService,
    private readonly billingService: EmployerBillingService,
  ) {}

  async discoverCandidates(
    employerUserId: string,
    query: DiscoveryCandidatesQueryDto,
  ): Promise<DiscoveryListResult> {
    // Default roleTrack to employer's desired_roles from onboarding
    const hasExplicitFilters =
      Boolean(query.search?.trim()) ||
      Boolean(query.region?.trim()) ||
      Boolean(query.availability?.length) ||
      Boolean(query.experienceLevel?.length) ||
      query.minScore != null ||
      query.maxScore != null;

    if (!query.roleTrack?.length && !hasExplicitFilters) {
      const profile = await this.employerProfileRepo.findOne({
        where: { user_id: employerUserId },
        select: ['desired_roles'],
      });
      if (profile?.desired_roles?.length) {
        query.roleTrack = profile.desired_roles;
      }
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const qb = this.poolProfileRepo
      .createQueryBuilder('pool')
      .innerJoin(User, 'u', 'u.id = pool.candidate_id')
      .innerJoin('talent_profiles', 'tp', 'tp.id = pool.talent_profile_id')
      .where('pool.tier = :tier', { tier: 'job_ready' })
      .andWhere(
        '(pool.job_search_status IS NULL OR pool.job_search_status != :notLooking)',
        { notLooking: 'not_looking' },
      )
      // Employers only see talent with a face, a resume and a portfolio:
      // no anonymous profiles.
      .andWhere("COALESCE(u.avatar_url, '') != ''")
      .andWhere("COALESCE(tp.resume_url, '') != ''")
      .andWhere("COALESCE(tp.personal_website, '') != ''");

    this.applyDiscoveryFilters(qb, query);
    this.selectDiscoveryColumns(qb);

    const total = await qb.getCount();

    const rawResults: CandidateRawRow[] = await qb
      .orderBy('pool.score', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany();

    // Check which candidates are saved by this employer
    const candidateIds = rawResults.map((r) => r.userId);
    const savedMap = await this.getSavedMap(employerUserId, candidateIds);
    const offerStatusMap = await this.getOfferStatusMap(
      employerUserId,
      candidateIds,
    );

    const unlockedIds = await this.getRevealedIds(
      employerUserId,
      candidateIds,
      offerStatusMap,
    );

    const candidates: CandidateCard[] = rawResults.map((r) =>
      mapDiscoveryCandidateCard(r, {
        is_saved: savedMap.has(r.userId),
        offer_sent: offerStatusMap.has(r.userId),
        offer_status: offerStatusMap.get(r.userId) ?? null,
        is_unlocked: unlockedIds.has(r.userId),
      }),
    );

    return {
      candidates,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
      empty_state_message:
        total === 0
          ? 'No candidates match your current filters. Try adjusting your selection.'
          : null,
    };
  }

  async getCandidateProfile(
    employerUserId: string,
    candidateUserId: string,
  ): Promise<EmployerCandidateProfileResponseDto> {
    const [profile, savedMap, offerStatusMap, hasUnlock, poolProfile] =
      await Promise.all([
        this.verifiedProfileService.getForEmployerView(candidateUserId),
        this.getSavedMap(employerUserId, [candidateUserId]),
        this.getOfferStatusMap(employerUserId, [candidateUserId]),
        this.billingService.isUnlocked(employerUserId, candidateUserId),
        this.poolProfileRepo.findOne({
          where: { candidate_id: candidateUserId },
          relations: ['talent_profile'],
        }),
      ]);

    // A candidate who accepted this employer's invite has chosen to share
    // their details, so it counts as unlocked at no cost.
    const isUnlocked =
      hasUnlock || offerStatusMap.get(candidateUserId) === OfferStatus.ACCEPTED;

    // Locked: first name + last initial only; no photo, contact, resume or links.
    const [first = '', ...rest] = profile.full_name.split(' ');
    const lastInitial = rest.length
      ? `${rest[rest.length - 1].charAt(0).toUpperCase()}.`
      : '';
    const locked = isUnlocked
      ? {}
      : {
          full_name: `${first} ${lastInitial}`.trim(),
          avatar_url: null,
          email: '',
          resume_url: null,
          share_url: '',
          qr_code_url: null,
        };

    return {
      ...profile,
      ...locked,
      is_unlocked: isUnlocked,
      portfolio_url: isUnlocked
        ? (poolProfile?.talent_profile?.personal_website ?? null)
        : null,
      linkedin_url: isUnlocked
        ? (poolProfile?.talent_profile?.linkedin_url ?? null)
        : null,
      user_id: candidateUserId,
      is_saved: savedMap.has(candidateUserId),
      offer_sent: offerStatusMap.has(candidateUserId),
      offer_status: offerStatusMap.get(candidateUserId) ?? null,
    };
  }

  /** Unlocked by the employer, or revealed because the talent accepted an invite. */
  private async getRevealedIds(
    employerUserId: string,
    candidateIds: string[],
    offerStatusMap: Map<string, OfferStatus>,
  ): Promise<Set<string>> {
    const ids = await this.billingService.getUnlockedIds(
      employerUserId,
      candidateIds,
    );
    for (const [id, status] of offerStatusMap) {
      if (status === OfferStatus.ACCEPTED) ids.add(id);
    }
    return ids;
  }

  /** Spends one unlock to reveal a candidate's full profile. */
  async unlockCandidate(
    employerUserId: string,
    candidateUserId: string,
  ): Promise<{ already_unlocked: boolean; unlocks_remaining: number }> {
    await this.verificationService.assertEmployerVerified(employerUserId);

    const poolProfile = await this.poolProfileRepo.findOne({
      where: { candidate_id: candidateUserId },
    });
    if (!poolProfile || poolProfile.tier !== 'job_ready') {
      throw new NotFoundError('Candidate not found');
    }

    return this.billingService.unlock(employerUserId, candidateUserId);
  }

  async saveCandidate(
    employerUserId: string,
    candidateUserId: string,
    notes?: string,
  ): Promise<{ status: string; message: string }> {
    const poolProfile = await this.poolProfileRepo.findOne({
      where: { candidate_id: candidateUserId },
    });

    if (!poolProfile) {
      throw new NotFoundError('Candidate not found');
    }

    if (poolProfile.tier !== 'job_ready') {
      throw new ForbiddenError('Only Job Ready candidates can be saved');
    }

    try {
      await this.savedCandidateRepo.save({
        employer_user_id: employerUserId,
        candidate_user_id: candidateUserId,
        employer_pool_profile_id: poolProfile.id,
        notes: notes ?? null,
      });
    } catch (error: unknown) {
      // Unique constraint violation (concurrent duplicate save)
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        throw new ConflictError('Candidate already saved');
      }
      throw error;
    }

    return { status: 'success', message: 'Candidate saved to shortlist' };
  }

  async unsaveCandidate(
    employerUserId: string,
    candidateUserId: string,
  ): Promise<{ status: string; message: string }> {
    const result = await this.savedCandidateRepo.delete({
      employer_user_id: employerUserId,
      candidate_user_id: candidateUserId,
    });

    if (!result.affected) {
      throw new NotFoundError('Saved candidate not found');
    }

    return { status: 'success', message: 'Candidate removed from shortlist' };
  }

  async listSavedCandidates(
    employerUserId: string,
    page = 1,
    limit = 20,
  ): Promise<DiscoveryListResult> {
    const offset = (page - 1) * limit;

    const qb = this.savedCandidateRepo
      .createQueryBuilder('saved')
      .innerJoin(
        EmployerPoolProfile,
        'pool',
        'pool.candidate_id = saved.candidate_user_id',
      )
      .innerJoin(User, 'u', 'u.id = saved.candidate_user_id')
      .innerJoin('talent_profiles', 'tp', 'tp.id = pool.talent_profile_id')
      .where('saved.employer_user_id = :employerUserId', { employerUserId })
      .andWhere('pool.tier = :tier', { tier: 'job_ready' });

    this.selectDiscoveryColumns(qb, {
      includeNotes: true,
      includeSavedAt: true,
    });

    const total = await qb.getCount();

    const rawResults: CandidateRawRow[] = await qb
      .orderBy('saved.created_at', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany();

    const candidateIds = rawResults.map((r) => r.userId);
    const offerStatusMap = await this.getOfferStatusMap(
      employerUserId,
      candidateIds,
    );

    const unlockedIds = await this.getRevealedIds(
      employerUserId,
      candidateIds,
      offerStatusMap,
    );

    const candidates: CandidateCard[] = rawResults.map((r) =>
      mapDiscoveryCandidateCard(r, {
        is_unlocked: unlockedIds.has(r.userId),
        is_saved: true,
        offer_sent: offerStatusMap.has(r.userId),
        offer_status: offerStatusMap.get(r.userId) ?? null,
        date_added:
          (r as CandidateRawRow & { savedAt?: Date }).savedAt?.toISOString() ??
          null,
      }),
    );

    return {
      candidates,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
      empty_state_message:
        total === 0
          ? 'No candidates match your current filters. Try adjusting your selection.'
          : null,
    };
  }

  async contactCandidate(
    employerUserId: string,
    candidateUserId: string,
    message: string,
  ): Promise<{ status: string; message: string }> {
    await this.verificationService.assertEmployerVerified(employerUserId);

    const poolProfile = await this.poolProfileRepo.findOne({
      where: { candidate_id: candidateUserId },
    });

    if (!poolProfile) {
      throw new NotFoundError('Candidate not found');
    }

    if (poolProfile.tier !== 'job_ready') {
      throw new ForbiddenError('Only Job Ready candidates can be contacted');
    }

    const contactRequest = await this.contactRequestRepo.save({
      employer_user_id: employerUserId,
      candidate_user_id: candidateUserId,
      message,
    });

    // Dispatch notification to candidate
    const employer = await this.userRepo.findOne({
      where: { id: employerUserId },
    });
    const employerName = employer
      ? `${employer.first_name ?? ''} ${employer.last_name ?? ''}`.trim()
      : 'An employer';

    try {
      await this.notificationDispatch.dispatch(
        NotificationType.CONTACT_REQUEST_RECEIVED,
        candidateUserId,
        {
          contactRequestId: contactRequest.id,
          employerUserId,
          employerName,
        },
      );
    } catch (error) {
      this.logger.error(
        `Contact request notification failed request=${contactRequest.id}: ${String(error)}`,
      );
    }

    return { status: 'success', message: 'Contact request sent' };
  }

  private async getSavedMap(
    employerUserId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();

    const saved: SavedCandidateIdRow[] = await this.savedCandidateRepo
      .createQueryBuilder('s')
      .select('s.candidate_user_id')
      .where('s.employer_user_id = :employerUserId', { employerUserId })
      .andWhere('s.candidate_user_id IN (:...candidateIds)', { candidateIds })
      .getRawMany();

    return new Set(saved.map((row) => row.s_candidate_user_id));
  }

  private async getOfferStatusMap(
    employerUserId: string,
    candidateIds: string[],
  ): Promise<Map<string, OfferStatus.PENDING | OfferStatus.ACCEPTED>> {
    if (candidateIds.length === 0) return new Map();

    const rows: CandidateOfferStatusRow[] = await this.offerRepo
      .createQueryBuilder('offer')
      .select(['offer.candidate_user_id', 'offer.status'])
      .where('offer.employer_user_id = :employerUserId', { employerUserId })
      .andWhere('offer.candidate_user_id IN (:...candidateIds)', {
        candidateIds,
      })
      .andWhere('offer.status IN (:...statuses)', {
        statuses: [OfferStatus.PENDING, OfferStatus.ACCEPTED],
      })
      .getRawMany();

    return new Map(
      rows.map((row) => [row.offer_candidate_user_id, row.offer_status]),
    );
  }

  private applyDiscoveryFilters(
    qb: SelectQueryBuilder<EmployerPoolProfile>,
    query: DiscoveryCandidatesQueryDto,
  ): void {
    if (query.roleTrack?.length) {
      qb.andWhere('pool.track IN (:...roleTracks)', {
        roleTracks: query.roleTrack,
      });
    }

    if (query.availability?.length) {
      qb.andWhere('pool.availability IN (:...availabilities)', {
        availabilities: query.availability,
      });
    }

    if (query.search) {
      qb.andWhere(
        `(u.first_name ILIKE :search OR u.last_name ILIKE :search OR CONCAT(u.first_name, ' ', u.last_name) ILIKE :search)`,
        { search: `%${query.search}%` },
      );
    }

    if (query.minScore != null) {
      qb.andWhere('pool.score >= :minScore', { minScore: query.minScore });
    }

    if (query.maxScore != null) {
      qb.andWhere('pool.score <= :maxScore', { maxScore: query.maxScore });
    }

    if (query.experienceLevel?.length) {
      qb.andWhere('pool.verified_level IN (:...experienceLevels)', {
        experienceLevels: query.experienceLevel,
      });
    }

    // Comma-separated list of countries/regions; a match on any one counts.
    const regions = (query.region ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    if (regions.length) {
      const params: Record<string, string> = {};
      const clauses = regions.map((r, i) => {
        params[`region${i}`] = `%${r}%`;
        return `(pool.location ILIKE :region${i} OR u.country ILIKE :region${i})`;
      });
      qb.andWhere(`(${clauses.join(' OR ')})`, params);
    }
  }

  private selectDiscoveryColumns<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    options?: { includeNotes?: boolean; includeSavedAt?: boolean },
  ): void {
    qb.select([
      'pool.candidate_id AS "userId"',
      'pool.track AS "roleTrack"',
      'pool.tier AS "tier"',
      'pool.availability AS "availability"',
      'pool.verified_at AS "verifiedAt"',
      'pool.score AS "score"',
      'pool.strong_competencies AS "strongCompetencies"',
      'pool.shareable_link_token AS "shareToken"',
      'pool.verified_level AS "verifiedLevel"',
      'pool.location AS "location"',
      'pool.job_search_status AS "jobSearchStatus"',
      'pool.specialization AS "specialization"',
      'tp.personal_assessment_answers AS "personalAssessmentAnswers"',
      'u.first_name AS "firstName"',
      'u.last_name AS "lastName"',
      'u.avatar_url AS "avatarUrl"',
      'u.country AS "country"',
      ...(options?.includeNotes ? ['saved.notes AS "notes"'] : []),
      ...(options?.includeSavedAt ? ['saved.created_at AS "savedAt"'] : []),
    ]);
  }
}
