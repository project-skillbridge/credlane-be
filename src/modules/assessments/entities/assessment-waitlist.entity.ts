import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TalentProfile } from '../../talent/entities/talent-profile.entity';

/**
 * A talent who could not start an assessment because the question bank has no
 * unserved questions left for their track and level. They are told their next
 * assessment is being prepared, and notified once new questions land.
 */
@Entity('assessment_waitlist')
export class AssessmentWaitlist {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  talent_profile_id: string;

  @ManyToOne(() => TalentProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'talent_profile_id' })
  talent_profile: TalentProfile;

  @ApiProperty({ enum: ['skill'] })
  @Column({ type: 'varchar', length: 32 })
  assessment_type: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 64 })
  track: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 32 })
  verified_level: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamp with time zone', nullable: true })
  notified_at: Date | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;
}
