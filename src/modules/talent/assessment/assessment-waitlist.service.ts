import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AssessmentWaitlist } from '../../assessments/entities';
import { TalentProfile } from '../entities/talent-profile.entity';

export type WaitlistAssessmentType = 'skill';

@Injectable()
export class AssessmentWaitlistService {
  private readonly logger = new Logger(AssessmentWaitlistService.name);

  constructor(
    @InjectRepository(AssessmentWaitlist)
    private readonly waitlistRepo: Repository<AssessmentWaitlist>,
  ) {}

  /** Idempotent: a talent has at most one open entry per assessment type. */
  async join(
    profile: Pick<TalentProfile, 'id' | 'track'>,
    assessmentType: WaitlistAssessmentType,
    verifiedLevel: string,
  ): Promise<void> {
    await this.waitlistRepo
      .createQueryBuilder()
      .insert()
      .into(AssessmentWaitlist)
      .values({
        talent_profile_id: profile.id,
        assessment_type: assessmentType,
        track: profile.track ?? 'general',
        verified_level: verifiedLevel,
      })
      .orIgnore()
      .execute();
    this.logger.log(
      `Waitlisted talent=${profile.id} type=${assessmentType} track=${profile.track} level=${verifiedLevel}`,
    );
  }

  async isWaitlisted(
    talentProfileId: string,
    assessmentType: WaitlistAssessmentType,
  ): Promise<boolean> {
    return this.waitlistRepo.exists({
      where: {
        talent_profile_id: talentProfileId,
        assessment_type: assessmentType,
        notified_at: IsNull(),
      },
    });
  }

  findPending(
    assessmentType: WaitlistAssessmentType,
    limit = 200,
  ): Promise<AssessmentWaitlist[]> {
    return this.waitlistRepo.find({
      where: { assessment_type: assessmentType, notified_at: IsNull() },
      relations: { talent_profile: true },
      order: { created_at: 'ASC' },
      take: limit,
    });
  }

  async markNotified(id: string): Promise<void> {
    await this.waitlistRepo.update(id, { notified_at: new Date() });
  }
}
