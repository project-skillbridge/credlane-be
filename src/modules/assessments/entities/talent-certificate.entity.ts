import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TalentProfile } from '../../talent/entities/talent-profile.entity';

/**
 * A shareable, publicly verifiable record that a talent passed the skill
 * assessment for a track at a level. One row per talent, track and level; a
 * later pass at the same level renews it instead of issuing a second code.
 */
@Entity('talent_certificates')
@Index(
  'UQ_talent_certificates_holder_track_level',
  ['talent_profile_id', 'track', 'verified_level'],
  { unique: true },
)
export class TalentCertificate {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Public verification code' })
  @Index('UQ_talent_certificates_code', { unique: true })
  @Column({ type: 'varchar', length: 16 })
  code: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  talent_profile_id: string;

  @ManyToOne(() => TalentProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'talent_profile_id' })
  talent_profile: TalentProfile;

  @ApiProperty()
  @Column({ type: 'varchar', length: 64 })
  track: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 32 })
  verified_level: string;

  @ApiProperty()
  @Column({ type: 'timestamp with time zone' })
  issued_at: Date;

  @ApiProperty()
  @Column({ type: 'timestamp with time zone' })
  expires_at: Date;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamp with time zone', nullable: true })
  revoked_at: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
