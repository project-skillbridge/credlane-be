import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import {
  ApiCreateEmployerAssessment,
  ApiDeactivateEmployerAssessment,
  ApiDownloadCsvTemplate,
  ApiDownloadXlsxTemplate,
  ApiEmployerAssessmentsTags,
  ApiGetEmployerAssessment,
  ApiGetPublicAssessment,
  ApiImportAssessmentQuestions,
  ApiListCredlaneCatalogue,
  ApiDraftAssessmentQuestions,
  ApiGetCredlaneCatalogueEntry,
  ApiGetEmployerAssessmentResultDetail,
  ApiListEmployerAssessmentResults,
  ApiListEmployerAssessments,
  ApiSearchAssessmentCandidates,
  ApiSubmitEmployerAssessment,
} from './docs/employer-assessments.swagger';
import { CreateEmployerAssessmentDto } from './dto/create-employer-assessment.dto';
import {
  RegisterExternalAssessmentDto,
  SubmitExternalAssessmentDto,
} from './dto/external-assessment.dto';
import { InviteEmployerAssessmentDto } from './dto/invite-employer-assessment.dto';
import { ListCredlaneCatalogueQueryDto } from './dto/list-credlane-catalogue-query.dto';
import { ListEmployerAssessmentResultsQueryDto } from './dto/list-employer-assessment-results-query.dto';
import { SearchAssessmentCandidatesQueryDto } from './dto/search-assessment-candidates-query.dto';
import { SubmitEmployerAssessmentDto } from './dto/submit-employer-assessment.dto';
import { EMPLOYER_ASSESSMENT_IMPORT_MAX_FILE_BYTES } from './employer-assessments.constants';
import { DraftAssessmentQuestionsDto } from './dto/draft-assessment-questions.dto';
import { EmployerAssessmentDraftService } from './employer-assessment-draft.service';
import { EmployerAssessmentsService } from './employer-assessments.service';

@ApiEmployerAssessmentsTags()
@Controller()
export class EmployerAssessmentsController {
  constructor(
    private readonly employerAssessmentsService: EmployerAssessmentsService,
    private readonly draftService: EmployerAssessmentDraftService,
  ) {}

  /** AI-drafted starting point only; the employer reviews before saving. */
  @Post('employer/assessments/draft-questions')
  @Roles(UserRole.EMPLOYER)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiDraftAssessmentQuestions()
  draftQuestions(
    @CurrentUser('sub') employerUserId: string,
    @Body() dto: DraftAssessmentQuestionsDto,
  ) {
    return this.draftService.draftQuestions(employerUserId, dto);
  }

  @Post('employer/assessments')
  @Roles(UserRole.EMPLOYER)
  @ApiCreateEmployerAssessment()
  createAssessment(
    @CurrentUser('sub') employerUserId: string,
    @Body() dto: CreateEmployerAssessmentDto,
  ) {
    return this.employerAssessmentsService.createAssessment(
      employerUserId,
      dto,
    );
  }

  @Get('employer/assessments')
  @Roles(UserRole.EMPLOYER)
  @ApiListEmployerAssessments()
  listAssessments(@CurrentUser('sub') employerUserId: string) {
    return this.employerAssessmentsService.listAssessments(employerUserId);
  }

  @Get('employer/assessments/candidates')
  @Roles(UserRole.EMPLOYER)
  @ApiSearchAssessmentCandidates()
  searchCandidates(
    @CurrentUser('sub') employerUserId: string,
    @Query() query: SearchAssessmentCandidatesQueryDto,
  ) {
    return this.employerAssessmentsService.searchCandidates(
      employerUserId,
      query,
    );
  }

  @Get('employer/assessments/search-talent')
  @Roles(UserRole.EMPLOYER)
  @ApiSearchAssessmentCandidates()
  searchVerifiedTalent(
    @CurrentUser('sub') employerUserId: string,
    @Query('q') q?: string,
    @Query('limit') limit?: number,
    @Query('track') track?: string,
  ) {
    return this.employerAssessmentsService.searchVerifiedTalent(
      employerUserId,
      q ?? '',
      Number(limit ?? 10),
      track,
    );
  }

