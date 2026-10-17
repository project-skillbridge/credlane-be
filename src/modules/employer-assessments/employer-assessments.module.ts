import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentQuestion } from '../assessments/entities/assessment-question.entity';
import { EmployerSavedCandidate } from '../employer-discovery/entities/employer-saved-candidate.entity';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';
import { EmployerRole } from '../employer-roles/entities/employer-role.entity';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Offer } from '../offers/entities/offer.entity';
import { User } from '../users/entities/user.entity';
import {
  EmployerAssessment,
  EmployerAssessmentInvite,
  EmployerAssessmentQuestion,
  EmployerAssessmentSubmission,
  CredlaneCatalogueAssessment,
  EmployerAssessmentExternalApplicant,
  EmployerAssessmentExternalInvite,
  EmployerAssessmentExternalSubmission,
} from './entities';
import { EmployerBillingModule } from '../employer-billing/employer-billing.module';
import { EmployerAssessmentDraftService } from './employer-assessment-draft.service';
import { EmployerAssessmentsController } from './employer-assessments.controller';
import { EmployerAssessmentsService } from './employer-assessments.service';

@Module({
  imports: [
    EmployerBillingModule,
    TypeOrmModule.forFeature([
      EmployerAssessment,
      EmployerAssessmentQuestion,
      EmployerAssessmentInvite,
      EmployerAssessmentSubmission,
      EmployerAssessmentExternalApplicant,
      EmployerAssessmentExternalInvite,
      EmployerAssessmentExternalSubmission,
      AssessmentQuestion,
      EmployerSavedCandidate,
      EmployerPoolProfile,
      EmployerProfile,
      User,
      EmployerRole,
      Offer,
      CredlaneCatalogueAssessment,
    ]),
    NotificationsModule,
    MailModule,
  ],
  controllers: [EmployerAssessmentsController],
  providers: [EmployerAssessmentsService, EmployerAssessmentDraftService],
  exports: [EmployerAssessmentsService],
})
export class EmployerAssessmentsModule {}
