import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  EMPLOYER_COMPANY_SIZES,
  EMPLOYER_DESIRED_ROLES,
  EMPLOYER_HIRING_RANGES,
  EMPLOYER_PREFERRED_EXPERIENCE_LEVELS,
  EMPLOYER_TYPES,
} from '../employer.constants';

export class SaveEmployerProfileDto {
  @ApiProperty({
    example: 'Recruiter',
    enum: EMPLOYER_TYPES,
    description: 'Founder | Recruiter | Agency',
  })
  @IsIn(EMPLOYER_TYPES, { message: 'Invalid employer type selection' })
  employerType: string;

  @ApiProperty({ example: 'Acme Labs' })
  @IsString()
  @MinLength(1, { message: 'companyName is required' })
  @MaxLength(255)
  companyName: string;

  @ApiProperty({
    example: '11-50',
    enum: EMPLOYER_COMPANY_SIZES,
    description: '1-10 | 11-50 | 51-200 | 201-500 | 500+',
  })
  @IsIn(EMPLOYER_COMPANY_SIZES, { message: 'Invalid company size selection' })
  companySize: string;

  @ApiProperty({ example: 'https://acmelabs.com' })
  @IsUrl({}, { message: 'Please enter a valid website URL' })
  @MaxLength(500)
  companyWebsite: string;

  @ApiProperty({ example: 'Fintech' })
  @IsString()
  @MinLength(1, { message: 'industry is required' })
  @MaxLength(100)
  industry: string;

  @ApiProperty({ example: 'Nigeria' })
  @IsString()
  @MinLength(2, { message: 'region is required' })
  @MaxLength(100)
  region: string;

  @ApiPropertyOptional({
    example: 'https://www.linkedin.com/company/acmelabs',
  })
  @IsOptional()
  @MaxLength(500)
  linkedinCompanyPageUrl?: string;

  @ApiProperty({
    example: ['frontend_developer', 'backend_developer'],
    enum: EMPLOYER_DESIRED_ROLES,
    type: [String],
    description: 'At least one role track required',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Please select at least one role' })
  @IsIn(EMPLOYER_DESIRED_ROLES, {
    each: true,
    message: `Each role must be one of: ${EMPLOYER_DESIRED_ROLES.join(', ')}`,
  })
  hiringRoles: string[];

  @ApiProperty({
    example: ['junior', 'mid'],
    enum: EMPLOYER_PREFERRED_EXPERIENCE_LEVELS,
    isArray: true,
    description: 'Preferred experience levels for discovery defaults',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Please select at least one experience level' })
  @IsIn(EMPLOYER_PREFERRED_EXPERIENCE_LEVELS, {
    each: true,
    message: 'Invalid experience level selection',
  })
  preferredExperienceLevels: string[];

  @ApiPropertyOptional({
    example: '6_10',
    enum: EMPLOYER_HIRING_RANGES,
    description: 'Approximate number of talents to hire; optional',
  })
  @IsOptional()
  @IsIn(EMPLOYER_HIRING_RANGES, {
    message: `hiringCount must be one of: ${EMPLOYER_HIRING_RANGES.join(', ')}`,
  })
  hiringCount?: string;
}
