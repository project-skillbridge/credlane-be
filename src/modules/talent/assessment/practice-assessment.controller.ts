import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';
import { PracticeAssessmentService } from './practice-assessment.service';

class CheckPracticeAnswerDto {
  @IsUUID()
  questionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  answer: string;
}

@ApiTags('talent-assessment')
@ApiCookieAuth()
@Controller('talent/assessment/practice')
@Roles(UserRole.TALENT)
export class PracticeAssessmentController {
  constructor(private readonly practiceService: PracticeAssessmentService) {}

  @Get('questions')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Practice questions for the talent role and claimed level',
    description:
      'Ungraded and separate from the live bank. Correct answers are never returned here; ' +
      'check each answer with POST /check.',
  })
  @ApiOkResponse({ description: 'Shuffled practice questions' })
  @ApiNotFoundResponse({
    description: 'No practice questions exist for this role and level yet',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Role or claimed level is not set yet',
  })
  getQuestions(@CurrentUser('sub') userId: string) {
    return this.practiceService.getSet(userId);
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check one practice answer',
    description:
      'Returns whether the answer is right, the right answer and a short explanation.',
  })
  @ApiOkResponse({ description: 'Result with the explanation' })
  @ApiNotFoundResponse({ description: 'Practice question not found' })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  )
  check(
    @CurrentUser('sub') userId: string,
    @Body() dto: CheckPracticeAnswerDto,
  ) {
    return this.practiceService.check(userId, dto.questionId, dto.answer);
  }
}
