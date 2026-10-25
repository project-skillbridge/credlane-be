import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subject } from 'rxjs';
import {
  Between,
  In,
  IsNull,
  LessThan,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors/app.errors';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';
import { User } from '../users/entities/user.entity';
import type {
  OfferReceivedPayload,
  OfferRespondedPayload,
  OfferWithdrawnPayload,
} from '../notifications/notification-dispatch.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { EmployerVerificationService } from '../employer/employer-verification.service';
import { EmployerRolesService } from '../employer-roles/employer-roles.service';
import { EmployerRole } from '../employer-roles/entities/employer-role.entity';

/** Narrow port so offers module does not depend on dispatch overload resolution in ESLint. */
type OffersNotificationPort = {
  notifyOfferReceived(
    userId: string,
    payload: OfferReceivedPayload,
  ): Promise<void>;
  notifyOfferAccepted(
    userId: string,
    payload: OfferRespondedPayload,
  ): Promise<void>;
  notifyOfferDeclined(
    userId: string,
    payload: OfferRespondedPayload,
  ): Promise<void>;
  notifyOfferWithdrawn(
    userId: string,
    payload: OfferWithdrawnPayload,
  ): Promise<void>;
  dispatch(
    type: NotificationType.CALL_REQUESTED,
    userId: string,
    payload: {
      offerId: string;
      candidateUserId: string;
      candidateName: string;
      roleTitle: string;
    },
  ): Promise<void>;
};
import { Offer, OfferStatus } from './entities/offer.entity';
import { HireFeedback } from './entities/hire-feedback.entity';
import { SubmitHireFeedbackDto } from './dto/submit-hire-feedback.dto';
import { EmployerBillingService } from '../employer-billing/employer-billing.service';
import { OfferDistributionLog } from './entities/offer-distribution-log.entity';
import { CreateOfferDto } from './dto/create-offer.dto';
import { ListOffersQueryDto } from './dto/list-offers-query.dto';

const DEFAULT_MONTHLY_CAP = 50;
const ACTIVE_OFFER_UNIQUE_INDEX = 'UQ_offers_active_employer_candidate';
const ACTIVE_OFFER_UNIQUE_INDEX_ROLE =
  'UQ_offers_active_employer_candidate_role';
const ACTIVE_OFFER_UNIQUE_INDEX_NO_ROLE =
  'UQ_offers_active_employer_candidate_no_role';

function isActiveOfferUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const code =
    (error as QueryFailedError & { code?: string }).code ??
    (error.driverError as { code?: string } | undefined)?.code;
  const constraint = (error.driverError as { constraint?: string } | undefined)
    ?.constraint;
  return (
    code === '23505' &&
    (constraint === ACTIVE_OFFER_UNIQUE_INDEX ||
      constraint === ACTIVE_OFFER_UNIQUE_INDEX_ROLE ||
      constraint === ACTIVE_OFFER_UNIQUE_INDEX_NO_ROLE)
  );
}

