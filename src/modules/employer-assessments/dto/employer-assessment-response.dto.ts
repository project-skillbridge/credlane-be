import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EmployerAssessmentExperienceLevel,
  EmployerAssessmentQuestionSource,
} from '../entities/employer-assessment.entity';
import { EmployerAssessmentDeliveryMode } from '../entities/employer-assessment-invite.entity';
import { EmployerQuestionType } from '../entities/employer-assessment-question.entity';

export class EmployerAssessmentQuestionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  assessment_id: string;

  @ApiProperty()
  position: number;

  @ApiProperty()
  question_text: string;

  @ApiProperty({ enum: EmployerQuestionType })
  question_type: EmployerQuestionType;

  @ApiPropertyOptional({ nullable: true, type: [String] })
  options: string[] | null;

  @ApiProperty()
  correct_answer: string;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;
}

export class PublicEmployerAssessmentQuestionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  position: number;

  @ApiProperty()
  question_text: string;

  @ApiProperty({ enum: EmployerQuestionType })
  question_type: EmployerQuestionType;

  @ApiPropertyOptional({ nullable: true, type: [String] })
  options: string[] | null;
}

export class EmployerAssessmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  employer_user_id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  role_track: string;

  @ApiProperty({ enum: EmployerAssessmentExperienceLevel })
  experience_level: EmployerAssessmentExperienceLevel;

  @ApiProperty()
  time_limit_minutes: number;

  @ApiProperty()
  passing_threshold: number;

  @ApiProperty({ enum: EmployerAssessmentQuestionSource })
  question_source: EmployerAssessmentQuestionSource;

  @ApiProperty()
  share_via_link: boolean;

  @ApiProperty()
  send_to_candidates: boolean;

  @ApiProperty()
  share_token: string;

  @ApiPropertyOptional()
  shareUrl?: string;

  @ApiProperty()
  is_active: boolean;

  @ApiProperty({ type: [EmployerAssessmentQuestionResponseDto] })
  questions: EmployerAssessmentQuestionResponseDto[];

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;
}

export class PublicEmployerAssessmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  role_track: string;

  @ApiProperty({ enum: EmployerAssessmentExperienceLevel })
  experience_level: EmployerAssessmentExperienceLevel;

  @ApiProperty()
  time_limit_minutes: number;

  @ApiProperty()
  passing_threshold: number;

  @ApiProperty({ enum: ['internal', 'external'] })
  type: string;

  @ApiProperty({ nullable: true })
  employer_name: string | null;

  @ApiProperty({ nullable: true })
  welcome_message: string | null;

  @ApiProperty({ type: [PublicEmployerAssessmentQuestionResponseDto] })
  questions: PublicEmployerAssessmentQuestionResponseDto[];
}

export class ListEmployerAssessmentsResponseDto {
  @ApiProperty({ type: [EmployerAssessmentResponseDto] })
  assessments: EmployerAssessmentResponseDto[];

  @ApiPropertyOptional({ nullable: true })
  emptyState: string | null;
}

export class DeactivateEmployerAssessmentResponseDto {
  @ApiProperty({ example: 'success' })
  status: string;

  @ApiProperty({ example: 'Assessment link deactivated' })
  message: string;
}

export class ImportedQuestionResponseDto {
  @ApiProperty()
  questionText: string;

  @ApiProperty({ enum: EmployerQuestionType })
  questionType: EmployerQuestionType;

  @ApiPropertyOptional({ type: [String] })
  options?: string[];

  @ApiProperty()
  correctAnswer: string;
}

export class ImportedQuestionsResponseDto {
  @ApiProperty({ example: 'success' })
  status: string;

  @ApiProperty({ type: [ImportedQuestionResponseDto] })
  questions: ImportedQuestionResponseDto[];

  @ApiProperty()
  questionCount: number;
}

export class AssessmentCandidateSearchItemDto {
  @ApiProperty({ format: 'uuid' })
  candidateUserId: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty()
  email: string;
}

export class SearchAssessmentCandidatesResponseDto {
  @ApiProperty({ type: [AssessmentCandidateSearchItemDto] })
  candidates: AssessmentCandidateSearchItemDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

export class AssessmentResultItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  candidateUserId: string;

  @ApiPropertyOptional({ nullable: true })
  candidateName: string | null;

  @ApiProperty()
  score: number;

  @ApiProperty({ enum: ['pass', 'fail'] })
  status: 'pass' | 'fail';

  @ApiProperty()
  timeTakenSeconds: number;

  @ApiProperty()
  dateCompleted: Date;

  @ApiProperty({ enum: EmployerAssessmentDeliveryMode })
  deliveryMode: EmployerAssessmentDeliveryMode;
}

export class ListEmployerAssessmentResultsResponseDto {
  @ApiProperty({ type: [AssessmentResultItemDto] })
  submissions: AssessmentResultItemDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;

  @ApiPropertyOptional({ nullable: true })
  emptyState: string | null;
}

export class EmployerAssessmentSubmissionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  assessment_id: string;

  @ApiProperty({ format: 'uuid' })
  candidate_user_id: string;

  @ApiProperty()
  score: number;

  @ApiProperty()
  passed: boolean;

  @ApiProperty()
  time_taken_seconds: number;

  @ApiProperty({ enum: EmployerAssessmentDeliveryMode })
  delivery_mode: EmployerAssessmentDeliveryMode;

  @ApiPropertyOptional({ nullable: true })
  answers: Record<string, unknown> | null;

  @ApiProperty()
  completed_at: Date;
}

export class CredlaneCatalogueAssessmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiProperty({ example: '30 minutes' })
  estimated_completion_time: string;

  @ApiProperty()
  role_track: string;

  @ApiProperty({ enum: EmployerAssessmentExperienceLevel })
  experience_level: EmployerAssessmentExperienceLevel;
}

export class ListCredlaneCatalogueResponseDto {
  @ApiProperty({ type: [CredlaneCatalogueAssessmentResponseDto] })
  catalogue: CredlaneCatalogueAssessmentResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}
