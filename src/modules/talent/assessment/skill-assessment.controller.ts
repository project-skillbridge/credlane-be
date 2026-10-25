import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';
import {
  StartSkillAssessmentDto,
  SubmitSkillAssessmentDto,
} from './dto/skill-assessment.dto';
import { FlagIntegrityEventDto } from './dto/integrity-event.dto';
import { SkillAssessmentService } from './skill-assessment.service';

@ApiTags('talent-assessment')
@ApiCookieAuth()
@Controller('talent/assessment/skill')
@Roles(UserRole.TALENT)
export class SkillAssessmentController {
  constructor(
    private readonly skillAssessmentService: SkillAssessmentService,
  ) {}

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a skill assessment',
    description:
      'Requires completed personal assessment plus onboarding track and claimed level. ' +
      'Builds a personalised question-bank session, creates a session, and returns the ordered MCQ questions.',
  })
  @ApiCreatedResponse({
    description: 'Assessment session created with questions',
  })
  @ApiNotFoundResponse({ description: 'Talent profile not found' })
  @ApiUnprocessableEntityResponse({
    description:
      'Personal assessment incomplete, or required onboarding fields missing',
  })
  @ApiForbiddenResponse({
    description:
      'Retake gate active, max skill attempts used (until advanced is complete), or not a talent user',
  })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  )
  start(
    @CurrentUser('sub') userId: string,
    @Body() _dto: StartSkillAssessmentDto,
  ) {
    return this.skillAssessmentService.start(userId);
  }

  @Get('availability')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Whether a skill assessment can be started right now',
    description:
      'False while a fresh set of questions is still being prepared for the talent. ' +
      'The UI uses it to show "available soon" instead of failing after Start.',
  })
  @ApiOkResponse({
    description: 'can_start, and whether the talent is already waitlisted',
  })
  @ApiNotFoundResponse({ description: 'Talent profile not found' })
  getAvailability(@CurrentUser('sub') userId: string) {
    return this.skillAssessmentService.getAvailability(userId);
  }

  @Get('session/:id')
  @HttpCode(HttpStatus.OK)
  @Header(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate',
  )
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @ApiOperation({
    summary: 'Resume a skill assessment session',
    description:
      'Returns the stored skill assessment session payload without creating or changing attempts. ' +
      'Use the existing_session_id from a 409 start response to resume an open session.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Skill assessment session returned' })
  @ApiNotFoundResponse({ description: 'Session not found' })
  @ApiForbiddenResponse({ description: 'Not a talent user' })
  getSession(
    @CurrentUser('sub') userId: string,
    @Param('id') sessionId: string,
  ) {
    return this.skillAssessmentService.getSession(userId, sessionId);
  }

  @Post('session/:id/flag')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report a skill assessment integrity event',
    description:
      'Accepts tab_switch or copy_paste events. Records the violation, voids the session, ' +
      'and returns action=logout so the frontend can end the assessment.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Session ID' })
  @ApiOkResponse({ description: 'Integrity event recorded' })
  @ApiNotFoundResponse({ description: 'Session not found' })
  @ApiForbiddenResponse({ description: 'Not a talent user' })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  )
  flagIntegrity(
    @CurrentUser('sub') userId: string,
    @Param('id') sessionId: string,
    @Body() dto: FlagIntegrityEventDto,
  ) {
    return this.skillAssessmentService.flag(userId, sessionId, dto);
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit skill assessment answers',
    description:
      'Scores MCQs immediately, sends text answers to the AI rubric layer, computes weighted section scores (MCQ 40%, text 60%). ' +
      'Overall below 50% is a total failure: the attempt is saved, profile status is set to not_ready, and validated_level / skill completion are not updated. ' +
      'Scores at or above 50% write validated_level, set skill_assessment_completed_at, and update pass status. ' +
      'Returns a guidance report when the pass gate was not met.',
  })
  @ApiOkResponse({
    description: 'Assessment scored and validated_level written',
  })
  @ApiNotFoundResponse({ description: 'Profile or attempt not found' })
  @ApiForbiddenResponse({ description: 'Not a talent user' })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  )
  submit(
    @CurrentUser('sub') userId: string,
    @Body() dto: SubmitSkillAssessmentDto,
  ) {
    return this.skillAssessmentService.submit(userId, dto);
  }
}
