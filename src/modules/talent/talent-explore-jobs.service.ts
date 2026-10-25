import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  EmployerRole,
  EmployerRoleStatus,
  EmployerRoleVisibility,
} from '../employer-roles/entities/employer-role.entity';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';
import { User } from '../users/entities/user.entity';
import { EmployerPoolProfile } from './entities/employer-pool-profile.entity';
import { TalentProfile } from './entities/talent-profile.entity';
import { TalentRoleInterest } from './entities/talent-role-interest.entity';

const WEEKLY_INTEREST_LIMIT = 10;

export type ExploreJobsResult = {
  roles: Array<Record<string, unknown>>;
  page: number;
  limit: number;
  total: number;
  total_pages: number;
};

@Injectable()
export class TalentExploreJobsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(EmployerRole)
    private readonly roleRepo: Repository<EmployerRole>,
    @InjectRepository(TalentRoleInterest)
    private readonly interestRepo: Repository<TalentRoleInterest>,
    @InjectRepository(TalentProfile)
    private readonly talentProfileRepo: Repository<TalentProfile>,
    @InjectRepository(EmployerPoolProfile)
    private readonly poolProfileRepo: Repository<EmployerPoolProfile>,
    @InjectRepository(EmployerProfile)
    private readonly employerProfileRepo: Repository<EmployerProfile>,
  ) {}

  async listRoles(
    talentUserId: string,
    page = 1,
    limit = 20,
  ): Promise<ExploreJobsResult> {
    const profile = await this.getTalentProfile(talentUserId);
    const trackTerms = this.resolveTrackTerms(profile);

    const qb = this.roleRepo
      .createQueryBuilder('role')
      .leftJoin(User, 'employer', 'employer.id = role.employer_user_id')
      .where('role.status = :status', { status: EmployerRoleStatus.ACTIVE })
      .andWhere('role.visibility = :visibility', {
        visibility: EmployerRoleVisibility.PUBLIC,
      });

    if (trackTerms.length > 0) {
      qb.andWhere(
        `(
          LOWER(role.category) IN (:...trackTerms)
          OR LOWER(role.title) IN (:...trackTerms)
          OR EXISTS (
            SELECT 1 FROM unnest(COALESCE(role.keywords, ARRAY[]::text[])) keyword
            WHERE LOWER(keyword) IN (:...trackTerms)
          )
        )`,
        { trackTerms },
      );
    }

    const total = await qb.getCount();
    const rows = await qb
      .select([
        'role.id AS "id"',
        'role.title AS "title"',
        'role.category AS "category"',
        'role.employer_user_id AS "employerUserId"',
        'role.employment_type AS "employmentType"',
        'role.work_arrangement AS "workArrangement"',
        'role.description AS "description"',
        'role.keywords AS "keywords"',
        'role.applicant_cap AS "applicantCap"',
        'role.interested_count AS "interestedCount"',
        'role.created_at AS "createdAt"',
        'employer.avatar_url AS "employerLogoUrl"',
      ])
      .orderBy('role.created_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<Record<string, unknown>>();

    const roleIds = rows.map((row) => String(row.id));
    const [interests, employerProfiles] = await Promise.all([
      roleIds.length
        ? this.interestRepo.find({
            where: { talent_user_id: talentUserId, role_id: In(roleIds) },
            select: ['role_id'],
          })
        : [],
      rows.length
        ? this.employerProfileRepo.find({
            where: rows.map((row) => ({
              user_id: String(row.employerUserId),
            })),
          })
        : [],
    ]);

    const interestedRoleIds = new Set(
      interests.map((interest) => interest.role_id),
    );
    const employerProfilesByUserId = new Map(
      employerProfiles.map((profile) => [profile.user_id, profile]),
    );

    return {
      roles: rows.map((row) => {
        const employerProfile = employerProfilesByUserId.get(
          String(row.employerUserId),
        );
        const applicantCap =
          row.applicantCap === null || row.applicantCap === undefined
            ? null
            : Number(row.applicantCap);
        const interestedCount = Number(row.interestedCount ?? 0);
        return {
          id: row.id,
          title: row.title,
          category: row.category,
          employer_name: employerProfile?.company_name ?? null,
          employer_logo_url: row.employerLogoUrl ?? null,
          company_url:
            employerProfile?.company_website ??
            employerProfile?.website_url ??
            null,
          employment_type: row.employmentType ?? null,
          work_arrangement: row.workArrangement ?? null,
          description: row.description ?? null,
          keywords: row.keywords ?? [],
          is_full: applicantCap !== null && interestedCount >= applicantCap,
          already_interested: interestedRoleIds.has(String(row.id)),
          created_at: row.createdAt,
        };
      }),
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    };
  }

  async getWeeklyCap(talentUserId: string) {
    const { start, reset } = this.getCurrentWeekWindow();
    // TypeORM cannot express >= with a plain count in this repo style; keep the
    // SQL localized so weekly cap logic remains database-authoritative.
    const rawRows: unknown = await this.interestRepo.query(
      `SELECT COUNT(*)::int AS count
       FROM talent_role_interests
       WHERE talent_user_id = $1 AND created_at >= $2 AND created_at < $3`,
      [talentUserId, start, reset],
    );
    const rows = Array.isArray(rawRows)
      ? (rawRows as Array<{ count: number | string }>)
      : [];
    const count = rows[0]?.count ?? 0;
    const usedThisWeek = Number(count ?? 0);
    return {
      weekly_limit: WEEKLY_INTEREST_LIMIT,
      used_this_week: usedThisWeek,
      weekly_remaining: Math.max(0, WEEKLY_INTEREST_LIMIT - usedThisWeek),
      resets_at: reset.toISOString(),
    };
  }

  async markInterested(talentUserId: string, roleId: string) {
    await this.assertTalentIsJobReady(talentUserId);
    const { start, reset } = this.getCurrentWeekWindow();

    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `talent-interest:${talentUserId}`,
      ]);

      const role = await manager.findOne(EmployerRole, {
        where: {
          id: roleId,
          status: EmployerRoleStatus.ACTIVE,
          visibility: EmployerRoleVisibility.PUBLIC,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!role) {
        throw new NotFoundException('Role not found');
      }

      const existing = await manager.findOne(TalentRoleInterest, {
        where: { talent_user_id: talentUserId, role_id: roleId },
      });
      if (existing) {
        const weekly = await this.countWeeklyInterests(
          manager,
          talentUserId,
          start,
          reset,
        );
        return {
          role_id: roleId,
          clicked_at: existing.created_at,
          weekly_remaining: Math.max(0, WEEKLY_INTEREST_LIMIT - weekly),
        };
      }

      const weekly = await this.countWeeklyInterests(
        manager,
        talentUserId,
        start,
        reset,
      );
      if (weekly >= WEEKLY_INTEREST_LIMIT) {
        throw new HttpException(
          {
            message:
              "You've reached your weekly limit of 10 expressions of interest. Try again next week.",
            data: {
              weekly_remaining: 0,
              resets_at: reset.toISOString(),
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (
        role.applicant_cap !== null &&
        role.interested_count >= role.applicant_cap
      ) {
        throw new ConflictException('This role has reached its applicant cap.');
      }

      const interest = await manager.save(TalentRoleInterest, {
        talent_user_id: talentUserId,
        role_id: roleId,
      } as Partial<TalentRoleInterest>);
      await manager.increment(
        EmployerRole,
        { id: roleId },
        'interested_count',
        1,
      );

      return {
        role_id: roleId,
        clicked_at: interest.created_at,
        weekly_remaining: Math.max(0, WEEKLY_INTEREST_LIMIT - weekly - 1),
      };
    });
  }

  private async assertTalentIsJobReady(talentUserId: string): Promise<void> {
    const poolProfile = await this.poolProfileRepo.findOne({
      where: { candidate_id: talentUserId, tier: 'job_ready' },
      select: ['id'],
    });
    if (!poolProfile) {
      throw new ForbiddenException(
        'Complete your job-ready assessment to express interest.',
      );
    }
  }

  private async getTalentProfile(talentUserId: string): Promise<TalentProfile> {
    const profile = await this.talentProfileRepo.findOne({
      where: { user_id: talentUserId },
    });
    if (!profile) {
      throw new NotFoundException('Talent profile not found');
    }
    return profile;
  }

  private resolveTrackTerms(profile: TalentProfile): string[] {
    const values = [
      profile.track,
      profile.role_track,
      ...(profile.role_tracks ?? []),
    ].filter((value): value is string => Boolean(value));
    return [...new Set(values.map((value) => value.trim().toLowerCase()))];
  }

  private async countWeeklyInterests(
    manager: {
      query: (
        sql: string,
        params: unknown[],
      ) => Promise<Array<{ count: number }>>;
    },
    talentUserId: string,
    start: Date,
    reset: Date,
  ): Promise<number> {
    const [{ count }] = await manager.query(
      `SELECT COUNT(*)::int AS count
       FROM talent_role_interests
       WHERE talent_user_id = $1 AND created_at >= $2 AND created_at < $3`,
      [talentUserId, start, reset],
    );
    return Number(count ?? 0);
  }

  private getCurrentWeekWindow(): { start: Date; reset: Date } {
    const now = new Date();
    const day = now.getUTCDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const start = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + diffToMonday,
      ),
    );
    const reset = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { start, reset };
  }
}
