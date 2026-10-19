import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../users/entities/user.entity';
import { HiringBriefService } from './hiring-brief.service';
import { EmployerDiscoveryService } from './employer-discovery.service';
import { DiscoveryCandidatesQueryDto } from './dto/discovery-candidates-query.dto';
import { DiscoveryCandidatesListResponseDto } from './dto/discovery-candidate-card.dto';
import { EmployerCandidateProfileResponseDto } from './dto/employer-candidate-profile.dto';
import { SaveCandidateDto } from './dto/save-candidate.dto';
import { ContactCandidateDto } from './dto/contact-candidate.dto';
import { PaginationDto } from '../users/dto/pagination.dto';

@ApiTags('Employer Discovery')
@Controller('employer/discovery')
@Roles(UserRole.EMPLOYER)
export class EmployerDiscoveryController {
  constructor(
    private readonly discoveryService: EmployerDiscoveryService,
    private readonly hiringBriefService: HiringBriefService,
  ) {}

  @Get('candidates')
  @ApiOperation({
    summary: 'List Job Ready candidates with optional filters',
    description:
      'Returns design-facing candidate cards with role labels, skills, about tags, and employer shortlist/offer context.',
  })
  @ApiOkResponse({ type: DiscoveryCandidatesListResponseDto })
  async listCandidates(
    @CurrentUser('sub') employerUserId: string,
    @Query() query: DiscoveryCandidatesQueryDto,
  ) {
    return this.discoveryService.discoverCandidates(employerUserId, query);
  }

  @Get('candidates/:userId/profile')
  @ApiOperation({
    summary: 'View full verified profile of a Job Ready candidate',
    description:
      'Returns the same verified profile contract as GET /talent/verified-profile, plus employer shortlist and offer context.',
  })
  @ApiOkResponse({ type: EmployerCandidateProfileResponseDto })
  async getCandidateProfile(
    @CurrentUser('sub') employerUserId: string,
    @Param('userId', ParseUUIDPipe) candidateUserId: string,
  ) {
    return this.discoveryService.getCandidateProfile(
      employerUserId,
      candidateUserId,
    );
  }

  @Get('candidates/:userId/hiring-brief')
  @ApiOperation({
    summary: 'AI hiring brief for a candidate',
    description:
      'Strengths, gaps and open-ended answer review written from the candidate\'s skill and job-readiness assessments. Generated once per set of results and cached; returns status "generating" until ready.',
  })
  async getHiringBrief(
    @Param('userId', ParseUUIDPipe) candidateUserId: string,
  ) {
    return this.hiringBriefService.getBrief(candidateUserId);
  }

  @Post('candidates/:userId/unlock')
  @ApiOperation({
    summary: 'Unlock a candidate profile',
    description:
      'Spends one unlock (plan quota first, then credits) to reveal full name, photo, resume, portfolio and contact. Unlocking twice never charges twice. Returns 402 when no unlocks are left.',
  })
  async unlockCandidate(
    @CurrentUser('sub') employerUserId: string,
    @Param('userId', ParseUUIDPipe) candidateUserId: string,
  ) {
    return this.discoveryService.unlockCandidate(
      employerUserId,
      candidateUserId,
    );
  }

  @Post('candidates/:userId/save')
  @ApiOperation({ summary: 'Save a candidate to shortlist' })
  async saveCandidate(
    @CurrentUser('sub') employerUserId: string,
    @Param('userId', ParseUUIDPipe) candidateUserId: string,
    @Body() dto: SaveCandidateDto,
  ) {
    return this.discoveryService.saveCandidate(
      employerUserId,
      candidateUserId,
      dto.notes,
    );
  }

  @Delete('candidates/:userId/save')
  @ApiOperation({ summary: 'Remove a candidate from shortlist' })
  async unsaveCandidate(
    @CurrentUser('sub') employerUserId: string,
    @Param('userId', ParseUUIDPipe) candidateUserId: string,
  ) {
    return this.discoveryService.unsaveCandidate(
      employerUserId,
      candidateUserId,
    );
  }

  @Get('saved')
  @ApiOperation({ summary: 'List saved/shortlisted candidates' })
  async listSavedCandidates(
    @CurrentUser('sub') employerUserId: string,
    @Query() query: PaginationDto,
  ) {
    return this.discoveryService.listSavedCandidates(
      employerUserId,
      query.page,
      query.limit,
    );
  }

  @Post('candidates/:userId/contact')
  @ApiOperation({ summary: 'Send a contact request to a candidate' })
  async contactCandidate(
    @CurrentUser('sub') employerUserId: string,
    @Param('userId', ParseUUIDPipe) candidateUserId: string,
    @Body() dto: ContactCandidateDto,
  ) {
    return this.discoveryService.contactCandidate(
      employerUserId,
      candidateUserId,
      dto.message,
    );
  }
}
