import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { normalizeEmail } from '../../../common/transforms/normalize-email';
import { PasswordResetQueueService } from '../../auth/password-reset-queue.service';
import { MailService } from '../../mail/mail.service';
import { AdminEmailChangeAudit } from '../../users/entities/admin-email-change-audit.entity';
import { AdminTier, User, UserRole } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import {
  BadRequestError,
  ConflictError,
  ErrorMessages,
  ForbiddenError,
  NotFoundError,
  SuccessMessages,
} from '../../../shared';
import { ChangeAdminEmailDto } from './dto/change-admin-email.dto';
import { ChangeAdminRoleDto } from './dto/change-admin-role.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { ListAdminsQueryDto } from './dto/list-admins-query.dto';

export type AdminAccountStatus = 'active' | 'pending_setup' | 'deactivated';

export type AdminAccountRow = {
  id: string;
  name: string;
  email: string;
  role: AdminTier;
  last_login: string | null;
  status: AdminAccountStatus;
};

function isPostgresUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const code =
    (err as QueryFailedError & { code?: string }).code ??
    (err.driverError as { code?: string } | undefined)?.code;
  return code === '23505';
}

function deriveAdminStatus(user: User): AdminAccountStatus {
  if (!user.is_active) return 'deactivated';
  if (!user.password) return 'pending_setup';
  return 'active';
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from(randomBytes(12))
    .map((b) => chars[b % chars.length])
    .join('');
}

function invitePlaceholderName(email: string): {
  first_name: string;
  last_name: string;
} {
  const local = email.split('@')[0]?.trim() || 'admin';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      first_name: parts[0].charAt(0).toUpperCase() + parts[0].slice(1),
      last_name: parts
        .slice(1)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' '),
    };
  }
  return {
    first_name: local.charAt(0).toUpperCase() + local.slice(1),
    last_name: 'Admin',
  };
}

@Injectable()
export class AdminAdminsService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AdminEmailChangeAudit)
    private readonly emailChangeAuditRepo: Repository<AdminEmailChangeAudit>,
    private readonly usersService: UsersService,
    private readonly passwordResetQueue: PasswordResetQueueService,
    private readonly mailService: MailService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async findAll(query: ListAdminsQueryDto): Promise<{
    items: AdminAccountRow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.userRepo
      .createQueryBuilder('u')
      .where('u.role = :role', { role: UserRole.ADMIN })
      .andWhere('u.admin_tier IS NOT NULL');

    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(u.email) LIKE :term OR LOWER(u.first_name) LIKE :term OR LOWER(u.last_name) LIKE :term)`,
        { term },
      );
    }

    if (query.status === 'deactivated') {
      qb.andWhere('u.is_active = false');
    } else if (query.status === 'pending_setup') {
      qb.andWhere('u.is_active = true').andWhere('u.password IS NULL');
    } else if (query.status === 'active') {
      qb.andWhere('u.is_active = true').andWhere('u.password IS NOT NULL');
    }

    qb.orderBy('u.created_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit);

    const [users, total] = await qb.getManyAndCount();

    const items = users.map((user) => this.toAdminAccountRow(user));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async invite(
    dto: InviteAdminDto,
    actorId: string,
  ): Promise<{
    message: string;
    temp_password: string;
    account: AdminAccountRow;
  }> {
    void actorId;
    const normalizedEmail = normalizeEmail(dto.email) as string;
    const existing = await this.usersService.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictError(ErrorMessages.USER.EMAIL_ALREADY_REGISTERED);
    }

    const { first_name, last_name } = invitePlaceholderName(normalizedEmail);
    const tempPassword = generateTempPassword();
    const passwordHash = await argon2.hash(tempPassword);

    let user: User;
    try {
      user = await this.userRepo.save(
        this.userRepo.create({
          email: normalizedEmail,
          password: passwordHash,
          first_name,
          last_name,
          country: 'Nigeria',
          avatar_url: null,
          is_verified: true,
          onboarding_complete: true,
          role: UserRole.ADMIN,
          admin_tier: AdminTier.ADMIN,
          is_active: true,
        }),
      );
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        throw new ConflictError(ErrorMessages.USER.EMAIL_ALREADY_REGISTERED);
      }
      throw err;
    }

    void this.mailService
      .send({
        to: normalizedEmail,
        subject: 'You have been invited to Skillbridge Admin',
        html: `<p>Hi ${first_name},</p>
