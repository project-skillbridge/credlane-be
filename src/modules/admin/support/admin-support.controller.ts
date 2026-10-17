import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminTiers } from '../../../common/decorators/admin-tiers.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AdminTier, UserRole } from '../../users/entities/user.entity';
import { AdminSupportService } from './admin-support.service';
import { ListSupportTicketsQueryDto } from './dto/list-support-tickets-query.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';

const SUPPORT_TICKET_ROW_EXAMPLE = {
  id: '7c0d4634-11ff-4e4a-a7e4-d391f32f5d4b',
  ticket_id: 'TCK-1001',
  submitted_by: {
    id: '2a142679-5417-48c9-a13f-c512c239612e',
    name: 'Tina Talent',
    email: 'tina@example.com',
    role: 'talent',
  },
  type: 'technical',
  subject: 'Assessment page will not load',
  status: 'open',
  date_submitted: '2026-06-30T09:15:00.000Z',
  assigned_admin: {
    id: 'e72574a3-6a7e-4202-9ab8-0246a98a3b2a',
    name: 'Ava Admin',
    email: 'ava.admin@example.com',
  },
};

const SUPPORT_TICKET_DETAIL_EXAMPLE = {
  ...SUPPORT_TICKET_ROW_EXAMPLE,
  thread: [
    {
      id: '87efa344-aac3-414e-a936-d5711f9c9df8',
      author_type: 'submitter',
      author: {
        id: '2a142679-5417-48c9-a13f-c512c239612e',
        name: 'Tina Talent',
        email: 'tina@example.com',
      },
      body: 'I cannot open my assessment page after login.',
      created_at: '2026-06-30T09:15:00.000Z',
    },
    {
      id: '984e80d8-b8d2-44ef-b035-62e7b0599a7d',
      author_type: 'admin',
      author: {
        id: 'e72574a3-6a7e-4202-9ab8-0246a98a3b2a',
        name: 'Ava Admin',
        email: 'ava.admin@example.com',
      },
      body: 'I am checking the failed request logs.',
      created_at: '2026-06-30T09:22:00.000Z',
    },
  ],
  controls: {
    available_statuses: ['open', 'in_progress', 'resolved'],
    assignment_enabled: true,
  },
};

const SUPPORT_LIST_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    status_code: { type: 'number', example: 200 },
    message: { type: 'string', example: 'success' },
    data: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', example: SUPPORT_TICKET_ROW_EXAMPLE },
        },
        total: { type: 'number', example: 42 },
        page: { type: 'number', example: 1 },
        limit: { type: 'number', example: 20 },
        totalPages: { type: 'number', example: 3 },
      },
    },
  },
};

const SUPPORT_DETAIL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    status_code: { type: 'number', example: 200 },
    message: { type: 'string', example: 'success' },
    data: {
      type: 'object',
      example: SUPPORT_TICKET_DETAIL_EXAMPLE,
    },
  },
};

@ApiTags('admin-support')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@AdminTiers(AdminTier.SUPER_ADMIN, AdminTier.ADMIN)
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly adminSupportService: AdminSupportService) {}

  @Get('tickets')
  @ApiOperation({ summary: 'Support Tickets table' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['open', 'in_progress', 'resolved'],
    example: 'open',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: [
      'account',
      'assessment',
      'employer',
      'payment',
      'technical',
      'other',
    ],
    example: 'technical',
  })
  @ApiQuery({
    name: 'date_from',
    required: false,
    example: '2026-06-01',
    description: 'ISO date lower bound for Date Submitted',
  })
  @ApiQuery({
    name: 'date_to',
    required: false,
    example: '2026-06-30',
    description: 'ISO date upper bound for Date Submitted',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    example: 'Tina',
    description: 'Search by submitter name',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiOkResponse({
    description:
      'Paginated support tickets. Supports status/type/date filters and submitter-name search.',
    schema: SUPPORT_LIST_RESPONSE_SCHEMA,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({
    description: 'Caller is not a Super Admin or Admin dashboard user',
  })
  async findAll(@Query() query: ListSupportTicketsQueryDto) {
    return this.adminSupportService.findAll(query);
  }

  @Get('tickets/:id')
  @ApiOperation({
    summary: 'Support ticket detail panel with full thread and controls',
  })
  @ApiOkResponse({
    description:
      'Support ticket detail, including the full thread, status controls, and assignment state.',
    schema: SUPPORT_DETAIL_RESPONSE_SCHEMA,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({
    description: 'Caller is not a Super Admin or Admin dashboard user',
  })
  @ApiNotFoundResponse({ description: 'Support ticket not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminSupportService.findOne(id);
  }

  @Patch('tickets/:id')
  @ApiOperation({
    summary:
      'Update ticket status or assignment. Full scoping remains deferred until OQ-02 lands.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'in_progress', 'resolved'],
          example: 'in_progress',
        },
        assigned_admin_id: {
          type: 'string',
          format: 'uuid',
          nullable: true,
          example: 'e72574a3-6a7e-4202-9ab8-0246a98a3b2a',
        },
      },
    },
    examples: {
      updateStatus: {
        summary: 'Move ticket to In Progress',
        value: { status: 'in_progress' },
      },
      assignAdmin: {
        summary: 'Assign ticket to an admin',
        value: {
          assigned_admin_id: 'e72574a3-6a7e-4202-9ab8-0246a98a3b2a',
        },
      },
      clearAssignment: {
        summary: 'Clear assigned admin',
        value: { assigned_admin_id: null },
      },
    },
  })
  @ApiOkResponse({
    description: 'Updated support ticket detail panel payload.',
    schema: SUPPORT_DETAIL_RESPONSE_SCHEMA,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid status, invalid UUID, or assigned user is not an active support admin',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({
    description: 'Caller is not a Super Admin or Admin dashboard user',
  })
  @ApiNotFoundResponse({ description: 'Support ticket not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupportTicketDto,
  ) {
    return this.adminSupportService.update(id, dto);
  }
}
