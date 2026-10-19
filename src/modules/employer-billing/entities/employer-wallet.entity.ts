import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** An employer's unlock allowance: plan quota for the month plus bonus credits. */
@Entity('employer_wallets')
export class EmployerWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  employer_user_id: string;

  @Column({ type: 'varchar', length: 20, default: 'free' })
  plan: string;

  /** Unlocks used in the current monthly period. */
  @Column({ type: 'int', default: 0 })
  period_used: number;

  @Column({ type: 'timestamp with time zone' })
  period_start: Date;

  /** One-off credits (welcome grant, purchased top-ups). */
  @Column({ type: 'int', default: 0 })
  bonus_credits: number;

  /** Candidate invites used in the current monthly period. */
  @Column({ type: 'int', default: 0 })
  invite_period_used: number;

  /** Purchased invite packs; these never expire. */
  @Column({ type: 'int', default: 0 })
  invite_bonus_credits: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
