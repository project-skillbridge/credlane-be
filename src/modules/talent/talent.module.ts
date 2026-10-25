import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { UploadModule } from '../upload/upload.module';
import { AiResourcesModule } from '../ai-resources/ai-resources.module';
import { TalentProfile } from './entities/talent-profile.entity';
import { EmployerPoolProfile } from './entities/employer-pool-profile.entity';
import { TalentRoleInterest } from './entities/talent-role-interest.entity';
import { EmployerRole } from '../employer-roles/entities/employer-role.entity';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';
import {
  AssessmentAttempt,
  AssessmentQuestion,
  AssessmentResponse,
  AssessmentResult,
  AssessmentScore,
  TalentQuestionHistory,
  AssessmentWaitlist,
  TalentCertificate,
} from '../assessments/entities';
import { PersonalAssessmentQuestionEntity } from './entities/personal-assessment-question.entity';
import { PersonalAssessmentQuestionService } from './assessment/personal-assessment-question.service';
import { PersonalAssessmentController } from './assessment/personal-assessment.controller';
import { PersonalAssessmentService } from './assessment/personal-assessment.service';
import { AdvancedAssessmentAiService } from './assessment/advanced-assessment-ai.service';
import { AdvancedAssessmentController } from './assessment/advanced-assessment.controller';
import { AdvancedAssessmentService } from './assessment/advanced-assessment.service';
import { AdvancedAssessmentQueueService } from './assessment/advanced-assessment-queue.service';
import { AdvancedAssessmentSubmitProcessor } from './assessment/advanced-assessment-submit.processor';
import { EmployerPoolProfileService } from './assessment/employer-pool-profile.service';
import { PracticeAssessmentController } from './assessment/practice-assessment.controller';
import { PracticeAssessmentService } from './assessment/practice-assessment.service';
import { SkillAssessmentController } from './assessment/skill-assessment.controller';
import { SkillAssessmentService } from './assessment/skill-assessment.service';
import { SkillGuidanceReportProcessor } from './assessment/skill-guidance-report.processor';
import { SkillGuidanceReportQueueService } from './assessment/skill-guidance-report-queue.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { UserNotificationPreference } from '../notifications/user-notification-preference.entity';
import { TalentController } from './talent.controller';
import { TalentExploreJobsController } from './talent-explore-jobs.controller';
import { TalentExploreJobsService } from './talent-explore-jobs.service';
import { CertificatesController } from './certificates/certificates.controller';
import { CertificatesService } from './certificates/certificates.service';
import { AssessmentWaitlistNotifier } from './assessment/assessment-waitlist.notifier';
import { AssessmentWaitlistService } from './assessment/assessment-waitlist.service';
import { TalentSettingsController } from './talent-settings.controller';
import { TalentService } from './talent.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TalentProfile,
      EmployerPoolProfile,
      TalentRoleInterest,
      EmployerRole,
      EmployerProfile,
      PersonalAssessmentQuestionEntity,
      AssessmentQuestion,
      AssessmentAttempt,
      AssessmentResponse,
      AssessmentResult,
      AssessmentScore,
      TalentQuestionHistory,
      AssessmentWaitlist,
      TalentCertificate,
      UserNotificationPreference,
    ]),
    UsersModule,
    AuthModule,
    UploadModule,
    NotificationsModule,
    MailModule,
    AiResourcesModule,
  ],
  controllers: [
    TalentController,
    TalentExploreJobsController,
    TalentSettingsController,
    PersonalAssessmentController,
    SkillAssessmentController,
    PracticeAssessmentController,
    AdvancedAssessmentController,
    CertificatesController,
  ],
  providers: [
    TalentService,
    TalentExploreJobsService,
    PersonalAssessmentQuestionService,
    PersonalAssessmentService,
    SkillAssessmentService,
    PracticeAssessmentService,
    AssessmentWaitlistService,
    AssessmentWaitlistNotifier,
    CertificatesService,
    SkillGuidanceReportProcessor,
    SkillGuidanceReportQueueService,
    AdvancedAssessmentAiService,
    AdvancedAssessmentService,
    AdvancedAssessmentSubmitProcessor,
    AdvancedAssessmentQueueService,
    EmployerPoolProfileService,
  ],
  exports: [PersonalAssessmentQuestionService],
})
export class TalentModule {}
