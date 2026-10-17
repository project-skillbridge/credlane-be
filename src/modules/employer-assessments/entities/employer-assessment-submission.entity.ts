import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import type { IntegrityLevel, IntegrityReport } from '../assessment-integrity';
import { EmployerAssessment } from './employer-assessment.entity';
import { EmployerAssessmentDeliveryMode } from './employer-assessment-invite.entity';

@Entity('employer_assessment_submissions')
@Unique('UQ_employer_submission_assessment_candidate', [
  'assessment_id',
  'candidate_user_id',
])
@Index('IDX_employer_assessment_submissions_assessment', ['assessment_id'])
@Index('IDX_employer_assessment_submissions_candidate', ['candidate_user_id'])
export class EmployerAssessmentSubmission {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  assessment_id: string;

  @ManyToOne(() => EmployerAssessment, (assessment) => assessment.submissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'assessment_id' })
  assessment: EmployerAssessment;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  candidate_user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidate_user_id' })
  candidate: User;

  @ApiProperty()
  @Column({ type: 'integer' })
  score: number;

  @ApiProperty()
  @Column({ type: 'boolean' })
  passed: boolean;

  @ApiProperty()
  @Column({ type: 'integer' })
  time_taken_seconds: number;

  @ApiProperty({ enum: EmployerAssessmentDeliveryMode })
  @Column({
    type: 'enum',
    enum: EmployerAssessmentDeliveryMode,
    enumName: 'employer_assessment_delivery_mode_enum',
  })
  delivery_mode: EmployerAssessmentDeliveryMode;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  answers: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  integrity: IntegrityReport | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  integrity_level: IntegrityLevel | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamp with time zone' })
  completed_at: Date;
}
