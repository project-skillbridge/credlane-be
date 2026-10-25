import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('hire_feedback')
@Index('IDX_hire_feedback_candidate', ['candidate_user_id'])
@Index('IDX_hire_feedback_employer', ['employer_user_id'])
export class HireFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  offer_id: string;

  @Column({ type: 'uuid' })
  employer_user_id: string;

  @Column({ type: 'uuid' })
  candidate_user_id: string;

  @Column({ type: 'smallint' })
  overall_rating: number;

  @Column({ type: 'boolean' })
  would_hire_again: boolean;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;
}
