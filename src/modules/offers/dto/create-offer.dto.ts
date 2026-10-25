import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOfferDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Candidate user IDs to receive this offer. Single sends pass a one-element array.',
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsNotEmpty({ each: true })
  @IsUUID(undefined, { each: true })
  candidateIds: string[];

  @ApiProperty({
    format: 'uuid',
    description: 'Active role this offer is for. Must belong to your account.',
  })
  @IsNotEmpty()
  @IsUUID()
  roleId: string;

  @ApiPropertyOptional({
    description: 'Job role title. Defaults from role when roleId is supplied.',
  })
  @ValidateIf(
    (dto: CreateOfferDto) => !dto.roleId || dto.roleTitle !== undefined,
  )
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  roleTitle?: string;

  @ApiPropertyOptional({ description: 'Role description', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  roleDescription?: string;

  @ApiProperty({
    required: false,
    description: 'Legacy offer message / description',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({
    description:
      'Compensation or salary range. Defaults from role salary when roleId is supplied.',
  })
  @ValidateIf(
    (dto: CreateOfferDto) => !dto.roleId || dto.compensation !== undefined,
  )
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  compensation?: string;

  @ApiPropertyOptional({
    enum: ['Full-time', 'Part-time', 'Contract', 'Internship'],
    description: 'Defaults from role when roleId is supplied.',
  })
  @ValidateIf(
    (dto: CreateOfferDto) => !dto.roleId || dto.employmentType !== undefined,
  )
  @IsNotEmpty()
  @IsIn(['Full-time', 'Part-time', 'Contract', 'Internship'])
  employmentType?: string;

  @ApiPropertyOptional({
    enum: ['Remote', 'Hybrid', 'On-site'],
    description: 'Defaults from role when roleId is supplied.',
  })
  @ValidateIf(
    (dto: CreateOfferDto) => !dto.roleId || dto.workArrangement !== undefined,
  )
  @IsNotEmpty()
  @IsIn(['Remote', 'Hybrid', 'On-site'])
  workArrangement?: string;

  @ApiProperty({ required: false, type: String, format: 'date' })
  @IsOptional()
  @IsDateString()
  applicationDeadline?: string;

  @ApiPropertyOptional({
    example: 'https://meet.google.com/abc-defg-hij',
    description: 'Optional interview link included when talent accepts.',
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1000)
  interviewLink?: string;

  @ApiProperty({
    required: false,
    default: 14,
    description: 'Offer expiry in days (1-90)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  expiresInDays?: number = 14;
}
