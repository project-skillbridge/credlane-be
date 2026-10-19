import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListEmployerAssessmentResultsQueryDto {
  @ApiPropertyOptional({ enum: ['pass', 'fail'] })
  @IsOptional()
  @IsIn(['pass', 'fail'])
  status?: 'pass' | 'fail';

  @ApiPropertyOptional({ enum: ['talent', 'external'] })
  @IsOptional()
  @IsIn(['talent', 'external'])
  source?: 'talent' | 'external';

  @ApiPropertyOptional({ enum: ['score', 'date'], default: 'score' })
  @IsOptional()
  @IsIn(['score', 'date'])
  sort?: 'score' | 'date';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
