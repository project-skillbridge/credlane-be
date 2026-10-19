import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import { AssessmentWaitlistService } from './assessment-waitlist.service';
import { SkillAssessmentService } from './skill-assessment.service';

const POLL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Tells waitlisted talents their next skill assessment is ready once the bank
 * holds enough questions they have not been served.
 */
@Injectable()
export class AssessmentWaitlistNotifier
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AssessmentWaitlistNotifier.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Prevents overlapping runs when a cycle outlasts the interval. */
  private isRunning = false;

  constructor(
    private readonly waitlist: AssessmentWaitlistService,
    private readonly skillAssessment: SkillAssessmentService,
    private readonly notifications: NotificationDispatchService,
  ) {}

  onModuleInit(): void {
    this.pollTimer = setInterval(() => void this.processWaitlist(), POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async processWaitlist(): Promise<number> {
    if (this.isRunning) {
      return 0;
    }
    this.isRunning = true;
    let notified = 0;
    try {
      for (const entry of await this.waitlist.findPending('skill')) {
        try {
          if (
            !(await this.skillAssessment.hasFreshCapacity(entry.talent_profile))
          ) {
            continue;
          }
          await this.notifications.notifySkillAssessmentReady(
            entry.talent_profile.user_id,
          );
          await this.waitlist.markNotified(entry.id);
          notified += 1;
        } catch (err) {
          this.logger.error(
            `Waitlist notify failed entry=${entry.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (notified > 0) {
        this.logger.log(`Notified ${notified} waitlisted talent(s)`);
      }
    } finally {
      this.isRunning = false;
    }
    return notified;
  }
}
