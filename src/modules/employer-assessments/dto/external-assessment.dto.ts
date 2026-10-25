import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IntegrityEventsDto } from './integrity-events.dto';

export class RegisterExternalAssessmentDto {
  @ApiProperty({ example: 'Ada Lovelace' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @ApiProperty({
    example: 'K7M2QX',
    description: 'The access code the employer gave you.',
  })
  @IsString()
  @MinLength(4)
  @MaxLength(12)
  accessCode: string;

  @ApiProperty({ example: 'candidate@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  consentedMarketing: boolean;
}

export class ExternalAssessmentAnswerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  questionId: string;

  @ApiProperty()
  @IsString()
  answer: string;
}

export class ExternalAssessmentModuleResponseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  moduleId: string;

  @ApiProperty({ type: [ExternalAssessmentAnswerDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExternalAssessmentAnswerDto)
  answers: ExternalAssessmentAnswerDto[];
}

export class SubmitExternalAssessmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  externalApplicantId: string;

  @ApiProperty({ type: [ExternalAssessmentModuleResponseDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExternalAssessmentModuleResponseDto)
  responses: ExternalAssessmentModuleResponseDto[];

  @ApiProperty({ required: false, type: IntegrityEventsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrityEventsDto)
  integrity?: IntegrityEventsDto;
}
