import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  EmployerAssessmentExperienceLevel,
  EmployerAssessmentQuestionSource,
  EmployerAssessmentType,
} from '../entities/employer-assessment.entity';
import type { TalentRoleTrack } from '../../talent/talent.constants';
import { EmployerQuestionType } from '../entities/employer-assessment-question.entity';

export class EmployerAssessmentQuestionInputDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  questionText: string;

  @ApiProperty({ enum: EmployerQuestionType })
  @IsEnum(EmployerQuestionType)
  questionType: EmployerQuestionType;

  @ApiProperty({ required: false, type: [String] })
  @ValidateIf((dto: EmployerAssessmentQuestionInputDto) =>
    [
      EmployerQuestionType.MULTIPLE_CHOICE,
      EmployerQuestionType.TRUE_FALSE,
    ].includes(dto.questionType),
  )
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @Matches(/\S/, { each: true })
  options?: string[];

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  correctAnswer: string;
}

export class CreateEmployerAssessmentDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  roleTrack: TalentRoleTrack;

  @ApiProperty({ enum: EmployerAssessmentExperienceLevel })
  @IsEnum(EmployerAssessmentExperienceLevel)
  experienceLevel: EmployerAssessmentExperienceLevel;

  @ApiProperty({ enum: [20, 30, 40, 60] })
  @Type(() => Number)
  @IsInt()
  @IsIn([20, 30, 40, 60])
  timeLimitMinutes: number;

  @ApiProperty({ minimum: 50, maximum: 90 })
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(90)
  passingThreshold: number;

  @ApiProperty({ enum: EmployerAssessmentQuestionSource })
  @IsEnum(EmployerAssessmentQuestionSource)
  questionSource: EmployerAssessmentQuestionSource;

  @ApiProperty({
    enum: EmployerAssessmentType,
    description:
      'internal invites use talent IDs; external invites use emails.',
  })
  @IsEnum(EmployerAssessmentType)
  type: EmployerAssessmentType;

  @ApiProperty({ required: false, type: [EmployerAssessmentQuestionInputDto] })
  @ValidateIf(
    (dto: CreateEmployerAssessmentDto) =>
      dto.questionSource === EmployerAssessmentQuestionSource.COMPANY_QUESTIONS,
  )
  @IsArray()
  @ArrayMinSize(5)
  @ValidateNested({ each: true })
  @Type(() => EmployerAssessmentQuestionInputDto)
  questions?: EmployerAssessmentQuestionInputDto[];

  @ApiProperty({
    required: false,
    format: 'uuid',
    description:
      'Required when questionSource is credlane_bank. Must reference an active CredLane catalogue entry.',
  })
  @ValidateIf(
    (dto: CreateEmployerAssessmentDto) =>
      dto.questionSource === EmployerAssessmentQuestionSource.CREDLANE_BANK,
  )
  @IsNotEmpty()
  @IsUUID('4')
  credlaneAssessmentId?: string;

  @ApiProperty()
  @IsBoolean()
  shareViaLink: boolean;

  @ApiProperty()
  @IsBoolean()
  sendToCandidates: boolean;

  @ApiProperty({ required: false, type: [String], format: 'uuid' })
  @ValidateIf((dto: CreateEmployerAssessmentDto) => dto.sendToCandidates)
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  candidateUserIds?: string[];
}
