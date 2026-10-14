import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { EmployerAssessment } from '../employer-assessments/entities/employer-assessment.entity';
import {
  EmployerAssessmentDeliveryMode,
  EmployerAssessmentInvite,
} from '../employer-assessments/entities/employer-assessment-invite.entity';
import { EmployerAssessmentSubmission } from '../employer-assessments/entities/employer-assessment-submission.entity';
import { Offer, OfferStatus } from '../offers/entities/offer.entity';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { TalentRoleInterest } from '../talent/entities/talent-role-interest.entity';
import { User } from '../users/entities/user.entity';
import {
  EmployerRole,
  EmployerRoleStatus,
  EmployerRoleVisibility,
} from './entities/employer-role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class EmployerRolesService {
  private readonly logger = new Logger(EmployerRolesService.name);

  constructor(
    @InjectRepository(EmployerRole)
    private readonly roleRepo: Repository<EmployerRole>,
    @InjectRepository(EmployerAssessment)
    private readonly assessmentRepo: Repository<EmployerAssessment>,
    @InjectRepository(EmployerPoolProfile)
    private readonly poolProfileRepo: Repository<EmployerPoolProfile>,
    @InjectRepository(TalentRoleInterest)
    private readonly interestRepo: Repository<TalentRoleInterest>,
    @InjectRepository(EmployerAssessmentInvite)
    private readonly inviteRepo: Repository<EmployerAssessmentInvite>,
    @InjectRepository(EmployerAssessmentSubmission)
    private readonly submissionRepo: Repository<EmployerAssessmentSubmission>,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
  ) {}

  async create(
    employerUserId: string,
    dto: CreateRoleDto,
    jdFileUrl?: string | null,
  ): Promise<EmployerRole> {
    this.assertSalaryRange(dto.salaryMin, dto.salaryMax);
    if (dto.assessmentId) {
      await this.assertAssessmentBelongsToEmployer(
        employerUserId,
        dto.assessmentId,
      );
    }

    const title = dto.title.trim();

    const rawKeywords =
      dto.keywords && dto.keywords.length > 0
        ? dto.keywords
        : (dto.keyword ?? []);
    const keywords = rawKeywords.map((k) => k.trim()).filter(Boolean);
    const description = dto.description?.trim() || dto.jd_text?.trim() || null;

    const role = this.roleRepo.create({
      employer_user_id: employerUserId,
      title,
      track: dto.track,
      category: dto.category.trim(),
      description,
      jd_file_url: jdFileUrl ?? null,
      employment_type: dto.employmentType ?? null,
      work_arrangement: dto.workArrangement ?? null,
      education: dto.education,
      level: dto.level,
      keywords: keywords.length ? keywords : null,
      salary_min: dto.salaryMin ?? null,
      salary_max: dto.salaryMax ?? null,
      currency: dto.currency?.trim().toUpperCase() ?? null,
      assessment_id: dto.assessmentId ?? null,
      status: EmployerRoleStatus.ACTIVE,
      visibility: dto.visibility ?? EmployerRoleVisibility.PUBLIC,
      applicant_cap: dto.applicantCap ?? null,
      interested_count: 0,
    });

    const saved = await this.roleRepo.save(role).catch((err: unknown) => {
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new BadRequestException(
          `A role with the title "${title}" already exists.`,
        );
      }
      throw err;
    });
    this.logger.log(
      `Role created: id=${saved.id} employer=${employerUserId} title="${saved.title}"`,
    );
    return saved;
  }

  async findAllForEmployer(
    employerUserId: string,
    status?: EmployerRoleStatus,
  ): Promise<EmployerRole[]> {
    const where: Record<string, unknown> = { employer_user_id: employerUserId };
    if (status) {
      where.status = status;
    }
    return this.roleRepo.find({
      where,
      order: { created_at: 'DESC' },
      relations: ['assessment'],
    });
  }

  async findOneForEmployer(
    employerUserId: string,
    roleId: string,
  ): Promise<EmployerRole> {
    const role = await this.roleRepo.findOne({
      where: { id: roleId, employer_user_id: employerUserId },
      relations: ['assessment'],
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  async update(
    employerUserId: string,
    roleId: string,
    dto: UpdateRoleDto,
    jdFileUrl?: string | null,
  ): Promise<EmployerRole> {
    const role = await this.findOneForEmployer(employerUserId, roleId);

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      role.title = title;
    }
    if (dto.category !== undefined) role.category = dto.category.trim();
    if (dto.description !== undefined || dto.jd_text !== undefined) {
      role.description = dto.description?.trim() || dto.jd_text?.trim() || null;
      if (role.description) {
        role.jd_file_url = null;
      }
    }
    if (
      jdFileUrl !== undefined &&
      jdFileUrl !== null &&
      (dto.description?.trim() || dto.jd_text?.trim())
    ) {
      throw new BadRequestException(
        'Provide either description/jd_text or jd_file, not both.',
      );
    }
    if (jdFileUrl !== undefined) {
      role.jd_file_url = jdFileUrl ?? null;
      if (role.jd_file_url) {
        role.description = null;
      }
    }
    if (dto.employmentType !== undefined) {
      role.employment_type = dto.employmentType;
    }
    if (dto.workArrangement !== undefined) {
      role.work_arrangement = dto.workArrangement;
    }
    if (dto.keywords !== undefined || dto.keyword !== undefined) {
      const raw =
        dto.keywords && dto.keywords.length > 0
          ? dto.keywords
          : (dto.keyword ?? []);
      const keywords = raw.map((k) => k.trim()).filter(Boolean);
      role.keywords = keywords.length ? keywords : null;
    }
    if (dto.salaryMin !== undefined) role.salary_min = dto.salaryMin;
    if (dto.salaryMax !== undefined) role.salary_max = dto.salaryMax;
    if (dto.currency !== undefined) {
      role.currency = dto.currency?.trim().toUpperCase();
    }
    if (dto.assessmentId !== undefined) {
      if (dto.assessmentId) {
        await this.assertAssessmentBelongsToEmployer(
          employerUserId,
          dto.assessmentId,
        );
      }
      role.assessment_id = dto.assessmentId;
    }
    if (dto.visibility !== undefined) {
      role.visibility = dto.visibility;
    }
    if (dto.applicantCap !== undefined) {
      role.applicant_cap = dto.applicantCap;
    }

    this.assertSalaryRange(role.salary_min, role.salary_max);

    return this.roleRepo.save(role).catch((err: unknown) => {
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new BadRequestException(
          `A role with the title "${role.title}" already exists.`, // this should
          // never throw because there's no unique constraint on role.title
        );
      }
      throw err;
    });
  }

  async attachAssessment(
    employerUserId: string,
    roleId: string,
    assessmentId: string,
  ): Promise<EmployerRole> {
    return this.update(employerUserId, roleId, { assessmentId });
  }

  async close(employerUserId: string, roleId: string): Promise<EmployerRole> {
    const role = await this.findOneForEmployer(employerUserId, roleId);
    if (role.status === EmployerRoleStatus.CLOSED) {
      throw new BadRequestException('Role is already closed');
    }
    role.status = EmployerRoleStatus.CLOSED;
    return this.roleRepo.save(role);
  }

  async reopen(employerUserId: string, roleId: string): Promise<EmployerRole> {
    const role = await this.findOneForEmployer(employerUserId, roleId);
    if (role.status === EmployerRoleStatus.ACTIVE) {
      throw new BadRequestException('Role is already active');
    }
    role.status = EmployerRoleStatus.ACTIVE;
    return this.roleRepo.save(role);
  }

  async incrementOfferCount(roleId: string): Promise<void> {
    await this.roleRepo.increment({ id: roleId }, 'offers_sent_count', 1);
  }

  async findActiveRoleForOffer(
    employerUserId: string,
    roleId: string,
  ): Promise<EmployerRole> {
    const role = await this.findOneForEmployer(employerUserId, roleId);
    if (role.status !== EmployerRoleStatus.ACTIVE) {
      throw new ForbiddenException('Cannot send offers for a closed role');
    }
    return role;
  }

  async findActiveRolesForEmployer(
    employerUserId: string,
  ): Promise<EmployerRole[]> {
    return this.roleRepo.find({
      where: {
        employer_user_id: employerUserId,
        status: EmployerRoleStatus.ACTIVE,
      },
      order: { created_at: 'DESC' },
    });
  }

  async listRoleCandidates(
    employerUserId: string,
    roleId: string,
    query: {
      tab?: 'best_match' | 'other' | 'interested' | 'all';
      page?: number;
      limit?: number;
      search?: string;
    },
  ) {
    const role = await this.findOneForEmployer(employerUserId, roleId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const tab = query.tab ?? 'all';

    const baseQb = this.poolProfileRepo
      .createQueryBuilder('pool')
      .innerJoin(User, 'u', 'u.id = pool.candidate_id')
      .leftJoin(
        TalentRoleInterest,
        'interest',
        'interest.role_id = :roleId AND interest.talent_user_id = pool.candidate_id',
        { roleId },
      )
      .where('pool.tier = :tier', { tier: 'job_ready' });

    if (query.search?.trim()) {
      baseQb.andWhere(
        `(u.email ILIKE :search OR u.first_name ILIKE :search OR u.last_name ILIKE :search OR CONCAT(u.first_name, ' ', u.last_name) ILIKE :search)`,
        { search: `%${query.search.trim()}%` },
      );
    }

    const [bestMatchCount, otherCount, interestedCount, totalCount] =
      await Promise.all([
        baseQb
          .clone()
          .andWhere('pool.score >= :bestMatchScore', {
            bestMatchScore: 80,
          })
          .getCount(),
        baseQb
          .clone()
          .andWhere('pool.score < :bestMatchScore', {
            bestMatchScore: 80,
          })
          .getCount(),
        baseQb.clone().andWhere('interest.id IS NOT NULL').getCount(),
        baseQb.clone().getCount(),
      ]);

    const qb = baseQb.clone();
    if (tab === 'best_match') {
      qb.andWhere('pool.score >= :bestMatchScore', { bestMatchScore: 80 });
    } else if (tab === 'other') {
      qb.andWhere('pool.score < :bestMatchScore', { bestMatchScore: 80 });
    } else if (tab === 'interested') {
      qb.andWhere('interest.id IS NOT NULL');
    }

    const total = await qb.getCount();
    const rows = await qb
      .select([
        'pool.candidate_id AS "candidateId"',
        'u.first_name AS "firstName"',
        'u.last_name AS "lastName"',
        'u.avatar_url AS "avatarUrl"',
        'pool.track AS "roleTrack"',
        'pool.verified_level AS "verifiedLevel"',
        'pool.score AS "score"',
        'interest.id AS "interestId"',
        'interest.created_at AS "interestedAt"',
      ])
      .orderBy('interest.created_at', 'DESC', 'NULLS LAST')
      .addOrderBy('pool.score', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<Record<string, string | number | null>>();

    const candidateIds = rows.map((row) => String(row.candidateId));
    const [invites, submissions, offers] =
      candidateIds.length > 0
        ? await Promise.all([
            role.assessment_id
              ? this.inviteRepo.find({
                  where: {
                    assessment_id: role.assessment_id,
                    candidate_user_id: In(candidateIds),
                  },
                })
              : [],
            role.assessment_id
              ? this.submissionRepo.find({
                  where: {
                    assessment_id: role.assessment_id,
                    candidate_user_id: In(candidateIds),
                  },
                })
              : [],
            this.offerRepo.find({
              where: {
                employer_user_id: employerUserId,
                role_id: roleId,
                candidate_user_id: In(candidateIds),
              },
            }),
          ])
        : [[], [], []];

    const inviteByCandidate = new Set(
      invites.map((invite) => invite.candidate_user_id),
    );
    const submissionByCandidate = new Map(
      submissions.map((submission) => [
        submission.candidate_user_id,
        submission,
      ]),
    );
    const offerByCandidate = new Map(
      offers.map((offer) => [offer.candidate_user_id, offer]),
    );

    return {
      role: {
        id: role.id,
        title: role.title,
        is_full:
          role.applicant_cap !== null &&
          role.interested_count >= role.applicant_cap,
      },
      counts: {
        best_match: bestMatchCount,
        other: otherCount,
        interested: interestedCount,
        total: totalCount,
      },
      candidates: rows.map((row) => {
        const candidateId = String(row.candidateId);
        const submission = submissionByCandidate.get(candidateId);
        const offer = offerByCandidate.get(candidateId);
        const assessmentStatus = submission
          ? 'completed'
          : inviteByCandidate.has(candidateId)
            ? 'sent'
            : 'not_sent';
        const assessmentResult = submission
          ? submission.passed
            ? 'pass'
            : 'fail'
          : null;
        const offerStatus = this.resolveCandidateOfferStatus(offer?.status);
        return {
          candidate_id: candidateId,
          full_name: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(),
          avatar_url: row.avatarUrl,
          role: row.verifiedLevel,
          role_track: row.roleTrack,
          seniority_badge: this.formatSeniorityBadge(row.verifiedLevel),
          match_score: Number(row.score ?? 0),
          is_interested: row.interestId !== null,
          interested_at: row.interestedAt,
          pipeline_status: this.resolvePipelineStatus(
            row.interestId !== null,
            assessmentStatus,
            submission?.passed,
            offerStatus,
          ),
          assessment_status: assessmentStatus,
          assessment_result: assessmentResult,
          offer_status: offerStatus,
          interview_link: offer?.interview_link ?? null,
          updated_at:
            offer?.updated_at ?? submission?.completed_at ?? row.interestedAt,
        };
      }),
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    };
  }

  async sendAssessmentToCandidate(
    employerUserId: string,
    roleId: string,
    candidateId: string,
    assessmentId: string,
  ) {
    const role = await this.findOneForEmployer(employerUserId, roleId);
    await this.assertAssessmentBelongsToEmployer(employerUserId, assessmentId);
    const existing = await this.inviteRepo.findOne({
      where: { assessment_id: assessmentId, candidate_user_id: candidateId },
    });
    if (!existing) {
      await this.inviteRepo.save({
        assessment_id: assessmentId,
        candidate_user_id: candidateId,
        delivery_mode: EmployerAssessmentDeliveryMode.DIRECT,
      } as Partial<EmployerAssessmentInvite>);
    }
    if (role.assessment_id !== assessmentId) {
      role.assessment_id = assessmentId;
      await this.roleRepo.save(role);
    }
    return {
      candidate_id: candidateId,
      pipeline_status: 'assessment_sent',
      updated_at: new Date().toISOString(),
    };
  }

  private resolvePipelineStatus(
    interested: boolean,
    assessmentStatus: string,
    assessmentPassed?: boolean,
    offerStatus: 'none' | 'invited' | 'accepted' | 'declined' = 'none',
  ): string {
    if (offerStatus === 'accepted') return 'interview_accepted';
    if (offerStatus === 'declined') return 'interview_declined';
    if (offerStatus === 'invited') return 'interview_invited';
    if (assessmentStatus === 'completed') {
      return assessmentPassed
        ? 'assessment_completed_pass'
        : 'assessment_completed_fail';
    }
    if (assessmentStatus === 'sent') return 'assessment_sent';
    if (interested) return 'interested';
    return 'matched';
  }

  private resolveCandidateOfferStatus(
    status?: OfferStatus,
  ): 'none' | 'invited' | 'accepted' | 'declined' {
    if (status === OfferStatus.ACCEPTED) return 'accepted';
    if (status === OfferStatus.DECLINED) return 'declined';
    if (status === OfferStatus.PENDING) return 'invited';
    return 'none';
  }

  private formatSeniorityBadge(level: unknown): string | null {
    if (typeof level !== 'string' || level.length === 0) return null;
    return level
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private assertSalaryRange(
    salaryMin: number | null | undefined,
    salaryMax: number | null | undefined,
  ): void {
    if (salaryMin != null && salaryMax != null && salaryMin > salaryMax) {
      throw new BadRequestException('salaryMin cannot exceed salaryMax');
    }
  }

  private async assertAssessmentBelongsToEmployer(
    employerUserId: string,
    assessmentId: string,
  ): Promise<void> {
    const assessment = await this.assessmentRepo.findOne({
      where: { id: assessmentId, employer_user_id: employerUserId },
      select: ['id'],
    });
    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }
  }
}
