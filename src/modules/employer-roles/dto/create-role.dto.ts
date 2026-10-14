import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsIn,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { EmployerRoleVisibility } from '../entities/employer-role.entity';
import {
  TALENT_ROLE_TRACKS,
  TALENT_EDUCATION_LEVELS,
} from '../../talent/talent.constants';
import type {
  TalentRoleTrack,
  TalentEducationLevel,
} from '../../talent/talent.constants';
import { VerifiedLevel } from '../../assessments/entities/assessment-question.entity';

export class CreateRoleDto {
  @ApiProperty({ example: 'Senior Backend Engineer' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'Engineering' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  category: string;

  @ApiPropertyOptional({
    description: 'Job description text (also accepted as jd_text)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Alias for description — job description text',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  jd_text?: string;

  @ApiPropertyOptional({
    enum: ['Full-time', 'Part-time', 'Contract', 'Internship'],
  })
  @IsOptional()
  @IsIn(['Full-time', 'Part-time', 'Contract', 'Internship'])
  employmentType?: string;

  @ApiPropertyOptional({ enum: ['Remote', 'Hybrid', 'On-site'] })
  @IsOptional()
  @IsIn(['Remote', 'Hybrid', 'On-site'])
  workArrangement?: string;

  @ApiPropertyOptional({
    example: 'bachelor',
    enum: TALENT_EDUCATION_LEVELS,
    description: 'Minimum education level required',
  })
  @IsOptional()
  @IsIn([...TALENT_EDUCATION_LEVELS])
  education?: TalentEducationLevel;

  @ApiPropertyOptional({
    example: 'mid',
    enum: VerifiedLevel,
    description: 'Target experience level for this role',
  })
  @IsOptional()
  @IsEnum(VerifiedLevel)
  level?: VerifiedLevel;

  @ApiPropertyOptional({ type: [String], example: ['NestJS', 'PostgreSQL'] })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : undefined,
  )
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Alias for keywords',
    example: ['NestJS', 'PostgreSQL'],
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : undefined,
  )
  @IsArray()
  @IsString({ each: true })
  keyword?: string[];

  @ApiPropertyOptional({ example: 80000 })
  @IsOptional()
  @Transform(({ value }) =>
    value != null && value !== '' ? Number(value) : undefined,
  )
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @ApiPropertyOptional({ example: 120000 })
  @IsOptional()
  @Transform(({ value }) =>
    value != null && value !== '' ? Number(value) : undefined,
  )
  @IsInt()
  @Min(0)
  @Max(99999999)
  salaryMax?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Attach an existing assessment',
  })
  @IsOptional()
  @IsUUID()
  assessmentId?: string;

  @ApiPropertyOptional({
    enum: EmployerRoleVisibility,
    default: EmployerRoleVisibility.PUBLIC,
  })
  @IsOptional()
  @IsEnum(EmployerRoleVisibility)
  visibility?: EmployerRoleVisibility;

  @ApiProperty({
    example: 'backend_developer',
    enum: TALENT_ROLE_TRACKS,
    description: 'Canonical talent track slug this role maps to',
  })
  @IsIn([...TALENT_ROLE_TRACKS])
  track: TalentRoleTrack;

  @ApiPropertyOptional({
    example: 100,
    nullable: true,
    description: 'Maximum interested applicants. Send null to remove the cap.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): number | null | undefined => {
    if (value === null) return null;
    if (value === '' || value === undefined) return undefined;
    return Number(value);
  })
  @IsInt()
  @Min(1)
  applicantCap?: number | null;
}
