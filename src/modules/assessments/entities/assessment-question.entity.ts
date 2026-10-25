import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum AssessmentType {
  SKILL = 'skill',
  ADVANCED = 'advanced',
  /** Ungraded practice questions shown before the real assessment. */
  PRACTICE = 'practice',
}

export enum QuestionType {
  SINGLE_PICK = 'single_pick',
  MULTI_PICK = 'multi_pick',
  REQUIRED_TEXT = 'required_text',
  OPTIONAL_TEXT = 'optional_text',
}

export enum VerifiedLevel {
  JUNIOR = 'junior',
  MID = 'mid',
  SENIOR = 'senior',
  EXPERT = 'expert',
}

export enum SlotType {
  SITUATIONAL = 'situational',
  WORK_TASK = 'work_task',
  REFLECTION = 'reflection',
}

export enum QuestionReviewStatus {
  ACTIVE = 'active',
  FLAGGED = 'flagged',
  REMOVED = 'removed',
}

export enum QuestionSource {
  IMPORT = 'import',
  MANUAL = 'manual',
  AI_GENERATED = 'ai_generated',
}

@Entity('assessment_questions')
export class AssessmentQuestion {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: AssessmentType })
  @Column({ type: 'enum', enum: AssessmentType })
  assessment_type: AssessmentType;

  @ApiProperty({ enum: QuestionType })
  @Column({ type: 'enum', enum: QuestionType })
  question_type: QuestionType;

  @ApiProperty()
  @Column({ type: 'text' })
  question_text: string;

  @ApiProperty()
  @Column({ type: 'integer' })
  question_number: number;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Array of options for pick-type questions',
  })
  @Column({ type: 'jsonb', nullable: true })
  options: string[] | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Correct answer for skill assessment questions',
  })
  @Column({ type: 'text', nullable: true })
  correct_answer: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Track for skill assessment questions (e.g., frontend_developer)',
  })
  @Column({ type: 'varchar', length: 100, nullable: true })
  track: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    enum: VerifiedLevel,
    description: 'Target verified level for this question',
  })
  @Column({ type: 'enum', enum: VerifiedLevel, nullable: true })
  verified_level: VerifiedLevel | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Specific competency being tested (e.g., react-hooks, async-programming)',
  })
  @Column({ type: 'varchar', length: 100, nullable: true })
  competency: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    enum: SlotType,
    description: 'Question categorization for advanced assessments',
  })
  @Column({ type: 'enum', enum: SlotType, nullable: true })
  slot_type: SlotType | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Structured metadata: { difficulty: "easy"|"medium"|"hard", estimated_time_seconds: number, tags: string[], rubric?: { criteria: string, max_points: number }[], author?: string, version?: number, explanation?: string, hints?: string[] }',
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @ApiProperty({
    default: false,
    description: 'Whether question is active/published or draft',
  })
  @Column({ type: 'boolean', default: false })
  is_live: boolean;

  @ApiProperty({
    enum: QuestionReviewStatus,
    description:
      'Moderation status. Removing a question also sets is_live=false so it stops being served to candidates; restoring sets is_live back to true. Flagging does not affect is_live — flagged questions stay in rotation pending review.',
  })
  @Column({
    type: 'enum',
    enum: QuestionReviewStatus,
    default: QuestionReviewStatus.ACTIVE,
  })
  review_status: QuestionReviewStatus;

  @ApiProperty({ enum: QuestionSource })
  @Column({
    type: 'enum',
    enum: QuestionSource,
    default: QuestionSource.IMPORT,
  })
  source: QuestionSource;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @Column({ type: 'uuid', nullable: true })
  added_by: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'added_by' })
  added_by_user: User | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
