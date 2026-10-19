import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VerifiedLevel } from '../../assessments/entities/assessment-question.entity';
import { PaginationDto } from '../../users/dto/pagination.dto';

const TIER_VALUES = ['job_ready'] as const;

const AVAILABILITY_VALUES = [
  'immediately_available',
  'on_notice_under_1_month',
  'on_notice_1_3_months',
  'employed_flexible',
] as const;

const EXPERIENCE_LEVEL_VALUES = [
  VerifiedLevel.JUNIOR,
  VerifiedLevel.MID,
  VerifiedLevel.SENIOR,
  VerifiedLevel.EXPERT,
] as const;

/** Normalize a query param that may arrive as a single string or an array. */
function toStringArray(value: unknown): string[] | undefined {
  if (value == null || value === '') return undefined;
  return Array.isArray(value) ? (value as string[]) : [value as string];
}

export class DiscoveryCandidatesQueryDto extends PaginationDto {
  @ApiProperty({
    required: false,
    type: [String],
    description: 'Filter by one or more role track slugs (multi-select)',
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  roleTrack?: string[];

  @ApiProperty({
    required: false,
    enum: TIER_VALUES,
    description: 'Filter by score tier (only job_ready exposed)',
  })
  @IsOptional()
  @IsIn(TIER_VALUES, { message: 'tier must be job_ready' })
  tier?: string;

  @ApiProperty({
    required: false,
    type: [String],
    enum: AVAILABILITY_VALUES,
    description: 'Filter by one or more availability values (multi-select)',
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsIn(AVAILABILITY_VALUES, {
    each: true,
    message: 'Invalid availability value',
  })
  availability?: string[];

  @ApiProperty({ required: false, description: 'Search by candidate name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiProperty({
    required: false,
    minimum: 0,
    maximum: 100,
    description: 'Minimum composite score filter (inclusive, 0–100)',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value == null || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiProperty({
    required: false,
    minimum: 0,
    maximum: 100,
    description: 'Maximum composite score (inclusive)',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value == null || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(0)
  @Max(100)
  maxScore?: number;

  @ApiProperty({
    required: false,
    type: [String],
    enum: EXPERIENCE_LEVEL_VALUES,
    description:
      'Filter by one or more validated experience levels (multi-select)',
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsIn(EXPERIENCE_LEVEL_VALUES, {
    each: true,
    message: 'Invalid experience level',
  })
  experienceLevel?: VerifiedLevel[];

  @ApiProperty({
    required: false,
    description:
      'Filter by region or country (partial match); comma-separate several',
    example: 'Nigeria',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  region?: string;
}
