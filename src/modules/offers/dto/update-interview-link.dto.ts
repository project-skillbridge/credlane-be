import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateInterviewLinkDto {
  @ApiProperty({ example: 'https://meet.google.com/abc-defg-hij' })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1000)
  interviewLink: string;
}
