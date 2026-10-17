import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { AdvancedAssessmentService } from './advanced-assessment.service';
import type { AdvancedAssessmentSubmitJobData } from './advanced-assessment-submit.types';

@Injectable()
export class AdvancedAssessmentSubmitProcessor {
  constructor(
    @Inject(forwardRef(() => AdvancedAssessmentService))
    private readonly advancedAssessmentService: AdvancedAssessmentService,
  ) {}

  async process(data: AdvancedAssessmentSubmitJobData): Promise<void> {
    await this.advancedAssessmentService.processSubmitJob(data);
  }

  /** Scoring gave up after its retries; see releaseFailedSubmit. */
  async onFinalFailure(data: AdvancedAssessmentSubmitJobData): Promise<void> {
    await this.advancedAssessmentService.releaseFailedSubmit(
      data.userId,
      data.sessionId,
    );
  }
}