  @Get('employer/assessments/template.csv')
  @Roles(UserRole.EMPLOYER)
  @ApiDownloadCsvTemplate()
  downloadCsvTemplate(@Res() response: Response): void {
    response.setHeader('Content-Type', 'text/csv');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="skillsift-question-template.csv"',
    );
    response.send(this.employerAssessmentsService.getTemplateCsv());
  }

  @Get('employer/assessments/template.xlsx')
  @Roles(UserRole.EMPLOYER)
  @ApiDownloadXlsxTemplate()
  downloadXlsxTemplate(@Res() response: Response): void {
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="skillsift-question-template.xlsx"',
    );
    response.send(this.employerAssessmentsService.getTemplateXlsx());
  }

  @Post('employer/assessments/import-questions')
  @Roles(UserRole.EMPLOYER)
  @ApiImportAssessmentQuestions()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: EMPLOYER_ASSESSMENT_IMPORT_MAX_FILE_BYTES },
    }),
  )
  importQuestions(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.employerAssessmentsService.validateUploadedQuestionFile(file);
  }

  @Get('employer/assessments/credlane-catalogue')
  @Roles(UserRole.EMPLOYER)
  @ApiListCredlaneCatalogue()
  listCredlaneCatalogue(
    @CurrentUser('sub') employerUserId: string,
    @Query() query: ListCredlaneCatalogueQueryDto,
  ) {
    return this.employerAssessmentsService.listCredlaneCatalogue(
      employerUserId,
      query.page,
      query.limit,
      { roleTrack: query.roleTrack, experienceLevel: query.experienceLevel },
    );
  }

  @Get('employer/assessments/credlane-catalogue/:catalogueId')
  @Roles(UserRole.EMPLOYER)
  @ApiGetCredlaneCatalogueEntry()
  getCredlaneCatalogueEntry(
    @CurrentUser('sub') employerUserId: string,
    @Param('catalogueId', ParseUUIDPipe) catalogueId: string,
  ) {
    return this.employerAssessmentsService.getCredlaneCatalogueEntry(
      employerUserId,
      catalogueId,
    );
  }

  @Get('employer/assessments/:assessmentId')
  @Roles(UserRole.EMPLOYER)
  @ApiGetEmployerAssessment()
  getAssessment(
    @CurrentUser('sub') employerUserId: string,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query() query: ListEmployerAssessmentResultsQueryDto,
  ) {
    return this.employerAssessmentsService.getAssessment(
      employerUserId,
      assessmentId,
      query,
    );
  }

  @Patch('employer/assessments/:assessmentId/deactivate')
  @Roles(UserRole.EMPLOYER)
  @ApiDeactivateEmployerAssessment()
  deactivateAssessment(
    @CurrentUser('sub') employerUserId: string,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    return this.employerAssessmentsService.deactivateAssessment(
      employerUserId,
      assessmentId,
    );
  }

  @Post('employer/assessments/:assessmentId/invite')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.EMPLOYER)
  inviteAssessment(
    @CurrentUser('sub') employerUserId: string,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: InviteEmployerAssessmentDto,
  ) {
    return this.employerAssessmentsService.inviteAssessment(
      employerUserId,
      assessmentId,
      dto,
    );
  }

  @Get('employer/assessments/:assessmentId/token')
  @Roles(UserRole.EMPLOYER)
  getAssessmentToken(
    @CurrentUser('sub') employerUserId: string,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    return this.employerAssessmentsService.getAssessmentToken(
      employerUserId,
      assessmentId,
    );
  }

  @Get('employer/assessments/:assessmentId/share-link')
  @Roles(UserRole.EMPLOYER)
  getAssessmentShareLink(
    @CurrentUser('sub') employerUserId: string,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    return this.employerAssessmentsService.getAssessmentShareLink(
      employerUserId,
      assessmentId,
    );
  }

  @Get('employer/assessments/:assessmentId/results')
  @Roles(UserRole.EMPLOYER)
  @ApiListEmployerAssessmentResults()
  listResults(
    @CurrentUser('sub') employerUserId: string,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query() query: ListEmployerAssessmentResultsQueryDto,
  ) {
    return this.employerAssessmentsService.listResults(
      employerUserId,
      assessmentId,
      query,
    );
  }

  @Get('employer/assessments/:assessmentId/results/:submissionId')
  @Roles(UserRole.EMPLOYER)
  @ApiGetEmployerAssessmentResultDetail()
  getResultDetail(
    @CurrentUser('sub') employerUserId: string,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ) {
    return this.employerAssessmentsService.getResultDetail(
      employerUserId,
      assessmentId,
      submissionId,
    );
  }

  @Get('assessments/link/:token')
  @Public()
  @ApiGetPublicAssessment()
  getPublicAssessment(@Param('token') token: string) {
    return this.employerAssessmentsService.getPublicAssessmentByToken(token);
  }

  @Get('assessments/external/:token')
  @Public()
  getExternalAssessment(@Param('token') token: string) {
    return this.employerAssessmentsService.getExternalAssessmentByToken(token);
  }

  @Post('assessments/external/:token/register')
  @Public()
  registerExternalAssessment(
    @Param('token') token: string,
    @Body() dto: RegisterExternalAssessmentDto,
    @Ip() ip: string,
  ) {
    return this.employerAssessmentsService.registerExternalApplicant(
      token,
      dto,
      ip,
    );
  }

  @Post('assessments/external/:token/submit')
  @HttpCode(HttpStatus.OK)
  @Public()
  submitExternalAssessment(
    @Param('token') token: string,
    @Headers('x-session-token') sessionToken: string,
    @Body() dto: SubmitExternalAssessmentDto,
  ) {
    return this.employerAssessmentsService.submitExternalAssessment(
      token,
      sessionToken,
      dto,
    );
  }

  @Post('assessments/link/:token/start')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TALENT)
  startAssessment(
    @CurrentUser('sub') candidateUserId: string,
    @Param('token') token: string,
  ) {
    return this.employerAssessmentsService.startAssessment(
      candidateUserId,
      token,
    );
  }

  @Post('assessments/link/:token/submissions')
  @Roles(UserRole.TALENT)
  @ApiSubmitEmployerAssessment()
  submitAssessment(
    @CurrentUser('sub') candidateUserId: string,
    @Param('token') token: string,
    @Body() dto: SubmitEmployerAssessmentDto,
  ) {
    return this.employerAssessmentsService.submitAssessment(
      candidateUserId,
      token,
      dto,
    );
  }
}
