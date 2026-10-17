import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EmployerAssessmentExperienceLevel } from '../entities/employer-assessment.entity';

export class ListCredlaneCatalogueQueryDto {
  @ApiPropertyOptional({
    description: 'Only library assessments for this role track',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  roleTrack?: string;

  @ApiPropertyOptional({ enum: EmployerAssessmentExperienceLevel })
  @IsOptional()
  @IsEnum(EmployerAssessmentExperienceLevel)
  experienceLevel?: EmployerAssessmentExperienceLevel;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
