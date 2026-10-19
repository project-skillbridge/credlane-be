import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { User } from '../users/entities/user.entity';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmployerModule } from '../employer/employer.module';
import { EmployerRolesModule } from '../employer-roles/employer-roles.module';
import { EmployerBillingModule } from '../employer-billing/employer-billing.module';
import { Offer } from './entities/offer.entity';
import { HireFeedback } from './entities/hire-feedback.entity';
import { OfferDistributionLog } from './entities/offer-distribution-log.entity';
import { OfferExpiryService } from './offer-expiry.service';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Offer,
      HireFeedback,
      OfferDistributionLog,
      EmployerPoolProfile,
      EmployerProfile,
      User,
    ]),
    NotificationsModule,
    EmployerModule,
    EmployerRolesModule,
    EmployerBillingModule,
  ],
  controllers: [OffersController],
  providers: [OffersService, OfferExpiryService],
  exports: [OffersService],
})
export class OffersModule {}
