import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type EmployerUnlockSource = 'plan' | 'credit';

/** A candidate profile an employer has paid to see in full. */
@Entity('employer_unlocks')
@Index('UQ_employer_unlocks_pair', ['employer_user_id', 'candidate_user_id'], {
  unique: true,
})
export class EmployerUnlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  employer_user_id: string;

  @Column({ type: 'uuid' })
  candidate_user_id: string;

  @Column({ type: 'varchar', length: 10 })
  source: EmployerUnlockSource;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;
}
