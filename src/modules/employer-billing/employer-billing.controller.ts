import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { EmployerBillingService } from './employer-billing.service';

@ApiTags('Employer Billing')
@Controller('employer/billing')
@Roles(UserRole.EMPLOYER)
export class EmployerBillingController {
  constructor(private readonly billingService: EmployerBillingService) {}

  @Get('summary')
  getSummary(@CurrentUser('sub') employerUserId: string) {
    return this.billingService.getSummary(employerUserId);
  }
}
