import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminTier, User, UserRole } from '../../users/entities/user.entity';
import { ListSupportTicketsQueryDto } from './dto/list-support-tickets-query.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';
import {
  SupportTicket,
  SupportTicketStatus,
  SupportTicketType,
} from './entities/support-ticket.entity';
import { SupportTicketMessageAuthorType } from './entities/support-ticket-message.entity';

export interface SupportTicketListRow {
  id: string;
  ticket_id: string;
  submitted_by: {
    id: string | null;
    name: string;
    email: string | null;
    role: string;
  };
  type: SupportTicketType;
  subject: string;
  status: SupportTicketStatus;
  date_submitted: Date;
  assigned_admin: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export interface SupportTicketDetail extends SupportTicketListRow {
  thread: Array<{
    id: string;
    author_type: SupportTicketMessageAuthorType;
    author: {
      id: string | null;
      name: string;
      email: string | null;
    };
    body: string;
    created_at: Date;
  }>;
  controls: {
    available_statuses: SupportTicketStatus[];
    assignment_enabled: true;
  };
}

@Injectable()
export class AdminSupportService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly supportTicketRepo: Repository<SupportTicket>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findAll(query: ListSupportTicketsQueryDto): Promise<{
    items: SupportTicketListRow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.supportTicketRepo
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.submitted_by', 'submitted_by')
      .leftJoinAndSelect('ticket.assigned_admin', 'assigned_admin')
      .orderBy('ticket.created_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit);

    if (query.status) {
      qb.andWhere('ticket.status = :status', { status: query.status });
    }
    if (query.type) {
      qb.andWhere('ticket.type = :type', { type: query.type });
    }
    if (query.dateFrom) {
      qb.andWhere('ticket.created_at >= :dateFrom', {
        dateFrom: query.dateFrom,
      });
    }
    if (query.dateTo) {
      qb.andWhere('ticket.created_at <= :dateTo', {
        dateTo: query.dateTo,
      });
    }
    if (query.search) {
      qb.andWhere('ticket.submitter_name ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    const [tickets, total] = await qb.getManyAndCount();

    return {
      items: tickets.map((ticket) => this.toListRow(ticket)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<SupportTicketDetail> {
    const ticket = await this.supportTicketRepo.findOne({
      where: { id },
      relations: [
        'submitted_by',
        'assigned_admin',
        'messages',
        'messages.author',
      ],
      order: { messages: { created_at: 'ASC' } },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    return this.toDetail(ticket);
  }

  async update(
    id: string,
    dto: UpdateSupportTicketDto,
  ): Promise<SupportTicketDetail> {
    const ticket = await this.supportTicketRepo.findOne({
      where: { id },
      relations: ['submitted_by', 'assigned_admin'],
    });
    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    if (dto.status !== undefined) {
      ticket.status = dto.status;
    }

    if ('assignedAdminId' in dto) {
      ticket.assigned_admin_id = await this.resolveAssignedAdminId(
        dto.assignedAdminId,
      );
    }

    await this.supportTicketRepo.save(ticket);
    return this.findOne(id);
  }

  private async resolveAssignedAdminId(
    assignedAdminId: string | null | undefined,
  ): Promise<string | null> {
    if (assignedAdminId == null) {
      return null;
    }

    const admin = await this.userRepo.findOne({
      where: { id: assignedAdminId },
    });
    if (
      !admin ||
      admin.role !== UserRole.ADMIN ||
      admin.is_active !== true ||
      admin.admin_tier === null ||
      ![AdminTier.SUPER_ADMIN, AdminTier.ADMIN].includes(admin.admin_tier)
    ) {
      throw new BadRequestException(
        'Assigned admin must be an active admin user',
      );
    }

    return admin.id;
  }

  private toListRow(ticket: SupportTicket): SupportTicketListRow {
    return {
      id: ticket.id,
      ticket_id: ticket.ticket_id,
      submitted_by: {
        id: ticket.submitted_by_user_id,
        name: ticket.submitter_name,
        email: ticket.submitter_email,
        role: ticket.submitter_role,
      },
      type: ticket.type,
      subject: ticket.subject,
      status: ticket.status,
      date_submitted: ticket.created_at,
      assigned_admin: ticket.assigned_admin
        ? {
            id: ticket.assigned_admin.id,
            name: ticket.assigned_admin.fullname,
            email: ticket.assigned_admin.email,
          }
        : null,
    };
  }

  private toDetail(ticket: SupportTicket): SupportTicketDetail {
    return {
      ...this.toListRow(ticket),
      thread: [...(ticket.messages ?? [])]
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .map((message) => ({
          id: message.id,
          author_type: message.author_type,
          author: {
            id: message.author_user_id,
            name: message.author_name,
            email: message.author?.email ?? null,
          },
          body: message.body,
          created_at: message.created_at,
        })),
      controls: {
        available_statuses: [
          SupportTicketStatus.OPEN,
          SupportTicketStatus.IN_PROGRESS,
          SupportTicketStatus.RESOLVED,
        ],
        assignment_enabled: true,
      },
    };
  }
}
