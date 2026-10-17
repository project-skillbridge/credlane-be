import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';
import { TalentProfile } from '../entities/talent-profile.entity';
import { CertificatesService } from './certificates.service';

@ApiTags('certificates')
@Controller()
export class CertificatesController {
  constructor(
    private readonly certificates: CertificatesService,
    @InjectRepository(TalentProfile)
    private readonly profileRepo: Repository<TalentProfile>,
  ) {}

  @Get('talent/certificates')
  @ApiCookieAuth()
  @Roles(UserRole.TALENT)
  @ApiOperation({ summary: 'List the authenticated talent certificates' })
  async listOwn(@CurrentUser('sub') userId: string) {
    const profile = await this.profileRepo.findOne({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Talent profile not found');
    return this.certificates.listForTalentProfile(profile.id);
  }

  @Public()
  @Get('certificates/:code')
  @ApiOperation({
    summary: 'Verify a certificate by its public code',
    description:
      'Returns the holder name, track, level, dates and whether the certificate is valid, expired or revoked. Scores are never exposed.',
  })
  async verify(@Param('code') code: string) {
    return this.certificates.getPublic(code);
  }
}
