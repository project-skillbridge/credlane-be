import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  DeactivateEmployerAssessmentResponseDto,
  EmployerAssessmentResponseDto,
  EmployerAssessmentSubmissionResponseDto,
  ImportedQuestionsResponseDto,
  ListCredlaneCatalogueResponseDto,
  ListEmployerAssessmentResultsResponseDto,
  ListEmployerAssessmentsResponseDto,
  PublicEmployerAssessmentResponseDto,
  SearchAssessmentCandidatesResponseDto,
} from '../dto/employer-assessment-response.dto';

export const ApiEmployerAssessmentsTags = () =>
  applyDecorators(ApiTags('Employer Assessments'));

export const ApiCreateEmployerAssessment = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Create and generate a new employer assessment' }),
    ApiResponse({
      status: 201,
      description: 'Assessment created successfully',
      type: EmployerAssessmentResponseDto,
    }),
    ApiResponse({ status: 400, description: 'Invalid assessment payload' }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({
      status: 403,
      description: 'Verified employer access required',
    }),
    ApiResponse({
      status: 429,
      description: 'Active assessment limit reached',
    }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
  );

export const ApiListEmployerAssessments = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'List assessments for this employer' }),
    ApiResponse({
      status: 200,
      description: 'Employer assessments returned',
      type: ListEmployerAssessmentsResponseDto,
    }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({ status: 403, description: 'Employer access required' }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
  );

export const ApiSearchAssessmentCandidates = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Search shortlisted candidates for direct sending',
    }),
    ApiResponse({
      status: 200,
      description: 'Candidate search results returned',
      type: SearchAssessmentCandidatesResponseDto,
    }),
    ApiResponse({ status: 400, description: 'Invalid search query' }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({ status: 403, description: 'Employer access required' }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
  );

export const ApiDownloadCsvTemplate = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Download CredLane question template (CSV)' }),
    ApiResponse({
      status: 200,
      description: 'CSV template downloaded',
      content: { 'text/csv': { schema: { type: 'string' } } },
    }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({ status: 403, description: 'Employer access required' }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
  );

export const ApiDownloadXlsxTemplate = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Download CredLane question template (XLSX)' }),
    ApiResponse({
      status: 200,
      description: 'XLSX template downloaded',
      content: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: { type: 'string', format: 'binary' },
        },
      },
    }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({ status: 403, description: 'Employer access required' }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
  );

export const ApiImportAssessmentQuestions = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Validate and import company questions from CSV or XLSX',
    }),
    ApiResponse({
      status: 201,
      description: 'Questions imported successfully',
      type: ImportedQuestionsResponseDto,
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid or unreadable upload file',
    }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({ status: 403, description: 'Employer access required' }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary' },
        },
      },
    }),
  );

export const ApiGetEmployerAssessment = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Get assessment detail' }),
    ApiResponse({
      status: 200,
      description: 'Assessment detail returned',
      type: EmployerAssessmentResponseDto,
    }),
    ApiResponse({ status: 400, description: 'Invalid assessment ID' }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({ status: 403, description: 'Employer access required' }),
    ApiResponse({ status: 404, description: 'Assessment not found' }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
  );

export const ApiDeactivateEmployerAssessment = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Deactivate assessment link' }),
    ApiResponse({
      status: 200,
      description: 'Assessment deactivated',
      type: DeactivateEmployerAssessmentResponseDto,
    }),
    ApiResponse({ status: 400, description: 'Invalid assessment ID' }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({ status: 403, description: 'Employer access required' }),
    ApiResponse({ status: 404, description: 'Assessment not found' }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
  );

export const ApiListEmployerAssessmentResults = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'List assessment submissions and results' }),
    ApiResponse({
      status: 200,
      description: 'Assessment results returned',
      type: ListEmployerAssessmentResultsResponseDto,
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid assessment ID or results query',
    }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({ status: 403, description: 'Employer access required' }),
    ApiResponse({ status: 404, description: 'Assessment not found' }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
  );

export const ApiGetCredlaneCatalogueEntry = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Preview a SkillSift library assessment (questions, no answers)',
    }),
    ApiResponse({ status: 200, description: 'Library assessment returned' }),
    ApiResponse({ status: 403, description: 'Verified employer required' }),
    ApiResponse({ status: 404, description: 'Library assessment not found' }),
  );

export const ApiDraftAssessmentQuestions = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'AI-draft screening questions from a job description',
      description:
        'Returns a draft the employer must review and edit. Limited to 10 per hour.',
    }),
    ApiResponse({ status: 200, description: 'Drafted questions returned' }),
    ApiResponse({ status: 400, description: 'Not enough usable questions' }),
    ApiResponse({ status: 403, description: 'Verified employer required' }),
    ApiResponse({ status: 429, description: 'Too many drafts requested' }),
    ApiResponse({ status: 503, description: 'AI service unavailable' }),
  );

export const ApiGetEmployerAssessmentResultDetail = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get one submission with per-question answers and rank',
    }),
    ApiResponse({ status: 200, description: 'Submission detail returned' }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({ status: 403, description: 'Employer access required' }),
    ApiResponse({
      status: 404,
      description: 'Assessment or submission not found',
    }),
  );

export const ApiGetPublicAssessment = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get public assessment by share token' }),
    ApiResponse({
      status: 200,
      description: 'Public assessment returned',
      type: PublicEmployerAssessmentResponseDto,
    }),
    ApiResponse({
      status: 403,
      description: 'Assessment is no longer accepting submissions',
    }),
    ApiResponse({ status: 404, description: 'Assessment link not found' }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
  );

export const ApiSubmitEmployerAssessment = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Submit an employer assessment as a candidate' }),
    ApiResponse({
      status: 201,
      description: 'Assessment submitted successfully',
      type: EmployerAssessmentSubmissionResponseDto,
    }),
    ApiResponse({ status: 400, description: 'Invalid submission payload' }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({
      status: 403,
      description: 'Talent access required or assessment inactive',
    }),
    ApiResponse({ status: 404, description: 'Assessment link not found' }),
    ApiResponse({ status: 409, description: 'Assessment already submitted' }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
  );

export const ApiListCredlaneCatalogue = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Browse the CredLane pre-built assessment catalogue',
    }),
    ApiResponse({
      status: 200,
      description: 'Catalogue entries returned',
      type: ListCredlaneCatalogueResponseDto,
    }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({ status: 403, description: 'Employer access required' }),
    ApiResponse({ status: 500, description: 'Internal server error' }),
  );
