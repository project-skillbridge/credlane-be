import { ApiProperty } from '@nestjs/swagger';
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
import type { IntegrityLevel, IntegrityReport } from '../assessment-integrity';
import { EmployerAssessment } from './employer-assessment.entity';
import { EmployerAssessmentExternalApplicant } from './employer-assessment-external-applicant.entity';

@Entity('employer_assessment_external_submissions')
@Unique('UQ_external_submission_assessment_applicant', [
  'assessment_id',
  'external_applicant_id',
])
@Index('IDX_external_submissions_assessment', ['assessment_id'])
export class EmployerAssessmentExternalSubmission {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  assessment_id: string;

  @ManyToOne(() => EmployerAssessment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assessment_id' })
  assessment: EmployerAssessment;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  external_applicant_id: string;

  @ManyToOne(() => EmployerAssessmentExternalApplicant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'external_applicant_id' })
  external_applicant: EmployerAssessmentExternalApplicant;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({ type: 'jsonb' })
  responses: Record<string, unknown>[];

  @ApiProperty()
  @Column({ type: 'integer' })
  score: number;

  @ApiProperty()
  @Column({ type: 'boolean' })
  passed: boolean;

  /** Measured by the server from the applicant's start. */
  @Column({ type: 'integer', nullable: true })
  time_taken_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  integrity: IntegrityReport | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  integrity_level: IntegrityLevel | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamp with time zone' })
  submitted_at: Date;
}
