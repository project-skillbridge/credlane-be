import { ApiProperty } from '@nestjs/swagger';
import { OfferStatus } from '../../offers/entities/offer.entity';
import { VerifiedProfileResponseDto } from '../../verified-profile/dto/verified-profile.dto';

export class CandidatePipelineDto {
  @ApiProperty({ format: 'uuid' })
  offer_id: string;

  @ApiProperty()
  role_title: string;

  @ApiProperty({ enum: OfferStatus })
  status: OfferStatus;

  @ApiProperty({ description: 'True once the employer confirmed the hire' })
  hired: boolean;

  @ApiProperty({ nullable: true })
  interview_link: string | null;

  @ApiProperty()
  sent_at: Date;
}

export class EmployerCandidateProfileResponseDto extends VerifiedProfileResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Candidate user id' })
  user_id: string;

  @ApiProperty({
    description: 'Whether the authenticated employer saved this candidate',
  })
  is_saved: boolean;

  @ApiProperty({
    description: 'Whether the employer has a pending or accepted offer out',
  })
  offer_sent: boolean;

  @ApiProperty({
    enum: [OfferStatus.PENDING, OfferStatus.ACCEPTED],
    nullable: true,
  })
  offer_status: OfferStatus | null;

  @ApiProperty({
    type: CandidatePipelineDto,
    nullable: true,
    description:
      'Latest invite this employer sent, so the page can show where they are with this talent',
  })
  pipeline: CandidatePipelineDto | null;

  @ApiProperty({
    description: 'True once the employer has unlocked this profile',
  })
  is_unlocked: boolean;

  @ApiProperty({ nullable: true, description: 'Only when unlocked' })
  portfolio_url: string | null;

  @ApiProperty({ nullable: true, description: 'Only when unlocked' })
  linkedin_url: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Talent role track, e.g. frontend_developer',
  })
  role_track: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Validated level: junior, mid, senior or expert',
  })
  validated_level: string | null;
}
