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
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { EmployerPoolProfile } from '../../talent/entities/employer-pool-profile.entity';
import { EmployerRole } from '../../employer-roles/entities/employer-role.entity';

export enum OfferStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
  WITHDRAWN = 'withdrawn',
}

@Entity('offers')
@Index('IDX_offers_employer', ['employer_user_id'])
@Index('IDX_offers_candidate', ['candidate_user_id'])
@Index('IDX_offers_status', ['status'])
@Index(
  'UQ_offers_active_employer_candidate',
  ['employer_user_id', 'candidate_user_id', 'role_id'],
  {
    unique: true,
    where: `"status" IN ('pending', 'accepted')`,
  },
)
export class Offer {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  employer_user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employer_user_id' })
  employer: User;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  candidate_user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidate_user_id' })
  candidate: User;

  @ApiProperty({ format: 'uuid', required: false, nullable: true })
  @Column({ type: 'uuid', nullable: true })
  employer_pool_profile_id: string | null;

  @ManyToOne(() => EmployerPoolProfile, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'employer_pool_profile_id' })
  employer_pool_profile: EmployerPoolProfile | null;

  @ApiProperty({ format: 'uuid', required: false, nullable: true })
  @Column({ type: 'uuid', nullable: true })
  role_id: string | null;

  @ManyToOne(() => EmployerRole, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'role_id' })
  role: EmployerRole | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 255 })
  role_title: string;

  @ApiProperty()
  @Column({ type: 'text' })
  message: string;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'text', nullable: true })
  role_description: string | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  compensation: string | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  employment_type: string | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  work_arrangement: string | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'date', nullable: true })
  application_deadline: string | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  interview_link: string | null;

  @ApiProperty({ enum: OfferStatus })
  @Column({
    type: 'enum',
    enum: OfferStatus,
    enumName: 'offer_status_enum',
    default: OfferStatus.PENDING,
  })
  status: OfferStatus;

  @ApiProperty()
  @Column({ type: 'timestamp with time zone' })
  expires_at: Date;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'timestamp with time zone', nullable: true })
  responded_at: Date | null;

  /** Set once when the employer confirms they hired the candidate. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  hired_at: Date | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
