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
import { CredlaneCatalogueAssessment } from './credlane-catalogue-assessment.entity';
import { EmployerQuestionType } from './employer-assessment-question.entity';

/** One question of a SkillSift library assessment, copied to an employer's assessment on use. */
@Entity('credlane_catalogue_questions')
@Index(
  'UQ_credlane_catalogue_questions_position',
  ['catalogue_assessment_id', 'position'],
  { unique: true },
)
export class CredlaneCatalogueQuestion {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  catalogue_assessment_id: string;

  @ManyToOne(() => CredlaneCatalogueAssessment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'catalogue_assessment_id' })
  catalogue_assessment: CredlaneCatalogueAssessment;

  @ApiProperty()
  @Column({ type: 'integer' })
  position: number;

  @ApiProperty()
  @Column({ type: 'text' })
  question_text: string;

  @ApiProperty({ enum: EmployerQuestionType })
  @Column({
    type: 'enum',
    enum: EmployerQuestionType,
    enumName: 'employer_assessment_question_type_enum',
  })
  question_type: EmployerQuestionType;

  @ApiProperty({ required: false, nullable: true, type: [String] })
  @Column({ type: 'jsonb', nullable: true })
  options: string[] | null;

  @ApiProperty()
  @Column({ type: 'text' })
  correct_answer: string;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