<p>You have been added as an admin on Skillbridge. Use the credentials below to log in and change your password immediately.</p>
<p><strong>Email:</strong> ${normalizedEmail}<br/>
<strong>Temporary password:</strong> <code>${tempPassword}</code></p>
<p>For security, please change this password as soon as you log in.</p>`,
      })
      .catch(() => void 0);

    return {
      message: SuccessMessages.ADMIN_MANAGEMENT.INVITE_SENT(normalizedEmail),
      temp_password: tempPassword,
      account: this.toAdminAccountRow(user),
    };
  }

  async resetPassword(id: string): Promise<{ message: string }> {
    const user = await this.getManagedAdminOrThrow(id);
    this.passwordResetQueue.enqueue(user.id);
    return {
      message: SuccessMessages.ADMIN_MANAGEMENT.PASSWORD_RESET_SENT(user.email),
    };
  }

  async changeEmail(
    id: string,
    dto: ChangeAdminEmailDto,
    actorId: string,
  ): Promise<{ message: string; account: AdminAccountRow }> {
    const user = await this.getManagedAdminOrThrow(id);
    const normalizedEmail = normalizeEmail(dto.email) as string;

    if (normalizedEmail === user.email) {
      throw new BadRequestError(ErrorMessages.ADMIN_MANAGEMENT.EMAIL_UNCHANGED);
    }

    const previousEmail = user.email;

    await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const auditRepo = manager.getRepository(AdminEmailChangeAudit);

      const conflict = await userRepo.findOne({
        where: { email: normalizedEmail },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictError(ErrorMessages.USER.EMAIL_ALREADY_REGISTERED);
      }

      await userRepo.update(
        { id },
        { email: normalizedEmail, refreshTokenHash: null },
      );

      await auditRepo.save(
        auditRepo.create({
          target_user_id: id,
          previous_email: previousEmail,
          new_email: normalizedEmail,
          changed_by_user_id: actorId,
        }),
      );
    });

    const updated = await this.getManagedAdminOrThrow(id);
    return {
      message: SuccessMessages.ADMIN_MANAGEMENT.EMAIL_UPDATED(updated.fullname),
      account: this.toAdminAccountRow(updated),
    };
  }

  async changeRole(
    id: string,
    dto: ChangeAdminRoleDto,
    _actorId: string,
  ): Promise<{ message: string; account: AdminAccountRow }> {
    const user = await this.getManagedAdminOrThrow(id);
    const currentTier = user.admin_tier!;

    if (dto.role === currentTier) {
      throw new BadRequestError(ErrorMessages.ADMIN_MANAGEMENT.ROLE_UNCHANGED);
    }

    const isSuperAdminDowngrade =
      currentTier === AdminTier.SUPER_ADMIN &&
      dto.role !== AdminTier.SUPER_ADMIN;

    if (isSuperAdminDowngrade && !dto.confirm_downgrade) {
      throw new BadRequestError(
        ErrorMessages.ADMIN_MANAGEMENT
          .SUPER_ADMIN_DOWNGRADE_CONFIRMATION_REQUIRED,
      );
    }

    if (isSuperAdminDowngrade) {
      await this.ensureAnotherActiveSuperAdmin(id);
    }

    await this.userRepo.update({ id }, { admin_tier: dto.role });

    const updated = await this.getManagedAdminOrThrow(id);
    return {
      message: SuccessMessages.ADMIN_MANAGEMENT.ROLE_UPDATED(updated.fullname),
      account: this.toAdminAccountRow(updated),
    };
  }

  async deactivate(
    id: string,
    actorId: string,
  ): Promise<{ message: string; account: AdminAccountRow }> {
    if (id === actorId) {
      throw new ForbiddenError(
        ErrorMessages.ADMIN_MANAGEMENT.CANNOT_SELF_DEACTIVATE,
      );
    }

    const user = await this.getManagedAdminOrThrow(id);
    if (!user.is_active) {
      throw new BadRequestError(
        ErrorMessages.ADMIN_MANAGEMENT.ALREADY_DEACTIVATED,
      );
    }

    if (user.admin_tier === AdminTier.SUPER_ADMIN) {
      await this.ensureAnotherActiveSuperAdmin(id);
    }

    await this.userRepo.update(
      { id },
      { is_active: false, refreshTokenHash: null },
    );

    const updated = await this.getManagedAdminOrThrow(id);
    return {
      message: SuccessMessages.ADMIN_MANAGEMENT.ACCOUNT_DEACTIVATED,
      account: this.toAdminAccountRow(updated),
    };
  }

  async reactivate(
    id: string,
  ): Promise<{ message: string; account: AdminAccountRow }> {
    const user = await this.getManagedAdminOrThrow(id);
    if (user.is_active) {
      throw new BadRequestError(ErrorMessages.ADMIN_MANAGEMENT.ALREADY_ACTIVE);
    }

    await this.userRepo.update({ id }, { is_active: true });

    const updated = await this.getManagedAdminOrThrow(id);
    return {
      message: SuccessMessages.ADMIN_MANAGEMENT.ACCOUNT_REACTIVATED,
      account: this.toAdminAccountRow(updated),
    };
  }

  private async getManagedAdminOrThrow(id: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id, role: UserRole.ADMIN },
    });
    if (!user || !user.admin_tier) {
      throw new NotFoundError(
        ErrorMessages.ADMIN_MANAGEMENT.ADMIN_NOT_FOUND(id),
      );
    }
    return user;
  }

  private async ensureAnotherActiveSuperAdmin(
    excludeId: string,
  ): Promise<void> {
    const count = await this.userRepo.count({
      where: {
        role: UserRole.ADMIN,
        admin_tier: AdminTier.SUPER_ADMIN,
        is_active: true,
      },
    });

    const excluded = await this.userRepo.findOne({
      where: {
        id: excludeId,
        role: UserRole.ADMIN,
        admin_tier: AdminTier.SUPER_ADMIN,
        is_active: true,
      },
    });

    const remaining = excluded ? count - 1 : count;
    if (remaining < 1) {
      throw new ForbiddenError(
        ErrorMessages.ADMIN_MANAGEMENT.LAST_SUPER_ADMIN_PROTECTED,
      );
    }
  }

  private toAdminAccountRow(user: User): AdminAccountRow {
    return {
      id: user.id,
      name: user.fullname,
      email: user.email,
      role: user.admin_tier!,
      last_login: user.last_login_at?.toISOString() ?? null,
      status: deriveAdminStatus(user),
    };
  }
}
