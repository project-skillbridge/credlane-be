import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminTiers } from '../../../common/decorators/admin-tiers.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AdminTier, UserRole } from '../../users/entities/user.entity';
import { AdminOffersService } from './admin-offers.service';
import { AdminOffersStatsQueryDto } from './dto/admin-offers-stats-query.dto';
import { AdminListOffersQueryDto } from './dto/admin-list-offers-query.dto';
import {
  AdminOfferFunnelResponse,
  AdminOfferListResponse,
  AdminOffersStatsResponse,
} from './dto/admin-offers-responses.dto';

@ApiTags('admin-offers')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@AdminTiers(AdminTier.SUPER_ADMIN, AdminTier.ADMIN)
@Controller('admin/offers')
export class AdminOffersController {
  constructor(private readonly offersService: AdminOffersService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Offers page stat cards (row of 4)' })
  @ApiOkResponse({ type: AdminOffersStatsResponse })
  async getStats(
    @Query() query: AdminOffersStatsQueryDto,
  ): Promise<AdminOffersStatsResponse> {
    const data = await this.offersService.getStats(
      query.dateFrom,
      query.dateTo,
    );
    return { status: 'success', data };
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Offer status funnel chart data' })
  @ApiOkResponse({ type: AdminOfferFunnelResponse })
  async getFunnel(
    @Query() query: AdminOffersStatsQueryDto,
  ): Promise<AdminOfferFunnelResponse> {
    const data = await this.offersService.getFunnel(
      query.dateFrom,
      query.dateTo,
    );
    return { status: 'success', data };
  }

  @Get()
  @ApiOperation({
    summary: 'All Offers table — paginated, filtered, searchable',
  })
  @ApiOkResponse({ type: AdminOfferListResponse })
  async findAll(
    @Query() query: AdminListOffersQueryDto,
  ): Promise<AdminOfferListResponse> {
    const data = await this.offersService.findAll(query);
    return { status: 'success', data };
  }
}
