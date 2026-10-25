import { Injectable } from '@nestjs/common';
import { HiringBrief, hiringBriefSchema } from './ai.schemas';
import { HiringBriefInput } from './ai.types';
import { OpenRouterService } from './openrouter.service';
import {
  buildHiringBriefPrompt,
  HIRING_BRIEF_SYSTEM_PROMPT,
} from './prompt-builders';

@Injectable()
export class HiringBriefGeneratorService {
  constructor(private readonly openRouter: OpenRouterService) {}

  async generate(input: HiringBriefInput): Promise<HiringBrief> {
    const brief = await this.openRouter.chat(
      HIRING_BRIEF_SYSTEM_PROMPT,
      buildHiringBriefPrompt(input),
      hiringBriefSchema,
      0.3,
      false,
      undefined,
      'hiring_brief',
    );
    // The schema is lenient so a slightly long answer is not thrown away;
    // trim to the sizes the UI is designed for here.
    return {
      ...brief,
      strengths: brief.strengths.slice(0, 5),
      gaps: brief.gaps.slice(0, 4),
      open_ended: brief.open_ended.slice(0, 4),
      interview_questions: brief.interview_questions.slice(0, 5),
    };
  }
}
