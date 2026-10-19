import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EmployerAssessment } from './employer-assessment.entity';

@Entity('employer_assessment_external_applicants')
@Index('IDX_external_applicants_assessment', ['assessment_id'])
@Index('IDX_external_applicants_session_token', ['session_token'], {
  unique: true,
})
@Index('UQ_external_applicants_assessment_email', ['assessment_id', 'email'], {
  unique: true,
})
export class EmployerAssessmentExternalApplicant {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  assessment_id: string;

  @ManyToOne(() => EmployerAssessment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assessment_id' })
  assessment: EmployerAssessment;

  @ApiProperty()
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  full_name: string | null;

  @ApiProperty()
  @Column({ type: 'boolean' })
  consented_marketing: boolean;

  @ApiProperty()
  @Column({ type: 'timestamp with time zone' })
  consented_at: Date;

  @ApiProperty()
  @Column({ type: 'varchar', length: 96 })
  session_token: string;

  /** Per-assessment hash of the network address, to spot shared networks. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip_hash: string | null;

  @ApiProperty()
  @Column({ type: 'timestamp with time zone' })
  session_expires_at: Date;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;
}
