import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { redisQueueConnection } from '../../../shared/runtime/redis-queue';
import { AdvancedAssessmentSubmitProcessor } from './advanced-assessment-submit.processor';
import {
  advancedAssessmentSubmitJobSchema,
  type AdvancedAssessmentSubmitJobData,
} from './advanced-assessment-submit.types';

const QUEUE_NAME = 'advanced-assessment-submit';
const JOB_NAME = 'process-submit';
/** Scoring depends on the AI service, so retry transient failures with backoff. */
const SCORING_ATTEMPTS = 5;
const SCORING_BACKOFF_MS = 60_000;

@Injectable()
export class AdvancedAssessmentQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AdvancedAssessmentQueueService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private inlinePending = 0;
  private inlineIdleWaiters: Array<() => void> = [];

  constructor(
    private readonly submitProcessor: AdvancedAssessmentSubmitProcessor,
  ) {}

  onModuleInit(): void {
    const conn = redisQueueConnection();
    if (!conn) {
      this.logger.log(
        'REDIS_URL not set; advanced-assessment submit runs inline (async) after the request returns. ' +
          'Rubric scoring may take 30s+ in-process; set REDIS_URL in production.',
      );
      return;
    }
    this.queue = new Queue(QUEUE_NAME, { connection: conn });
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        if (job.name !== JOB_NAME) {
          throw new Error(`Unknown advanced assessment job: ${job.name}`);
        }
        const parsed = advancedAssessmentSubmitJobSchema.safeParse(job.data);
        if (!parsed.success) {
          this.logger.error(
            'Invalid advanced-assessment submit job payload',
            parsed.error.flatten(),
          );
          throw new Error('Invalid advanced-assessment submit job payload');
        }
        await this.submitProcessor.process(parsed.data);
      },
      { connection: conn },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Advanced assessment submit job ${job?.id} failed`,
        err instanceof Error ? err.stack : err,
      );
      const attempts = job?.opts.attempts ?? 1;
      if (job && job.attemptsMade >= attempts) {
        void this.submitProcessor
          .onFinalFailure(job.data as AdvancedAssessmentSubmitJobData)
          .catch((e: unknown) =>
            this.logger.error(
              `Could not release retake lock for job ${job.id}`,
              e instanceof Error ? e.stack : e,
            ),
          );
      }
    });
  }

  async enqueue(payload: AdvancedAssessmentSubmitJobData): Promise<void> {
    const conn = redisQueueConnection();
    if (!conn) {
      this.inlinePending++;
      setImmediate(() => {
        void (async () => {
          try {
            await this.submitProcessor.process(payload);
          } catch (err) {
            this.logger.error(
              'Inline advanced-assessment submit failed',
              err instanceof Error ? err.stack : err,
            );
            // No queue means no retries, so this failure is final.
            await this.submitProcessor.onFinalFailure(payload).catch(() => {});
          } finally {
            this.inlinePending--;
            this.flushInlineWaiters();
          }
        })();
      });
      return;
    }

    const existing = await this.queue!.getJob(payload.sessionId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed') {
        await existing.remove();
      } else {
        return;
      }
    }

    try {
      await this.queue!.add(JOB_NAME, payload, {
        jobId: payload.sessionId,
        attempts: SCORING_ATTEMPTS,
        backoff: { type: 'exponential', delay: SCORING_BACKOFF_MS },
        removeOnComplete: true,
        removeOnFail: false,
      });
    } catch (err: unknown) {
      this.logger.error(
        'Failed to enqueue advanced-assessment submit job',
        err instanceof Error ? err.stack : err,
      );
      throw err;
    }
  }

  /** For e2e when REDIS_URL is unset: wait until inline jobs finish. */
  awaitIdleForTests(): Promise<void> {
    if (redisQueueConnection()) return Promise.resolve();
    if (this.inlinePending === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.inlineIdleWaiters.push(resolve);
    });
  }

  private flushInlineWaiters(): void {
    if (this.inlinePending === 0 && this.inlineIdleWaiters.length > 0) {
      const waiters = this.inlineIdleWaiters;
      this.inlineIdleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
