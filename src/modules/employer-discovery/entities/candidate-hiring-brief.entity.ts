import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * AI hiring brief for one talent profile. The brief describes the candidate,
 * not the viewer, so it is generated once per set of assessment results and
 * shared by every employer who views the profile.
 */
@Entity('candidate_hiring_briefs')
@Index(['talent_profile_id'], { unique: true })
export class CandidateHiringBrief {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  talent_profile_id: string;

  /** Ids of the assessment results the brief was written from. */
  @Column({ type: 'varchar', length: 100 })
  source_key: string;

  @Column({ type: 'jsonb' })
  brief: Record<string, unknown>;

  /** Deterministic numbers shown beside the brief (no AI involved). */
  @Column({ type: 'jsonb' })
  stats: Record<string, unknown>;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
