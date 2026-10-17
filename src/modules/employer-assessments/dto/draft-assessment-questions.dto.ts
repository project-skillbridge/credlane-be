import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EmployerAssessmentExperienceLevel } from '../entities/employer-assessment.entity';

export class DraftAssessmentQuestionsDto {
  @ApiProperty({
    description: 'Job description or the skills the role needs.',
    minLength: 40,
    maxLength: 4000,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(40)
  @MaxLength(4000)
  jobDescription: string;

  @ApiPropertyOptional({ enum: EmployerAssessmentExperienceLevel })
  @IsOptional()
  @IsEnum(EmployerAssessmentExperienceLevel)
  experienceLevel?: EmployerAssessmentExperienceLevel;

  @ApiPropertyOptional({ default: 8, minimum: 5, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10)
  count?: number = 8;
}
