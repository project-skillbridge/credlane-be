import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { AssessmentTier } from '../assessments/entities/assessment-result.entity';
import { MailService } from '../mail/mail.service';
import { TalentProfile } from '../talent/entities/talent-profile.entity';
import { UsersService } from '../users/users.service';
import { NotificationType } from './notification-type.enum';
import {
  isNotificationDuplicateError,
  NotificationsService,
} from './notifications.service';

export type AdvancedScoreReadyPayload = {
  score: number;
  maxScore: number;
  percentage: number;
  tier: AssessmentTier;
};

export type SkillAssessmentResultPayload = {
  /** Validated level on a pass; the level the talent tried on a fail. */
  level: string;
  track: string;
  percentage: number;
  certificateCode?: string;
  retakeAvailable: boolean;
};

export type AdvancedRetakeAvailablePayload = {
  eligibilityDate: string;
};

export type OfferReceivedPayload = {
  offerId: string;
  employerUserId: string;
  employerName: string;
  roleTitle: string;
};

export type OfferRespondedPayload = {
  offerId: string;
  candidateUserId: string;
  candidateName: string;
  roleTitle: string;
  action: 'accept' | 'decline';
};

export type ContactRequestReceivedPayload = {
  contactRequestId: string;
  employerUserId: string;
  employerName: string;
};

export type AssessmentReceivedPayload = {
  assessmentId: string;
  title: string;
  roleTrack: string;
  shareUrl: string;
};

export type AssessmentUnlockedPayload = {
  offerId: string;
  employerUserId: string;
  employerName: string;
  roleTitle: string;
  assessmentDeadline: string;
};

export type AssessmentWindowExtendedPayload = {
  offerId: string;
  employerUserId: string;
  employerName: string;
  roleTitle: string;
  newDeadline: string;
};

export type AssessmentWindowExpiringPayload = {
  offerId: string;
  candidateUserId: string;
  candidateName: string;
  roleTitle: string;
  assessmentDeadline: string;
};

export type AssessmentResultPayload = {
  offerId: string;
  candidateUserId: string;
  candidateName: string;
  employerUserId: string;
  roleTitle: string;
  score: number;
};

export type OfferExpiredPayload = {
  offerId: string;
  candidateUserId: string;
  candidateName: string;
  roleTitle: string;
};

export type OfferWithdrawnPayload = {
  offerId: string;
  employerUserId: string;
  employerName: string;
  roleTitle: string;
};

export type CallRequestedPayload = {
  offerId: string;
  candidateUserId: string;
  candidateName: string;
  roleTitle: string;
};

type RetakeEligibilityProfile = Pick<
  TalentProfile,
  'advanced_retake_required' | 'assessment_locked_until'
>;

const RETAKE_NOTIFY_POLL_MS = 60 * 60 * 1000;

