import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EmployerRole,
  EmployerRoleStatus,
} from '../employer-roles/entities/employer-role.entity';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { NotificationType } from './notification-type.enum';
import {
  isNotificationDuplicateError,
  NotificationsService,
} from './notifications.service';

/**
 * Tells employers right away when a newly job-ready talent fits one of their
 * open roles (same track, and same level when the role names one).
 */
@Injectable()
export class RoleMatchAlertService {
  private readonly logger = new Logger(RoleMatchAlertService.name);

  constructor(
    @InjectRepository(EmployerRole)
    private readonly roleRepo: Repository<EmployerRole>,
    @InjectRepository(EmployerPoolProfile)
    private readonly poolRepo: Repository<EmployerPoolProfile>,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Never throws: an alert failure must not affect the talent's submission. */
  async notifyForCandidate(
    talentProfileId: string,
    candidateUserId: string,
  ): Promise<void> {
    try {
      const pool = await this.poolRepo.findOne({
        where: { talent_profile_id: talentProfileId },
      });
      if (!pool?.track) return;

      const roles = await this.roleRepo.find({
        where: {
          track: pool.track as never,
          status: EmployerRoleStatus.ACTIVE,
        },
      });
      const fitting = roles.filter(
        (r) => !r.level || String(r.level) === pool.verified_level,
      );

      const byEmployer = new Map<string, EmployerRole[]>();
      for (const role of fitting) {
        const list = byEmployer.get(role.employer_user_id) ?? [];
        list.push(role);
        byEmployer.set(role.employer_user_id, list);
      }

      for (const [employerUserId, employerRoles] of byEmployer) {
        const titles = employerRoles.map((r) => r.title);
        try {
          await this.notificationsService.create({
            userId: employerUserId,
            type: NotificationType.JOB_READY_MATCHES_AVAILABLE,
            title: 'A job-ready talent fits your open role',
            body: `A new job-ready ${pool.verified_level} talent matches ${titles.join(', ')}.`,
            data: {
              candidate_user_id: candidateUserId,
              role_ids: employerRoles.map((r) => r.id),
              role_titles: titles,
              match_count: 1,
            },
          });
        } catch (error) {
          if (!isNotificationDuplicateError(error)) throw error;
        }
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Role match alert failed for profile=${talentProfileId}: ${String(error)}`,
      );
    }
  }
}
