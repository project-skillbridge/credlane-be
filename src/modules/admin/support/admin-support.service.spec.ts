import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminTier, UserRole } from '../../users/entities/user.entity';
import { AdminSupportService } from './admin-support.service';
import {
  SupportTicket,
  SupportTicketStatus,
  SupportTicketType,
} from './entities/support-ticket.entity';
import { SupportTicketMessageAuthorType } from './entities/support-ticket-message.entity';

const buildQueryBuilder = (tickets: SupportTicket[], count: number) => {
  const qb: Record<string, jest.Mock> = {
    leftJoinAndSelect: jest.fn(),
    orderBy: jest.fn(),
    offset: jest.fn(),
    limit: jest.fn(),
    andWhere: jest.fn(),
    getManyAndCount: jest.fn().mockResolvedValue([tickets, count]),
  };
  for (const key of Object.keys(qb)) {
    if (key !== 'getManyAndCount') {
      qb[key].mockReturnValue(qb);
    }
  }
  return qb;
};

describe('AdminSupportService', () => {
  let supportTicketRepo: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let userRepo: { findOne: jest.Mock };
  let service: AdminSupportService;

  const assignedAdmin = {
    id: 'admin-1',
    email: 'admin@example.com',
    fullname: 'Ava Admin',
  };

  const baseTicket = {
    id: 'ticket-uuid',
    ticket_id: 'TCK-1001',
    submitted_by_user_id: 'talent-1',
    submitter_name: 'Tina Talent',
    submitter_email: 'tina@example.com',
    submitter_role: UserRole.TALENT,
    type: SupportTicketType.ACCOUNT,
    subject: 'Cannot access assessment',
    status: SupportTicketStatus.OPEN,
    assigned_admin_id: 'admin-1',
    assigned_admin: assignedAdmin,
    created_at: new Date('2026-01-02T00:00:00Z'),
    updated_at: new Date('2026-01-03T00:00:00Z'),
  } as SupportTicket;

  beforeEach(() => {
    supportTicketRepo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn((ticket: SupportTicket) => Promise.resolve(ticket)),
    };
    userRepo = { findOne: jest.fn() };
    service = new AdminSupportService(
      supportTicketRepo as never,
      userRepo as never,
    );
  });

  describe('findAll', () => {
    it('returns the support ticket table contract with pagination metadata', async () => {
      supportTicketRepo.createQueryBuilder.mockReturnValue(
        buildQueryBuilder([baseTicket], 1),
      );

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result).toEqual({
        items: [
          {
            id: 'ticket-uuid',
            ticket_id: 'TCK-1001',
            submitted_by: {
              id: 'talent-1',
              name: 'Tina Talent',
              email: 'tina@example.com',
              role: UserRole.TALENT,
            },
            type: SupportTicketType.ACCOUNT,
            subject: 'Cannot access assessment',
            status: SupportTicketStatus.OPEN,
            date_submitted: baseTicket.created_at,
            assigned_admin: {
              id: 'admin-1',
              name: 'Ava Admin',
              email: 'admin@example.com',
            },
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('applies status, type, date range, and submitter search filters', async () => {
      const qb = buildQueryBuilder([], 0);
      supportTicketRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({
        status: SupportTicketStatus.IN_PROGRESS,
        type: SupportTicketType.TECHNICAL,
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        search: 'tina',
      });

      expect(qb.andWhere).toHaveBeenCalledWith('ticket.status = :status', {
        status: SupportTicketStatus.IN_PROGRESS,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('ticket.type = :type', {
        type: SupportTicketType.TECHNICAL,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'ticket.created_at >= :dateFrom',
        { dateFrom: '2026-01-01' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('ticket.created_at <= :dateTo', {
        dateTo: '2026-01-31',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'ticket.submitter_name ILIKE :search',
        { search: '%tina%' },
      );
    });
  });

  describe('findOne', () => {
    it('returns detail data with sorted thread and status controls', async () => {
      supportTicketRepo.findOne.mockResolvedValue({
        ...baseTicket,
        messages: [
          {
            id: 'message-2',
            author_type: SupportTicketMessageAuthorType.ADMIN,
            author_user_id: 'admin-1',
            author_name: 'Ava Admin',
            author: assignedAdmin,
            body: 'Looking into this.',
            created_at: new Date('2026-01-02T10:00:00Z'),
          },
          {
            id: 'message-1',
            author_type: SupportTicketMessageAuthorType.SUBMITTER,
            author_user_id: 'talent-1',
            author_name: 'Tina Talent',
            author: { email: 'tina@example.com' },
            body: 'I need help.',
            created_at: new Date('2026-01-02T09:00:00Z'),
          },
        ],
      });

      const result = await service.findOne('ticket-uuid');

      expect(result.thread.map((message) => message.id)).toEqual([
        'message-1',
        'message-2',
      ]);
      expect(result.controls.available_statuses).toEqual([
        SupportTicketStatus.OPEN,
        SupportTicketStatus.IN_PROGRESS,
        SupportTicketStatus.RESOLVED,
      ]);
      expect(result.controls.assignment_enabled).toBe(true);
    });

    it('throws NotFoundException when the ticket does not exist', async () => {
      supportTicketRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates status and assignment for a valid support admin', async () => {
      supportTicketRepo.findOne
        .mockResolvedValueOnce(baseTicket)
        .mockResolvedValueOnce({ ...baseTicket, messages: [] });
      userRepo.findOne.mockResolvedValue({
        id: 'admin-2',
        role: UserRole.ADMIN,
        admin_tier: AdminTier.ADMIN,
        is_active: true,
      });

      await service.update('ticket-uuid', {
        status: SupportTicketStatus.RESOLVED,
        assignedAdminId: 'admin-2',
      });

      expect(supportTicketRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SupportTicketStatus.RESOLVED,
          assigned_admin_id: 'admin-2',
        }),
      );
    });

    it('rejects assignment to reviewers or non-admin users', async () => {
      supportTicketRepo.findOne.mockResolvedValue(baseTicket);
      userRepo.findOne.mockResolvedValue({
        id: 'reviewer-1',
        role: UserRole.ADMIN,
        admin_tier: AdminTier.REVIEWER,
        is_active: true,
      });

      await expect(
        service.update('ticket-uuid', { assignedAdminId: 'reviewer-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
