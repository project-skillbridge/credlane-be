import {
  Module,
  MiddlewareConsumer,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CaseTransformMiddleware } from './common/middleware/case-transform.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { loggerConfig } from './config/logger.config';
import { LoggerModule } from 'nestjs-pino';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import './config/env';
import { jwtConfig } from './config/jwt.config';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { AdminTiersGuard } from './modules/auth/guards/admin-tiers.guard';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { VerifiedProfileModule } from './modules/verified-profile/verified-profile.module';
import { TalentModule } from './modules/talent/talent.module';
import { EmployerModule } from './modules/employer/employer.module';
import { HealthModule } from './modules/health/health.module';
import { InquiriesModule } from './modules/inquiries/inquiries.module';
import { MailModule } from './modules/mail/mail.module';
import { UsersModule } from './modules/users/users.module';
import { ProbeController } from './probe.controller';
import { WelcomeController } from './welcome.controller';
import { AiResourcesModule } from './modules/ai-resources/ai-resources.module';
import { AiReportModule } from './modules/ai-report/ai-report.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminQuestionsModule } from './modules/admin/questions/admin-questions.module';
import { AdminOverviewModule } from './modules/admin/overview/admin-overview.module';
import { AdminTalentsModule } from './modules/admin/talents/admin-talents.module';
import { AdminEmployersModule } from './modules/admin/employers/admin-employers.module';
import { AdminIntegrityModule } from './modules/admin/integrity/admin-integrity.module';
import { AdminPaymentsModule } from './modules/admin/payments/admin-payments.module';
import { AdminAdminsModule } from './modules/admin/admins/admin-admins.module';
import { AdminOffersModule } from './modules/admin/offers/admin-offers.module';
import { AdminEngagementModule } from './modules/admin/engagement/admin-engagement.module';
import { AdminSupportModule } from './modules/admin/support/admin-support.module';
import { AdminAccountModule } from './modules/admin/account/admin-account.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { EmployerBillingModule } from './modules/employer-billing/employer-billing.module';
import { EmployerDiscoveryModule } from './modules/employer-discovery/employer-discovery.module';
import { OffersModule } from './modules/offers/offers.module';
import { EmployerAssessmentsModule } from './modules/employer-assessments/employer-assessments.module';
import { EmployerRolesModule } from './modules/employer-roles/employer-roles.module';
import { QuestionBankGeneratorModule } from './tasks/question-bank-generator.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { MetricsInterceptor } from './modules/metrics/metrics.interceptor';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        configService.getOrThrow<TypeOrmModuleOptions>('database'),
    }),
    AiModule,
    HealthModule,
    InquiriesModule,
    UsersModule,
    AuthModule,
    DashboardModule,
    VerifiedProfileModule,
    TalentModule,
    EmployerModule,
    MailModule,
    AiResourcesModule,
    AiReportModule,
    NotificationsModule,
    AdminQuestionsModule,
    AdminOverviewModule,
    AdminTalentsModule,
    AdminEmployersModule,
    AdminIntegrityModule,
    AdminPaymentsModule,
    AdminAdminsModule,
    AdminEngagementModule,
    AdminOffersModule,
    AdminSupportModule,
    AdminAccountModule,
    PaymentsModule,
    EmployerBillingModule,
    EmployerDiscoveryModule,
    OffersModule,
    EmployerAssessmentsModule,
    EmployerRolesModule,
    QuestionBankGeneratorModule,
    MetricsModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AdminTiersGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  controllers: [ProbeController, WelcomeController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, CaseTransformMiddleware).forRoutes('*');
  }
}
