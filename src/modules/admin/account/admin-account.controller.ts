import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SuccessMessages } from '../../../shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { clearAuthCookies } from '../../auth/auth.cookies';
import type { Response } from 'express';
import { UserRole } from '../../users/entities/user.entity';
import { AdminAccountService } from './admin-account.service';

@ApiTags('admin-account')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminAccountController {
  constructor(private readonly adminAccountService: AdminAccountService) {}

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke admin session and clear auth cookies' })
  @ApiOkResponse({ description: 'Logged out successfully' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({
    description: 'Caller is not an admin dashboard user',
  })
  async logout(
    @CurrentUser('sub') userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.adminAccountService.logout(userId);
    clearAuthCookies(response);
    return { status: 'success', message: SuccessMessages.AUTH.LOGGED_OUT };
  }

  @Get('me')
  @ApiOperation({
    summary:
      'Read-only account settings payload for Super Admin, Admin, and Reviewer',
  })
  @ApiOkResponse({
    description:
      'Returns read-only account settings fields. No password, email-change, or mutation controls are exposed in MVP.',
    schema: {
      type: 'object',
      properties: {
        status_code: { type: 'number', example: 200 },
        message: { type: 'string', example: 'success' },
        data: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              example: 'e72574a3-6a7e-4202-9ab8-0246a98a3b2a',
            },
            name: { type: 'string', example: 'Ava Admin' },
            email: { type: 'string', example: 'ava.admin@example.com' },
            role: { type: 'string', example: 'admin' },
            admin_tier: {
              type: 'string',
              enum: ['super_admin', 'admin', 'reviewer'],
              example: 'admin',
            },
            role_badge: { type: 'string', example: 'Admin' },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({
    description: 'Caller is not an admin dashboard user',
  })
  async me(@CurrentUser('sub') userId: string) {
    return this.adminAccountService.getMe(userId);
  }
}
