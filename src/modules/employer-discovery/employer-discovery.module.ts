import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';
import { User } from '../users/entities/user.entity';
import { Offer } from '../offers/entities/offer.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmployerBillingModule } from '../employer-billing/employer-billing.module';
import { EmployerModule } from '../employer/employer.module';
import { VerifiedProfileModule } from '../verified-profile/verified-profile.module';
import { EmployerContactRequest } from './entities/employer-contact-request.entity';
import { EmployerSavedCandidate } from './entities/employer-saved-candidate.entity';
import { EmployerDiscoveryController } from './employer-discovery.controller';
import { EmployerDiscoveryService } from './employer-discovery.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmployerPoolProfile,
      EmployerProfile,
      EmployerSavedCandidate,
      EmployerContactRequest,
      User,
      Offer,
    ]),
    NotificationsModule,
    EmployerModule,
    VerifiedProfileModule,
    EmployerBillingModule,
  ],
  controllers: [EmployerDiscoveryController],
  providers: [EmployerDiscoveryService],
  exports: [EmployerDiscoveryService],
})
export class EmployerDiscoveryModule {}
