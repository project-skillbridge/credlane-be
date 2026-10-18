import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiUsageLog } from './ai-usage-log.entity';
import { HiringBriefGeneratorService } from './hiring-brief.service';
import { GuidanceReportService } from './guidance-report.service';
import { Lt3GenerationService } from './lt3-generation.service';
import { OpenRouterService } from './openrouter.service';
import { QuestionGenerationService } from './question-generation.service';
import { RubricScoringService } from './rubric-scoring.service';
import { ResourceGenerationService } from './resource-generation.service';
import { UrlResolutionService } from './url-resolution.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AiUsageLog])],
  providers: [
    OpenRouterService,
    RubricScoringService,
    QuestionGenerationService,
    Lt3GenerationService,
    GuidanceReportService,
    HiringBriefGeneratorService,
    ResourceGenerationService,
    UrlResolutionService,
  ],
  exports: [
    OpenRouterService,
    RubricScoringService,
    QuestionGenerationService,
    Lt3GenerationService,
    GuidanceReportService,
    HiringBriefGeneratorService,
    ResourceGenerationService,
    UrlResolutionService,
  ],
})
export class AiModule {}
