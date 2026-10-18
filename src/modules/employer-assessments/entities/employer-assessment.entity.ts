import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { EmployerAssessmentQuestion } from './employer-assessment-question.entity';
import { EmployerAssessmentInvite } from './employer-assessment-invite.entity';
import { EmployerAssessmentSubmission } from './employer-assessment-submission.entity';
import { CredlaneCatalogueAssessment } from './credlane-catalogue-assessment.entity';

export enum EmployerAssessmentExperienceLevel {
  JUNIOR = 'junior',
  MID = 'mid',
  SENIOR = 'senior',
}

export enum EmployerAssessmentQuestionSource {
  CREDLANE_BANK = 'credlane_bank',
  COMPANY_QUESTIONS = 'company_questions',
  MANUAL = 'manual',
  ADMIN_UPLOAD = 'admin_upload',
}

export enum EmployerAssessmentType {
  INTERNAL = 'internal',
  EXTERNAL = 'external',
}

@Entity('employer_assessments')
@Index('IDX_employer_assessments_employer_active', [
  'employer_user_id',
  'is_active',
])
@Index('IDX_employer_assessments_share_token', ['share_token'], {
  unique: true,
})
export class EmployerAssessment {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  employer_user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employer_user_id' })
  employer: User;

  @ApiProperty()
  @Column({ type: 'varchar', length: 255 })
  title: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 100 })
  role_track: string;

  @ApiProperty({ enum: EmployerAssessmentExperienceLevel })
  @Column({
    type: 'enum',
    enum: EmployerAssessmentExperienceLevel,
    enumName: 'employer_assessment_experience_level_enum',
  })
  experience_level: EmployerAssessmentExperienceLevel;

  @ApiProperty()
  @Column({ type: 'integer' })
  time_limit_minutes: number;

  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  welcome_message: string | null;

  @ApiProperty()
  @Column({ type: 'integer' })
  passing_threshold: number;

  @ApiProperty({ enum: EmployerAssessmentQuestionSource })
  @Column({
    type: 'enum',
    enum: EmployerAssessmentQuestionSource,
    enumName: 'employer_assessment_question_source_enum',
  })
  question_source: EmployerAssessmentQuestionSource;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  share_via_link: boolean;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  send_to_candidates: boolean;

  @ApiProperty({
    enum: EmployerAssessmentType,
    default: EmployerAssessmentType.INTERNAL,
  })
  @Column({
    type: 'enum',
    enum: EmployerAssessmentType,
    enumName: 'employer_assessment_type_enum',
    default: EmployerAssessmentType.INTERNAL,
  })
  type: EmployerAssessmentType;

  @ApiProperty()
  @Column({ type: 'varchar', length: 64 })
  share_token: string;

  @ApiProperty()
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  credlane_assessment_id: string | null;

  @ManyToOne(() => CredlaneCatalogueAssessment, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'credlane_assessment_id' })
  credlane_catalogue_assessment: CredlaneCatalogueAssessment | null;

  @OneToMany(
    () => EmployerAssessmentQuestion,
    (question) => question.assessment,
  )
  questions: EmployerAssessmentQuestion[];

  @OneToMany(() => EmployerAssessmentInvite, (invite) => invite.assessment)
  invites: EmployerAssessmentInvite[];

  @OneToMany(
    () => EmployerAssessmentSubmission,
    (submission) => submission.assessment,
  )
  submissions: EmployerAssessmentSubmission[];

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