@Injectable()
export class NotificationDispatchService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationDispatchService.name);
  private retakePollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
    @InjectRepository(TalentProfile)
    private readonly talentProfileRepo: Repository<TalentProfile>,
  ) {}

  onModuleInit(): void {
    void this.processDueRetakeNotifications();
    this.retakePollTimer = setInterval(
      () => void this.processDueRetakeNotifications(),
      RETAKE_NOTIFY_POLL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.retakePollTimer) {
      clearInterval(this.retakePollTimer);
      this.retakePollTimer = null;
    }
  }

  async notifyOfferReceived(
    userId: string,
    payload: OfferReceivedPayload,
  ): Promise<void> {
    return this.dispatch(NotificationType.OFFER_RECEIVED, userId, payload);
  }

  async notifyOfferAccepted(
    userId: string,
    payload: OfferRespondedPayload,
  ): Promise<void> {
    return this.dispatch(NotificationType.OFFER_ACCEPTED, userId, payload);
  }

  async notifyOfferDeclined(
    userId: string,
    payload: OfferRespondedPayload,
  ): Promise<void> {
    return this.dispatch(NotificationType.OFFER_DECLINED, userId, payload);
  }

  async notifySkillAssessmentPassed(
    userId: string,
    payload: SkillAssessmentResultPayload,
  ): Promise<void> {
    return this.dispatch(
      NotificationType.SKILL_ASSESSMENT_PASSED,
      userId,
      payload,
    );
  }

  async notifySkillAssessmentFailed(
    userId: string,
    payload: SkillAssessmentResultPayload,
  ): Promise<void> {
    return this.dispatch(
      NotificationType.SKILL_ASSESSMENT_FAILED,
      userId,
      payload,
    );
  }

  async notifySkillAssessmentReady(userId: string): Promise<void> {
    return this.dispatch(NotificationType.SKILL_ASSESSMENT_READY, userId, {});
  }

  async notifyAssessmentUnlocked(
    userId: string,
    payload: AssessmentUnlockedPayload,
  ): Promise<void> {
    return this.dispatch(NotificationType.ASSESSMENT_UNLOCKED, userId, payload);
  }

  async notifyAssessmentWindowExtended(
    userId: string,
    payload: AssessmentWindowExtendedPayload,
  ): Promise<void> {
    return this.dispatch(
      NotificationType.ASSESSMENT_WINDOW_EXTENDED,
      userId,
      payload,
    );
  }

  async notifyAssessmentWindowExpiring(
    userId: string,
    payload: AssessmentWindowExpiringPayload,
  ): Promise<void> {
    return this.dispatch(
      NotificationType.ASSESSMENT_WINDOW_EXPIRING,
      userId,
      payload,
    );
  }

  async notifyAssessmentPassed(
    userId: string,
    payload: AssessmentResultPayload,
  ): Promise<void> {
    return this.dispatch(NotificationType.ASSESSMENT_PASSED, userId, payload);
  }

  async notifyAssessmentFailed(
    userId: string,
    payload: AssessmentResultPayload,
  ): Promise<void> {
    return this.dispatch(NotificationType.ASSESSMENT_FAILED, userId, payload);
  }

  async notifyOfferExpired(
    userId: string,
    payload: OfferExpiredPayload,
  ): Promise<void> {
    return this.dispatch(NotificationType.OFFER_EXPIRED, userId, payload);
  }

  async notifyOfferWithdrawn(
    userId: string,
    payload: OfferWithdrawnPayload,
  ): Promise<void> {
    return this.dispatch(NotificationType.OFFER_WITHDRAWN, userId, payload);
  }

  async dispatch(
    type: NotificationType.ADVANCED_ASSESSMENT_SCORE_READY,
    userId: string,
    payload: AdvancedScoreReadyPayload,
  ): Promise<void>;
  async dispatch(
    type: NotificationType.ADVANCED_RETAKE_AVAILABLE,
    userId: string,
    payload: AdvancedRetakeAvailablePayload,
  ): Promise<void>;
  async dispatch(
    type: NotificationType.OFFER_RECEIVED,
    userId: string,
    payload: OfferReceivedPayload,
  ): Promise<void>;
  async dispatch(
    type: NotificationType.OFFER_ACCEPTED | NotificationType.OFFER_DECLINED,
    userId: string,
    payload: OfferRespondedPayload,
  ): Promise<void>;
  async dispatch(
    type: NotificationType.OFFER_WITHDRAWN,
    userId: string,
    payload: OfferWithdrawnPayload,
  ): Promise<void>;
  async dispatch(
    type: NotificationType.OFFER_EXPIRED,
    userId: string,
    payload: OfferExpiredPayload,
  ): Promise<void>;
  async dispatch(
    type: NotificationType.SKILL_ASSESSMENT_READY,
    userId: string,
    payload: Record<string, never>,
  ): Promise<void>;
  async dispatch(
    type:
      | NotificationType.SKILL_ASSESSMENT_PASSED
      | NotificationType.SKILL_ASSESSMENT_FAILED,
    userId: string,
    payload: SkillAssessmentResultPayload,
  ): Promise<void>;
  async dispatch(
    type: NotificationType.ASSESSMENT_UNLOCKED,
    userId: string,
    payload: AssessmentUnlockedPayload,
  ): Promise<void>;
  async dispatch(
    type: NotificationType.ASSESSMENT_WINDOW_EXTENDED,
    userId: string,
    payload: AssessmentWindowExtendedPayload,
  ): Promise<void>;
  async dispatch(
    type: NotificationType.ASSESSMENT_WINDOW_EXPIRING,
    userId: string,
    payload: AssessmentWindowExpiringPayload,
  ): Promise<void>;
  async dispatch(
    type:
      | NotificationType.ASSESSMENT_PASSED
      | NotificationType.ASSESSMENT_FAILED,
    userId: string,
    payload: AssessmentResultPayload,
  ): Promise<void>;
  async dispatch(
    type: NotificationType.CONTACT_REQUEST_RECEIVED,
    userId: string,
    payload: ContactRequestReceivedPayload,
  ): Promise<void>;
  async dispatch(
    type: NotificationType.ASSESSMENT_RECEIVED,
    userId: string,
    payload: AssessmentReceivedPayload,
  ): Promise<void>;
  async dispatch(
    type:
      | NotificationType.CALL_REQUESTED
      | NotificationType.ASSESSMENT_COMPLETED,
    userId: string,
    payload: CallRequestedPayload | Record<string, unknown>,
  ): Promise<void>;
  async dispatch(
    type: NotificationType,
    userId: string,
    payload:
      | AdvancedScoreReadyPayload
      | AdvancedRetakeAvailablePayload
      | OfferReceivedPayload
      | OfferRespondedPayload
      | OfferWithdrawnPayload
      | OfferExpiredPayload
      | AssessmentUnlockedPayload
      | AssessmentWindowExtendedPayload
      | AssessmentWindowExpiringPayload
      | AssessmentResultPayload
      | ContactRequestReceivedPayload
      | AssessmentReceivedPayload
      | CallRequestedPayload
      | Record<string, unknown>,
  ): Promise<void> {
    try {
      switch (type) {
        case NotificationType.ADVANCED_ASSESSMENT_SCORE_READY:
          await this.dispatchAdvancedScoreReady(
            userId,
            payload as AdvancedScoreReadyPayload,
          );
          break;
        case NotificationType.ADVANCED_RETAKE_AVAILABLE:
          await this.dispatchAdvancedRetakeAvailable(
            userId,
            payload as AdvancedRetakeAvailablePayload,
          );
          break;
        case NotificationType.OFFER_RECEIVED:
          await this.dispatchOfferReceived(
            userId,
            payload as OfferReceivedPayload,
          );
          break;
        case NotificationType.OFFER_ACCEPTED:
        case NotificationType.OFFER_DECLINED:
          await this.dispatchOfferResponded(
            type,
            userId,
            payload as OfferRespondedPayload,
          );
          break;
        case NotificationType.OFFER_WITHDRAWN:
          await this.dispatchOfferWithdrawn(
            userId,
            payload as OfferWithdrawnPayload,
          );
          break;
        case NotificationType.OFFER_EXPIRED:
          await this.dispatchOfferExpired(
            userId,
            payload as OfferExpiredPayload,
          );
          break;
        case NotificationType.SKILL_ASSESSMENT_READY:
          await this.dispatchSkillAssessmentReady(userId);
          break;
        case NotificationType.SKILL_ASSESSMENT_PASSED:
        case NotificationType.SKILL_ASSESSMENT_FAILED:
          await this.dispatchSkillAssessmentResult(
            type,
            userId,
            payload as SkillAssessmentResultPayload,
          );
          break;
        case NotificationType.ASSESSMENT_UNLOCKED:
          await this.dispatchAssessmentUnlocked(
            userId,
            payload as AssessmentUnlockedPayload,
          );
          break;
        case NotificationType.ASSESSMENT_WINDOW_EXTENDED:
          await this.dispatchAssessmentWindowExtended(
            userId,
            payload as AssessmentWindowExtendedPayload,
          );
          break;
        case NotificationType.ASSESSMENT_WINDOW_EXPIRING:
          await this.dispatchAssessmentWindowExpiring(
            userId,
            payload as AssessmentWindowExpiringPayload,
          );
          break;
        case NotificationType.ASSESSMENT_PASSED:
        case NotificationType.ASSESSMENT_FAILED:
          await this.dispatchAssessmentResult(
            type,
            userId,
            payload as AssessmentResultPayload,
          );
          break;
        case NotificationType.CONTACT_REQUEST_RECEIVED:
          await this.dispatchContactRequestReceived(
            userId,
            payload as ContactRequestReceivedPayload,
          );
          break;
        case NotificationType.ASSESSMENT_RECEIVED:
          await this.dispatchAssessmentReceived(
            userId,
            payload as AssessmentReceivedPayload,
          );
          break;
        case NotificationType.CALL_REQUESTED:
          await this.dispatchGeneric(type, userId, 'Call requested', payload);
          break;
        case NotificationType.ASSESSMENT_COMPLETED:
          await this.dispatchGeneric(
            type,
            userId,
            'Assessment completed',
            payload,
          );
          break;
        default:
          this.logger.warn(`Unhandled notification type: ${String(type)}`);
      }
    } catch (error) {
      this.logger.error(
        `Notification dispatch failed type=${type} user=${userId}: ${String(error)}`,
      );
    }
  }

  async notifyAdvancedRetakeIfEligible(
    userId: string,
    profile: RetakeEligibilityProfile | null,
  ): Promise<void> {
    const eligibilityDate = this.resolveRetakeEligibilityDate(profile);
    if (!eligibilityDate) {
      return;
    }

    await this.dispatch(NotificationType.ADVANCED_RETAKE_AVAILABLE, userId, {
      eligibilityDate,
    });
  }

  async processDueRetakeNotifications(): Promise<void> {
    const profiles = await this.talentProfileRepo.find({
      where: {
        advanced_retake_required: true,
        assessment_locked_until: LessThanOrEqual(new Date()),
      },
      select: {
        user_id: true,
        advanced_retake_required: true,
        assessment_locked_until: true,
      },
    });

    for (const profile of profiles) {
      try {
        await this.notifyAdvancedRetakeIfEligible(profile.user_id, profile);
      } catch (error) {
        this.logger.error(
          `Retake notification failed user=${profile.user_id}: ${String(error)}`,
        );
      }
    }
  }

  private resolveRetakeEligibilityDate(
    profile: RetakeEligibilityProfile | null,
  ): string | null {
    if (
      !profile?.advanced_retake_required ||
      !profile.assessment_locked_until
    ) {
      return null;
    }

    if (profile.assessment_locked_until.getTime() > Date.now()) {
      return null;
    }

    return profile.assessment_locked_until.toISOString();
  }

  private async dispatchAdvancedScoreReady(
    userId: string,
    result: AdvancedScoreReadyPayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    const tierLabel = this.formatTierLabel(result.tier);

    await this.notificationsService.create({
      userId,
      type: NotificationType.ADVANCED_ASSESSMENT_SCORE_READY,
      title: 'Your assessment results are ready',
      body: `You scored ${result.score}/${result.maxScore} (${result.percentage}%) — ${tierLabel}.`,
      data: {
        score: result.score,
        max_score: result.maxScore,
        percentage: result.percentage,
        tier: result.tier,
        tier_label: tierLabel,
      },
    });

    try {
      await this.mailService.sendAssessmentPerformance({
        to: user.email,
        recipientFirstName: user.first_name,
        score: result.score,
        maxScore: result.maxScore,
        percentage: result.percentage,
        tierLabel,
      });
    } catch (error) {
      this.logger.error(
        `Assessment performance email failed for user=${userId}: ${String(error)}`,
      );
    }
  }

  private async dispatchAdvancedRetakeAvailable(
    userId: string,
    payload: AdvancedRetakeAvailablePayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    try {
      await this.notificationsService.create({
        userId,
        type: NotificationType.ADVANCED_RETAKE_AVAILABLE,
        title: 'Advanced assessment retake is available',
        body: 'Your 14-day waiting period has ended. You can retake the advanced assessment now.',
        data: { eligibility_date: payload.eligibilityDate },
      });
    } catch (error) {
      if (isNotificationDuplicateError(error)) {
        return;
      }
      throw error;
    }

    try {
      await this.mailService.sendAdvancedRetakeAvailable({
        to: user.email,
        recipientFirstName: user.first_name,
      });
    } catch (error) {
      this.logger.error(
        `Advanced retake email failed for user=${userId}: ${String(error)}`,
      );
    }
  }

  private async dispatchOfferReceived(
    userId: string,
    payload: OfferReceivedPayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    await this.notificationsService.create({
      userId,
      type: NotificationType.OFFER_RECEIVED,
      title: 'New offer received',
      body: `${payload.employerName} sent you an offer for ${payload.roleTitle}.`,
      data: {
        offer_id: payload.offerId,
        employer_user_id: payload.employerUserId,
        employer_name: payload.employerName,
        role_title: payload.roleTitle,
      },
    });

    try {
      await this.mailService.send({
        to: user.email,
        subject: `New offer: ${payload.roleTitle}`,
        text: `Hi ${user.first_name},\n\n${payload.employerName} has sent you an offer for the role of ${payload.roleTitle}. Log in to view and respond.\n\nBest,\nSkillBridge Team`,
      });
    } catch (error) {
      this.logger.error(
        `Offer received email failed for user=${userId}: ${String(error)}`,
      );
    }
  }

  private async dispatchOfferResponded(
    type: NotificationType.OFFER_ACCEPTED | NotificationType.OFFER_DECLINED,
    userId: string,
    payload: OfferRespondedPayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    // Derive action from type to guarantee consistency
    const resolvedAction =
      type === NotificationType.OFFER_ACCEPTED ? 'accept' : 'decline';
    const actionLabel = resolvedAction === 'accept' ? 'accepted' : 'declined';
    const title =
      resolvedAction === 'accept' ? 'Offer accepted!' : 'Offer declined';

    await this.notificationsService.create({
      userId,
      type,
      title,
      body: `${payload.candidateName} has ${actionLabel} your offer for ${payload.roleTitle}.`,
      data: {
        offer_id: payload.offerId,
        candidate_user_id: payload.candidateUserId,
        candidate_name: payload.candidateName,
        role_title: payload.roleTitle,
        action: resolvedAction,
      },
    });

    try {
      await this.mailService.send({
        to: user.email,
        subject: `Offer ${actionLabel}: ${payload.roleTitle}`,
        text: `Hi ${user.first_name},\n\n${payload.candidateName} has ${actionLabel} your offer for ${payload.roleTitle}. Log in to view details.\n\nBest,\nSkillBridge Team`,
      });
    } catch (error) {
      this.logger.error(
        `Offer response email failed for user=${userId}: ${String(error)}`,
      );
    }
  }

  private async dispatchContactRequestReceived(
    userId: string,
    payload: ContactRequestReceivedPayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    await this.notificationsService.create({
      userId,
      type: NotificationType.CONTACT_REQUEST_RECEIVED,
      title: 'New contact request',
      body: `${payload.employerName} wants to connect with you.`,
      data: {
        contact_request_id: payload.contactRequestId,
        employer_user_id: payload.employerUserId,
        employer_name: payload.employerName,
      },
    });

    try {
      await this.mailService.send({
        to: user.email,
        subject: 'An employer wants to connect with you',
        text: `Hi ${user.first_name},\n\n${payload.employerName} is interested in your profile and wants to connect. Log in to view the message.\n\nBest,\nSkillBridge Team`,
      });
    } catch (error) {
      this.logger.error(
        `Contact request email failed for user=${userId}: ${String(error)}`,
      );
    }
  }

  private async dispatchAssessmentReceived(
    userId: string,
    payload: AssessmentReceivedPayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    await this.notificationsService.create({
      userId,
      type: NotificationType.ASSESSMENT_RECEIVED,
      title: 'New assessment received',
      body: `You have been invited to take ${payload.title}.`,
      data: {
        assessment_id: payload.assessmentId,
        title: payload.title,
        role_track: payload.roleTrack,
        share_url: payload.shareUrl,
      },
    });

    try {
      await this.mailService.send({
        to: user.email,
        subject: `Assessment invite: ${payload.title}`,
        text: `Hi ${user.first_name},\n\nYou have been invited to take ${payload.title}. Log in to CredLane to begin.\n\nBest,\nSkillBridge Team`,
      });
    } catch (error) {
      this.logger.error(
        `Assessment invite email failed for user=${userId}: ${String(error)}`,
      );
    }
  }

  private async dispatchOfferWithdrawn(
    userId: string,
    payload: OfferWithdrawnPayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    await this.notificationsService.create({
      userId,
      type: NotificationType.OFFER_WITHDRAWN,
      title: 'Offer withdrawn',
      body: `${payload.employerName} has withdrawn their offer for ${payload.roleTitle}.`,
      data: {
        offer_id: payload.offerId,
        employer_user_id: payload.employerUserId,
        employer_name: payload.employerName,
        role_title: payload.roleTitle,
      },
    });
  }

  private async dispatchOfferExpired(
    userId: string,
    payload: OfferExpiredPayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    await this.notificationsService.create({
      userId,
      type: NotificationType.OFFER_EXPIRED,
      title: 'Assessment window expired',
      body: `The assessment window for ${payload.roleTitle} has closed without a submission.`,
      data: {
        offer_id: payload.offerId,
        candidate_user_id: payload.candidateUserId,
        candidate_name: payload.candidateName,
        role_title: payload.roleTitle,
      },
    });
  }

  private async dispatchSkillAssessmentResult(
    type: NotificationType,
    userId: string,
    payload: SkillAssessmentResultPayload,
  ): Promise<void> {
    const level = this.humanize(payload.level);
    const track = this.humanize(payload.track);
    const passed = type === NotificationType.SKILL_ASSESSMENT_PASSED;

    await this.notificationsService.create({
      userId,
      type,
      title: passed
        ? `You passed the ${level} ${track} assessment`
        : 'Your skill assessment result is in',
      body: passed
        ? payload.certificateCode
          ? `You scored ${payload.percentage}%. Your skill certificate is ready to share from your dashboard.`
          : `You scored ${payload.percentage}%. Your level is verified.`
        : payload.retakeAvailable
          ? `You scored ${payload.percentage}%, below the 50% pass mark. Review the topics on your results page, then retake with new questions.`
          : `You scored ${payload.percentage}%, below the 50% pass mark. You have used all your skill attempts.`,
      data: {
        level: payload.level,
        track: payload.track,
        percentage: payload.percentage,
        certificate_code: payload.certificateCode ?? null,
        retake_available: payload.retakeAvailable,
      },
    });
  }

  private humanize(value: string): string {
    return value
      .split('_')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private async dispatchSkillAssessmentReady(userId: string): Promise<void> {
    await this.notificationsService.create({
      userId,
      type: NotificationType.SKILL_ASSESSMENT_READY,
      title: 'Your skill assessment retake is open',
      body: 'You can retake your skill assessment now.',
      data: {},
    });
  }

  private async dispatchAssessmentUnlocked(
    userId: string,
    payload: AssessmentUnlockedPayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    await this.notificationsService.create({
      userId,
      type: NotificationType.ASSESSMENT_UNLOCKED,
      title: 'Assessment window opened',
      body: `You have 5 days to complete the assessment for ${payload.roleTitle}. Deadline: ${new Date(payload.assessmentDeadline).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })}.`,
      data: {
        offer_id: payload.offerId,
        employer_user_id: payload.employerUserId,
        employer_name: payload.employerName,
        role_title: payload.roleTitle,
        assessment_deadline: payload.assessmentDeadline,
      },
    });
  }

  private async dispatchAssessmentWindowExtended(
    userId: string,
    payload: AssessmentWindowExtendedPayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    await this.notificationsService.create({
      userId,
      type: NotificationType.ASSESSMENT_WINDOW_EXTENDED,
      title: 'Assessment window extended',
      body: `Your assessment window for ${payload.roleTitle} has been extended. New deadline: ${new Date(payload.newDeadline).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })}.`,
      data: {
        offer_id: payload.offerId,
        employer_user_id: payload.employerUserId,
        employer_name: payload.employerName,
        role_title: payload.roleTitle,
        new_deadline: payload.newDeadline,
      },
    });
  }

  private async dispatchAssessmentWindowExpiring(
    userId: string,
    payload: AssessmentWindowExpiringPayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    await this.notificationsService.create({
      userId,
      type: NotificationType.ASSESSMENT_WINDOW_EXPIRING,
      title: 'Assessment window expiring soon',
      body: `${payload.candidateName} has less than 24 hours to submit the assessment for ${payload.roleTitle}.`,
      data: {
        offer_id: payload.offerId,
        candidate_user_id: payload.candidateUserId,
        candidate_name: payload.candidateName,
        role_title: payload.roleTitle,
        assessment_deadline: payload.assessmentDeadline,
      },
    });
  }

  private async dispatchAssessmentResult(
    type:
      | NotificationType.ASSESSMENT_PASSED
      | NotificationType.ASSESSMENT_FAILED,
    userId: string,
    payload: AssessmentResultPayload,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    const passed = type === NotificationType.ASSESSMENT_PASSED;
    const title = passed ? 'Assessment passed!' : 'Assessment not passed';
    const body = passed
      ? `${payload.candidateName} scored ${payload.score}% and passed the assessment for ${payload.roleTitle}.`
      : `${payload.candidateName} scored ${payload.score}% and did not meet the threshold for ${payload.roleTitle}.`;

    await this.notificationsService.create({
      userId,
      type,
      title,
      body,
      data: {
        offer_id: payload.offerId,
        candidate_user_id: payload.candidateUserId,
        candidate_name: payload.candidateName,
        employer_user_id: payload.employerUserId,
        role_title: payload.roleTitle,
        score: payload.score,
      },
    });
  }

  private async dispatchGeneric(
    type: NotificationType,
    userId: string,
    title: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Notification skipped: user not found user=${userId}`);
      return;
    }

    await this.notificationsService.create({
      userId,
      type,
      title,
      body: title,
      data: payload,
    });
  }

  private formatTierLabel(tier: AssessmentTier): string {
    switch (tier) {
      case AssessmentTier.JOB_READY:
        return 'Job Ready';
      case AssessmentTier.EMERGING:
        return 'Emerging';
      default:
        return 'Not Ready';
    }
  }
}
