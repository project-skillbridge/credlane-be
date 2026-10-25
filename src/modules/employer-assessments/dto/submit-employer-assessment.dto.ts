import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { IntegrityEventsDto } from './integrity-events.dto';
import { EmployerAssessmentDeliveryMode } from '../entities/employer-assessment-invite.entity';

export class SubmitEmployerAssessmentDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  timeTakenSeconds: number;

  @ApiProperty({ enum: EmployerAssessmentDeliveryMode })
  @IsIn([
    EmployerAssessmentDeliveryMode.LINK,
    EmployerAssessmentDeliveryMode.DIRECT,
  ])
  deliveryMode: EmployerAssessmentDeliveryMode;

  @ApiProperty({
    required: false,
    description: 'Map of question ID to the candidate selected answer value',
  })
  @IsOptional()
  @IsObject()
  answers?: Record<string, unknown>;

  @ApiProperty({ required: false, type: IntegrityEventsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrityEventsDto)
  integrity?: IntegrityEventsDto;
}
