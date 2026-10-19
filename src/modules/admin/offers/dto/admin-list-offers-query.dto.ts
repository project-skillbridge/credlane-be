import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../../users/dto/pagination.dto';
import { OfferStatus } from '../../../offers/entities/offer.entity';

const OFFER_STATUS_VALUES = Object.values(OfferStatus);

export class AdminListOffersQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: OfferStatus,
    description: 'Filter by offer status',
  })
  @IsOptional()
  @IsIn(OFFER_STATUS_VALUES)
  status?: OfferStatus;

  @ApiPropertyOptional({
    description: 'Start of date range filter (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'End of date range filter (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    description:
      'Search by candidate or employer name (case-insensitive partial match)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  search?: string;
}