export type OfferListResult = {
  offers: Offer[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
};

/** Candidates tab — Offers subtab row (pending / declined / expired by default). */
export type EmployerCandidatesOfferEntry = {
  offer_id: string;
  candidate_user_id: string;
  candidate_name: string;
  role_track: string | null;
  job_title: string;
  date_sent: Date;
  /** `hired` once the employer has confirmed the hire. */
  status: OfferStatus | 'hired';
  candidate_avatar_url: string | null;
  pending_hire_feedback: boolean;
};

export type HireFeedbackRequestEntry = {
  id: string;
  offer_id: string;
  candidate_user_id: string;
  candidate_name: string;
  candidate_avatar_url: string | null;
  role_title: string;
  status: 'pending';
  requested_at: Date;
  submitted_at: null;
};

export type TalentTrackRecord = {
  average_rating: number | null;
  rating_count: number;
  would_hire_again_rate: number | null;
};

export const EMPLOYER_CANDIDATES_OFFERS_EMPTY_MESSAGE =
  'No offers sent yet. Discover candidates and send your first offer.';

export type EmployerCandidatesOffersResult = {
  offers: EmployerCandidatesOfferEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Set when the employer has never sent an offer (default subtab list is empty). */
  emptyStateMessage: string | null;
};

/** Pushed to employers subscribed on GET /employer/candidates/offers/events. */
export type OfferStatusChangeEvent = {
  type: 'offer_status_changed';
  offerId: string;
  candidateUserId: string;
  candidateName: string;
  roleTitle: string;
  status: OfferStatus.ACCEPTED | OfferStatus.DECLINED;
  respondedAt: string;
};

export type SendOffersResult = {
  sent_count: number;
  offers: Offer[];
  warnings: Array<{ candidateId: string; reason: string }>;
};

const CANDIDATES_OFFERS_SUBTAB_STATUSES = [
  OfferStatus.PENDING,
  OfferStatus.ACCEPTED,
  OfferStatus.DECLINED,
  OfferStatus.EXPIRED,
  OfferStatus.WITHDRAWN,
] as const;

const ACTIVE_OFFER_STATUSES = [
  OfferStatus.PENDING,
  OfferStatus.ACCEPTED,
] as const;

type OfferStatusStreamEntry = {
  subject: Subject<OfferStatusChangeEvent>;
  subscriberCount: number;
};

export type EnrichedOffer = Offer & {
  is_employer_verified: boolean;
};

export type EnrichedOfferListResult = {
  offers: EnrichedOffer[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
};

export type OfferAnalytics = {
  offers_this_month: number;
  monthly_cap: number;
  remaining: number;
  accepted_count: number;
  declined_count: number;
  pending_count: number;
  expired_count: number;
};

@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);
  private readonly monthlyCap: number;
  private readonly offerStatusStreams = new Map<
    string,
    OfferStatusStreamEntry
  >();

  constructor(
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(OfferDistributionLog)
    private readonly distributionLogRepo: Repository<OfferDistributionLog>,
    @InjectRepository(EmployerPoolProfile)
    private readonly poolProfileRepo: Repository<EmployerPoolProfile>,
    @InjectRepository(EmployerProfile)
    private readonly employerProfileRepo: Repository<EmployerProfile>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @Inject(NotificationDispatchService)
    private readonly notificationDispatch: OffersNotificationPort,
    private readonly verificationService: EmployerVerificationService,
    private readonly employerRolesService: EmployerRolesService,
    @InjectRepository(HireFeedback)
    private readonly hireFeedbackRepo: Repository<HireFeedback>,
    private readonly billingService: EmployerBillingService,
  ) {
    this.monthlyCap =
      parseInt(process.env.OFFERS_MONTHLY_CAP ?? '', 10) || DEFAULT_MONTHLY_CAP;
  }

  async sendOffers(
    employerUserId: string,
    dto: CreateOfferDto,
  ): Promise<SendOffersResult> {
    // Invariant checks: fail the whole request (not per-candidate warnings)
    await this.verificationService.assertEmployerVerified(employerUserId);
    const role = await this.employerRolesService.findActiveRoleForOffer(
      employerUserId,
      dto.roleId,
    );

    const uniqueIds = [...new Set(dto.candidateIds)];
    const sentOffers: Offer[] = [];
    const warnings: SendOffersResult['warnings'] = [];

    for (const candidateUserId of uniqueIds) {
      try {
        const offer = await this.createSingleOffer(
          employerUserId,
          candidateUserId,
          dto,
          role,
        );
        sentOffers.push(offer);
      } catch (err: unknown) {
        warnings.push({
          candidateId: candidateUserId,
          reason:
            err instanceof Error ? err.message : 'Offer could not be sent',
        });
      }
    }

    return { sent_count: sentOffers.length, offers: sentOffers, warnings };
  }

  /** Public alias for backward-compat — accepts old single-candidate dto shape */
  async createOffer(
    employerUserId: string,
    dto: Omit<CreateOfferDto, 'candidateIds'> & { candidateUserId: string },
  ): Promise<Offer> {
    const { candidateUserId, ...rest } = dto;
    return this.createSingleOffer(employerUserId, candidateUserId, rest);
  }

  /** Public alias for backward-compat — accepts old bulk dto shape */
  async bulkCreateOffers(
    employerUserId: string,
    dto: {
      candidateUserIds: string[];
      roleId: string;
      message: string;
      expiresInDays?: number;
    },
  ): Promise<{
    offers: Offer[];
    failures: Array<{ candidateUserId: string; message: string }>;
  }> {
    const offers: Offer[] = [];
    const failures: Array<{ candidateUserId: string; message: string }> = [];

    for (const candidateUserId of dto.candidateUserIds) {
      try {
        const offer = await this.createOffer(employerUserId, {
          candidateUserId,
          roleId: dto.roleId,
          message: dto.message,
          expiresInDays: dto.expiresInDays,
        });
        offers.push(offer);
      } catch (err: unknown) {
        failures.push({
          candidateUserId,
          message:
            err instanceof Error ? err.message : 'Offer could not be sent',
        });
      }
    }

    return { offers, failures };
  }

  private async createSingleOffer(
    employerUserId: string,
    candidateUserId: string,
    dto: Omit<CreateOfferDto, 'candidateIds'>,
    preResolvedRole?: EmployerRole | null,
  ): Promise<Offer> {
    // Skip invariant checks when called from sendOffers (already validated once)
    if (preResolvedRole === undefined) {
      await this.verificationService.assertEmployerVerified(employerUserId);
    }

    const role =
      preResolvedRole !== undefined
        ? preResolvedRole
        : await this.employerRolesService.findActiveRoleForOffer(
            employerUserId,
            dto.roleId,
          );

    const poolProfile = await this.poolProfileRepo.findOne({
      where: { candidate_id: candidateUserId, track: role?.track },
    });

    if (!poolProfile) {
      throw new NotFoundError('Candidate not found');
    }

    // Validate candidate is Job Ready
    if (poolProfile.tier !== 'job_ready') {
      throw new ForbiddenError(
        'Offers can only be sent to Job Ready candidates',
      );
    }

    // Talent only exist for employers once they finished the job evaluation.
    const finished: unknown[] = await this.poolProfileRepo.manager.query(
      `SELECT 1 FROM assessment_attempts att
       INNER JOIN assessment_results res ON res.attempt_id = att.id
       WHERE att.talent_profile_id = $1
         AND att.assessment_type = 'advanced'
         AND att.completed_at IS NOT NULL
         AND res.tier = 'job_ready'
       LIMIT 1`,
      [poolProfile.talent_profile_id],
    );
    if (finished.length === 0) {
      throw new NotFoundError('Candidate not found');
    }

    // Validate candidate matches the track
    if (poolProfile.track !== role?.track) {
      throw new ForbiddenError(
        'Offers can only be sent to candidates that match this role.',
      );
    }

    const offerDetails = this.resolveOfferDetails(dto, role);

    const existingOffer = await this.offerRepo.findOne({
      where: {
        employer_user_id: employerUserId,
        candidate_user_id: candidateUserId,
        role_id: role?.id ?? IsNull(),
        status: In([...ACTIVE_OFFER_STATUSES]),
      },
    });
    if (existingOffer) {
      throw new ConflictError(
        'Offer already sent to this candidate for this role',
      );
    }

    // Enforce send-cap atomically via transaction
    const expiresInDays = dto.expiresInDays ?? 14;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const offer = await this.offerRepo.manager
      .transaction(async (manager) => {
        // Serialize concurrent sends per employer to prevent cap-race conditions
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          employerUserId,
        ]);

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          0,
          23,
          59,
          59,
          999,
        );
        const monthlyCount = await manager.count(OfferDistributionLog, {
          where: {
            employer_user_id: employerUserId,
            sent_at: Between(startOfMonth, endOfMonth),
          },
        });

        if (monthlyCount >= this.monthlyCap) {
          throw new HttpException(
            `Monthly offer limit reached (${this.monthlyCap}). Try again next month.`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        const created = await manager.save(Offer, {
          employer_user_id: employerUserId,
          candidate_user_id: candidateUserId,
          employer_pool_profile_id: poolProfile.id,
          role_id: role?.id ?? null,
          role_title: offerDetails.roleTitle,
          message: dto.message ?? '',
          role_description: offerDetails.roleDescription,
          compensation: offerDetails.compensation,
          employment_type: offerDetails.employmentType,
          work_arrangement: offerDetails.workArrangement,
          application_deadline: dto.applicationDeadline ?? null,
          interview_link: dto.interviewLink?.trim() || null,
          status: OfferStatus.PENDING,
          expires_at: expiresAt,
        } as Partial<Offer>);

        await manager.save(OfferDistributionLog, {
          employer_user_id: employerUserId,
          offer_id: created.id,
        } as Partial<OfferDistributionLog>);

        if (role) {
          await manager.increment(
            EmployerRole,
            { id: role.id, employer_user_id: employerUserId },
            'offers_sent_count',
            1,
          );
        }

        return created;
      })
      .catch((error: unknown) => {
        if (isActiveOfferUniqueViolation(error)) {
          throw new ConflictError('Offer already sent to this candidate');
        }
        throw error;
      });

    // Notify candidate
    const employerName = await this.resolveEmployerDisplayName(employerUserId);

    try {
      await this.notificationDispatch.notifyOfferReceived(candidateUserId, {
        offerId: offer.id,
        employerUserId,
        employerName,
        roleTitle: offer.role_title,
      });
    } catch (notifyError: unknown) {
      this.logger.error(
        `Offer notification failed offer=${offer.id}: ${String(notifyError)}`,
      );
    }

    return offer;
  }

  private resolveOfferDetails(
    dto: Omit<CreateOfferDto, 'candidateIds'>,
    role: EmployerRole | null,
  ): {
    roleTitle: string;
    roleDescription: string | null;
    compensation: string;
    employmentType: string;
    workArrangement: string;
  } {
    const roleTitle = dto.roleTitle?.trim() || role?.title?.trim();
    const compensation =
      dto.compensation?.trim() || this.formatRoleCompensation(role);
    const employmentType = dto.employmentType ?? role?.employment_type ?? null;
    const workArrangement =
      dto.workArrangement ?? role?.work_arrangement ?? null;

    if (!roleTitle) {
      throw new BadRequestError('roleTitle is required');
    }
    if (!compensation) {
      throw new BadRequestError('compensation is required');
    }
    if (!employmentType) {
      throw new BadRequestError('employmentType is required');
    }
    if (!workArrangement) {
      throw new BadRequestError('workArrangement is required');
    }

    return {
      roleTitle,
      roleDescription: dto.roleDescription?.trim() || role?.description || null,
      compensation,
      employmentType,
      workArrangement,
    };
  }

  private formatRoleCompensation(role: EmployerRole | null): string | null {
    if (!role || (role.salary_min == null && role.salary_max == null)) {
      return null;
    }

    const currency = role.currency ? `${role.currency} ` : '';
    if (role.salary_min != null && role.salary_max != null) {
      return `${currency}${role.salary_min}-${role.salary_max}`;
    }
    if (role.salary_min != null) {
      return `${currency}${role.salary_min}+`;
    }
    return `${currency}${role.salary_max}`;
  }

  async listEmployerOffers(
    employerUserId: string,
    query: ListOffersQueryDto,
  ): Promise<OfferListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Expire stale offers before querying to keep filter/pagination consistent
    await this.expireStaleOffers(employerUserId);

    const where: Record<string, unknown> = {
      employer_user_id: employerUserId,
    };

    if (query.status) {
      where.status = query.status;
    }

    const [offers, total] = await this.offerRepo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      relations: ['candidate'],
    });

    return {
      offers: offers.map((o) => this.withMaskedCandidate(o)),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    };
  }

  async listEmployerCandidatesOffers(
    employerUserId: string,
    query: ListOffersQueryDto,
  ): Promise<EmployerCandidatesOffersResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    await this.expireStaleOffers(employerUserId);

    const where: Record<string, unknown> = {
      employer_user_id: employerUserId,
    };

    if (query.status) {
      where.status = query.status;
    } else {
      where.status = In([...CANDIDATES_OFFERS_SUBTAB_STATUSES]);
    }

    const [offers, total] = await this.offerRepo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      relations: ['candidate', 'employer_pool_profile'],
    });

    const emptyStateMessage = await this.resolveCandidatesOffersEmptyMessage(
      employerUserId,
      total,
      query.status,
    );

    const [unlockedIds, feedbackOfferIds] = await Promise.all([
      this.billingService.getUnlockedIds(
        employerUserId,
        offers.map((o) => o.candidate_user_id),
      ),
      this.getFeedbackOfferIds(offers.map((o) => o.id)),
    ]);

    return {
      offers: offers.map((offer) =>
        this.toCandidatesOfferEntry(offer, unlockedIds, feedbackOfferIds),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      emptyStateMessage,
    };
  }

  private async resolveCandidatesOffersEmptyMessage(
    employerUserId: string,
    listTotal: number,
    statusFilter?: string,
  ): Promise<string | null> {
    if (listTotal > 0 || statusFilter) {
      return null;
    }

    const offersSent = await this.offerRepo.count({
      where: { employer_user_id: employerUserId },
    });

    return offersSent === 0 ? EMPLOYER_CANDIDATES_OFFERS_EMPTY_MESSAGE : null;
  }

  private async getFeedbackOfferIds(offerIds: string[]): Promise<Set<string>> {
    if (offerIds.length === 0) return new Set();
    const rows = await this.hireFeedbackRepo.find({
      where: { offer_id: In(offerIds) },
      select: ['offer_id'],
    });
    return new Set(rows.map((r) => r.offer_id));
  }

  /** First name and last initial until the employer has unlocked the talent or they accepted. */
  private candidateDisplayName(offer: Offer, revealed: boolean): string {
    const first = offer.candidate?.first_name?.trim() ?? '';
    const last = offer.candidate?.last_name?.trim() ?? '';
    if (!first && !last) return 'Unknown candidate';
    if (revealed) return `${first} ${last}`.trim();
    return `${first} ${last ? `${last.charAt(0).toUpperCase()}.` : ''}`.trim();
  }

  private toCandidatesOfferEntry(
    offer: Offer,
    unlockedIds: Set<string>,
    feedbackOfferIds: Set<string>,
  ): EmployerCandidatesOfferEntry {
    const revealed =
      offer.status === OfferStatus.ACCEPTED ||
      unlockedIds.has(offer.candidate_user_id);
    const hired = offer.status === OfferStatus.ACCEPTED && !!offer.hired_at;

    return {
      offer_id: offer.id,
      candidate_user_id: offer.candidate_user_id,
      candidate_name: this.candidateDisplayName(offer, revealed),
      candidate_avatar_url: revealed
        ? (offer.candidate?.avatar_url ?? null)
        : null,
      role_track: offer.employer_pool_profile?.track ?? null,
      job_title: offer.role_title,
      date_sent: offer.created_at,
      status: hired ? 'hired' : offer.status,
      pending_hire_feedback: hired && !feedbackOfferIds.has(offer.id),
    };
  }

  async listCandidateOffers(
    candidateUserId: string,
    query: ListOffersQueryDto,
  ): Promise<EnrichedOfferListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Expire stale offers before querying
    await this.expireStaleOffersForCandidate(candidateUserId);

    const where: Record<string, unknown> = {
      candidate_user_id: candidateUserId,
    };

    if (query.status) {
      where.status = query.status;
    }

    const [offers, total] = await this.offerRepo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      relations: ['employer'],
    });

    // Enrich with employer verification status
    const employerUserIds = [...new Set(offers.map((o) => o.employer_user_id))];
    const profiles = employerUserIds.length
      ? await this.employerProfileRepo.find({
          where: employerUserIds.map((id) => ({ user_id: id })),
          select: ['user_id', 'is_verified', 'company_name'],
        })
      : [];
    const verifiedMap = new Map(
      profiles.map((p) => [p.user_id, p.is_verified]),
    );
    const companyMap = new Map(
      profiles.map((p) => [p.user_id, p.company_name]),
    );

    const enrichedOffers = offers.map((offer) => ({
      ...this.withTalentFacingEmployer(
        offer,
        companyMap.get(offer.employer_user_id),
      ),
      is_employer_verified: verifiedMap.get(offer.employer_user_id) ?? false,
    }));

    return {
      offers: enrichedOffers,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    };
  }

  async getOfferForEmployer(
    employerUserId: string,
    offerId: string,
  ): Promise<Offer> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId, employer_user_id: employerUserId },
      relations: ['candidate'],
    });

    if (!offer) {
      throw new NotFoundError('Offer not found');
    }

    return this.withMaskedCandidate(await this.checkAndUpdateExpiry(offer));
  }

  async getOfferForCandidate(
    candidateUserId: string,
    offerId: string,
  ): Promise<EnrichedOffer> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId, candidate_user_id: candidateUserId },
      relations: ['employer'],
    });

    if (!offer) {
      throw new NotFoundError('Offer not found');
    }

    const checked = await this.checkAndUpdateExpiry(offer);
    const profile = await this.employerProfileRepo.findOne({
      where: { user_id: checked.employer_user_id },
      select: ['is_verified', 'company_name'],
    });

    return {
      ...this.withTalentFacingEmployer(checked, profile?.company_name),
      is_employer_verified: profile?.is_verified ?? false,
    };
  }

  /** Company name when set, otherwise the account holder's name. */
  private async resolveEmployerDisplayName(
    employerUserId: string,
  ): Promise<string> {
    const profile = await this.employerProfileRepo.findOne({
      where: { user_id: employerUserId },
      select: ['user_id', 'company_name'],
    });
    if (profile?.company_name?.trim()) return profile.company_name.trim();
    const employer = await this.userRepo.findOne({
      where: { id: employerUserId },
    });
    return employer
      ? `${employer.first_name ?? ''} ${employer.last_name ?? ''}`.trim()
      : 'An employer';
  }

  /**
   * Employers see who they invited, but never the candidate's contact or
   * account fields: those are part of the paid unlock.
   */
  private withMaskedCandidate<T extends Offer>(offer: T): T {
    const c = offer.candidate;
    if (!c) return offer;
    offer.candidate = {
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      fullname: `${c.first_name} ${c.last_name}`.trim(),
      country: c.country,
    } as unknown as User;
    return offer;
  }

  /** Talents see the company, not the employer user's account record. */
  private withTalentFacingEmployer<T extends Offer>(
    offer: T,
    companyName?: string | null,
  ): T {
    const e = offer.employer;
    if (!e) return offer;
    const name = companyName?.trim() || `${e.first_name} ${e.last_name}`.trim();
    offer.employer = {
      id: e.id,
      first_name: name,
      last_name: '',
      fullname: name,
      avatar_url: e.avatar_url,
      country: e.country,
    } as unknown as User;
    return offer;
  }

  async updateInterviewLink(
    employerUserId: string,
    offerId: string,
    interviewLink: string,
  ): Promise<{
    offer_id: string;
    interview_link: string;
    status: OfferStatus;
    updated_at: Date;
  }> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId, employer_user_id: employerUserId },
    });
    if (!offer) {
      throw new NotFoundError('Offer not found');
    }

    if (
      offer.status !== OfferStatus.PENDING &&
      offer.status !== OfferStatus.ACCEPTED
    ) {
      throw new BadRequestError(
        'A meeting link can only be set on an open invite',
      );
    }

    offer.interview_link = interviewLink.trim();
    const saved = await this.offerRepo.save(offer);
    return {
      offer_id: saved.id,
      interview_link: saved.interview_link ?? '',
      status: saved.status,
      updated_at: saved.updated_at,
    };
  }

  async respondToOffer(
    candidateUserId: string,
    offerId: string,
    responseAction: 'accept' | 'decline',
  ): Promise<Offer> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId, candidate_user_id: candidateUserId },
      relations: ['role'],
    });

    if (!offer) {
      throw new NotFoundError('Offer not found');
    }

    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestError(
        `Cannot respond to an offer with status: ${offer.status}`,
      );
    }

    const newStatus =
      responseAction === 'decline'
        ? OfferStatus.DECLINED
        : OfferStatus.ACCEPTED;
    const respondedAt = new Date();
    const now = new Date();

    // Atomic conditional update to prevent race conditions
    const result = await this.offerRepo.update(
      {
        id: offer.id,
        status: OfferStatus.PENDING,
        expires_at: LessThan(now),
      },
      { status: OfferStatus.EXPIRED },
    );

    // If the offer was just expired by the above, throw
    if (result.affected && result.affected > 0) {
      throw new BadRequestError('This offer has expired');
    }

    // Now atomically set the response (only if still PENDING)
    const updateResult = await this.offerRepo.update(
      { id: offer.id, status: OfferStatus.PENDING },
      {
        status: newStatus,
        responded_at: respondedAt,
      },
    );

    if (!updateResult.affected || updateResult.affected === 0) {
      throw new BadRequestError(
        `Cannot respond to an offer with status: ${offer.status}`,
      );
    }

    offer.status = newStatus;
    offer.responded_at = respondedAt;

    // Notify employer of accept/decline
    const candidate = await this.userRepo.findOne({
      where: { id: candidateUserId },
    });
    const candidateName = candidate
      ? `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim()
      : 'A candidate';

    try {
      const respondedPayload = {
        offerId: offer.id,
        candidateUserId,
        candidateName,
        roleTitle: offer.role_title,
        action: responseAction,
      };

      if (responseAction === 'accept') {
        await this.notificationDispatch.notifyOfferAccepted(
          offer.employer_user_id,
          respondedPayload,
        );
      } else {
        await this.notificationDispatch.notifyOfferDeclined(
          offer.employer_user_id,
          respondedPayload,
        );
      }
    } catch (notifyError: unknown) {
      this.logger.error(
        `Offer response notification failed offer=${offer.id}: ${String(notifyError)}`,
      );
    }

    this.publishOfferStatusChange(offer.employer_user_id, {
      type: 'offer_status_changed',
      offerId: offer.id,
      candidateUserId,
      candidateName: candidateName || 'A candidate',
      roleTitle: offer.role_title,
      status: newStatus,
      respondedAt: respondedAt.toISOString(),
    });

    return offer;
  }

  async requestCall(
    candidateUserId: string,
    offerId: string,
  ): Promise<{ offer_id: string; requested_at: string }> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId, candidate_user_id: candidateUserId },
    });
    if (!offer) {
      throw new NotFoundError('Offer not found');
    }
    if (offer.status !== OfferStatus.ACCEPTED) {
      throw new BadRequestError(
        'Only accepted interview invites can request a call',
      );
    }
    if (offer.interview_link) {
      throw new BadRequestError('This interview invite already has a link');
    }

    const candidate = await this.userRepo.findOne({
      where: { id: candidateUserId },
    });
    const candidateName = candidate
      ? `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim()
      : 'A candidate';
    const requestedAt = new Date();

    try {
      await this.notificationDispatch.dispatch(
        NotificationType.CALL_REQUESTED,
        offer.employer_user_id,
        {
          offerId: offer.id,
          candidateUserId,
          candidateName,
          roleTitle: offer.role_title,
        },
      );
    } catch (notifyError: unknown) {
      this.logger.error(
        `Call request notification failed offer=${offer.id}: ${String(notifyError)}`,
      );
    }

    return { offer_id: offer.id, requested_at: requestedAt.toISOString() };
  }

  subscribeEmployerOfferStatus(
    employerUserId: string,
    listener: (event: OfferStatusChangeEvent) => void,
  ): () => void {
    let entry = this.offerStatusStreams.get(employerUserId);
    if (!entry) {
      entry = {
        subject: new Subject<OfferStatusChangeEvent>(),
        subscriberCount: 0,
      };
      this.offerStatusStreams.set(employerUserId, entry);
    }
    entry.subscriberCount += 1;

    const subscription = entry.subject.subscribe(listener);
    let released = false;

    return () => {
      if (released) {
        return;
      }
      released = true;
      subscription.unsubscribe();

      const current = this.offerStatusStreams.get(employerUserId);
      if (!current) {
        return;
      }
      current.subscriberCount -= 1;
      if (current.subscriberCount <= 0) {
        current.subject.complete();
        this.offerStatusStreams.delete(employerUserId);
      }
    };
  }

  private publishOfferStatusChange(
    employerUserId: string,
    event: OfferStatusChangeEvent,
  ): void {
    this.offerStatusStreams.get(employerUserId)?.subject.next(event);
  }

  async getAnalytics(employerUserId: string): Promise<OfferAnalytics> {
    // Expire stale offers so counts reflect true statuses
    await this.expireStaleOffers(employerUserId);

    const monthlyCount = await this.getDistributionCount(employerUserId);

    const [acceptedCount, declinedCount, pendingCount, expiredCount] =
      await Promise.all([
        this.offerRepo.count({
          where: {
            employer_user_id: employerUserId,
            status: OfferStatus.ACCEPTED,
          },
        }),
        this.offerRepo.count({
          where: {
            employer_user_id: employerUserId,
            status: OfferStatus.DECLINED,
          },
        }),
        this.offerRepo.count({
          where: {
            employer_user_id: employerUserId,
            status: OfferStatus.PENDING,
          },
        }),
        this.offerRepo.count({
          where: {
            employer_user_id: employerUserId,
            status: OfferStatus.EXPIRED,
          },
        }),
      ]);

    return {
      offers_this_month: monthlyCount,
      monthly_cap: this.monthlyCap,
      remaining: Math.max(0, this.monthlyCap - monthlyCount),
      accepted_count: acceptedCount,
      declined_count: declinedCount,
      pending_count: pendingCount,
      expired_count: expiredCount,
    };
  }

  async markHireComplete(
    employerUserId: string,
    offerId: string,
  ): Promise<Offer> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId, employer_user_id: employerUserId },
    });

    if (!offer) {
      throw new NotFoundError('Offer not found');
    }

    if (offer.status !== OfferStatus.ACCEPTED) {
      throw new BadRequestError('Only accepted offers can be marked as hired');
    }

    // Idempotent: confirming twice must not inflate the hire count.
    if (offer.hired_at) return offer;

    const hiredAt = new Date();
    const marked = await this.offerRepo.manager.transaction(async (manager) => {
      const res = await manager
        .createQueryBuilder()
        .update(Offer)
        .set({ hired_at: hiredAt })
        .where('id = :id AND hired_at IS NULL', { id: offer.id })
        .execute();
      if (!res.affected) return false;
      await manager.increment(
        EmployerProfile,
        { user_id: employerUserId },
        'hire_count',
        1,
      );
      return true;
    });
    if (marked) offer.hired_at = hiredAt;
    return offer;
  }

  /** Hires the employer confirmed but has not rated yet. */
  async listPendingHireFeedback(
    employerUserId: string,
  ): Promise<{ requests: HireFeedbackRequestEntry[] }> {
    const hired = await this.offerRepo
      .createQueryBuilder('offer')
      .innerJoinAndSelect('offer.candidate', 'candidate')
      .where('offer.employer_user_id = :employerUserId', { employerUserId })
      .andWhere('offer.status = :status', { status: OfferStatus.ACCEPTED })
      .andWhere('offer.hired_at IS NOT NULL')
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM hire_feedback hf WHERE hf.offer_id = offer.id)',
      )
      .orderBy('offer.hired_at', 'DESC')
      .getMany();

    return {
      requests: hired.map((offer) => ({
        id: offer.id,
        offer_id: offer.id,
        candidate_user_id: offer.candidate_user_id,
        candidate_name: this.candidateDisplayName(offer, true),
        candidate_avatar_url: offer.candidate?.avatar_url ?? null,
        role_title: offer.role_title,
        status: 'pending' as const,
        requested_at: offer.hired_at as Date,
        submitted_at: null,
      })),
    };
  }

  async submitHireFeedback(
    employerUserId: string,
    offerId: string,
    dto: SubmitHireFeedbackDto,
  ): Promise<{ status: 'success' }> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId, employer_user_id: employerUserId },
    });
    if (!offer) {
      throw new NotFoundError('Offer not found');
    }
    if (offer.status !== OfferStatus.ACCEPTED || !offer.hired_at) {
      throw new BadRequestError('You can only rate a hire you have confirmed');
    }
    const existing = await this.hireFeedbackRepo.count({
      where: { offer_id: offer.id },
    });
    if (existing > 0) {
      throw new ConflictError('You already rated this hire');
    }
    await this.hireFeedbackRepo.save({
      offer_id: offer.id,
      employer_user_id: employerUserId,
      candidate_user_id: offer.candidate_user_id,
      overall_rating: dto.overallRating,
      would_hire_again: dto.wouldHireAgain,
      comment: dto.comment?.trim() || null,
    });
    return { status: 'success' };
  }

  async getTalentTrackRecord(
    candidateUserId: string,
  ): Promise<TalentTrackRecord> {
    const raw = await this.hireFeedbackRepo
      .createQueryBuilder('hf')
      .select('COUNT(*)', 'count')
      .addSelect('AVG(hf.overall_rating)', 'avg')
      .addSelect(
        'AVG(CASE WHEN hf.would_hire_again THEN 1 ELSE 0 END)',
        'again',
      )
      .where('hf.candidate_user_id = :candidateUserId', { candidateUserId })
      .getRawOne<{ count: string; avg: string | null; again: string | null }>();
    const count = Number(raw?.count ?? 0);
    return {
      average_rating:
        count && raw?.avg ? Math.round(Number(raw.avg) * 10) / 10 : null,
      rating_count: count,
      would_hire_again_rate:
        count && raw?.again ? Math.round(Number(raw.again) * 100) : null,
    };
  }

  async withdrawOffer(
    employerUserId: string,
    offerId: string,
  ): Promise<{ status: string; message: string }> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId, employer_user_id: employerUserId },
    });

    if (!offer) {
      throw new NotFoundError('Offer not found');
    }

    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestError('Only pending offers can be withdrawn');
    }

    await this.offerRepo.update(
      { id: offer.id, status: OfferStatus.PENDING },
      { status: OfferStatus.WITHDRAWN },
    );

    // Notify candidate
    try {
      const employerName =
        await this.resolveEmployerDisplayName(employerUserId);
      await this.notificationDispatch.notifyOfferWithdrawn(
        offer.candidate_user_id,
        {
          offerId: offer.id,
          employerUserId,
          employerName,
          roleTitle: offer.role_title,
        },
      );
    } catch (notifyError: unknown) {
      this.logger.error(
        `Offer withdrawn notification failed offer=${offer.id}: ${String(notifyError)}`,
      );
    }

    return { status: 'success', message: 'Offer withdrawn' };
  }

  private async getDistributionCount(employerUserId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    return this.distributionLogRepo.count({
      where: {
        employer_user_id: employerUserId,
        sent_at: Between(startOfMonth, endOfMonth),
      },
    });
  }

  private async checkAndUpdateExpiry(offer: Offer): Promise<Offer> {
    if (offer.status === OfferStatus.PENDING && offer.expires_at < new Date()) {
      offer.status = OfferStatus.EXPIRED;
      await this.offerRepo.update(offer.id, {
        status: OfferStatus.EXPIRED,
      });
    }
    return offer;
  }

  private async expireStaleOffers(employerUserId: string): Promise<void> {
    await this.offerRepo.update(
      {
        employer_user_id: employerUserId,
        status: OfferStatus.PENDING,
        expires_at: LessThan(new Date()),
      },
      { status: OfferStatus.EXPIRED },
    );
  }

  private async expireStaleOffersForCandidate(
    candidateUserId: string,
  ): Promise<void> {
    await this.offerRepo.update(
      {
        candidate_user_id: candidateUserId,
        status: OfferStatus.PENDING,
        expires_at: LessThan(new Date()),
      },
      { status: OfferStatus.EXPIRED },
    );
  }
}
