import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentResult } from '../assessments/entities';
import { TalentProfile } from '../talent/entities/talent-profile.entity';
import { CandidateHiringBrief } from './entities/candidate-hiring-brief.entity';
import { HiringBriefService } from './hiring-brief.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TalentProfile,
      AssessmentResult,
      CandidateHiringBrief,
    ]),
  ],
  providers: [HiringBriefService],
  exports: [HiringBriefService],
})
export class HiringBriefModule {}
