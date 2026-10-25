import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AssessmentTier } from '../../assessments/entities/assessment-result.entity';
import {
  AssessmentAttempt,
  AssessmentQuestion,
  AssessmentScore,
  AssessmentScoreQuestionType,
  AssessmentType,
  QuestionType,
  SlotType,
} from '../../assessments/entities';
import { AssessmentResult } from '../../assessments/entities/assessment-result.entity';
import { VerifiedLevel } from '../../assessments/entities/assessment-question.entity';
import { AdvancedAssessmentService } from './advanced-assessment.service';
import { ErrorMessages } from '../../../shared';
import { NotificationType } from '../../notifications/notification-type.enum';
import { IntegrityEventType } from './dto/advanced-assessment.dto';
import { TalentProfile } from '../entities/talent-profile.entity';
import { makeTalentProfile } from './personal-assessment.test-fixtures';

// ── Helpers ───────────────────────────────────────────────────────────────────

const LT_ANSWER =
  'I would start by defining the business goal, the user need, and the operational constraint so the team is solving the right problem. ' +
  'Then I would compare options, identify the biggest uncertainty, and explain the tradeoffs clearly before deciding on a path. ' +
  'After execution, I would review the outcome against the original goal and document what I would change next time.';

const SHORT_ANSWER =
  'I would clarify the goal, align stakeholders on tradeoffs, and choose the next step using user evidence and measurable outcomes.';

function makeAttempt(
  overrides: Partial<AssessmentAttempt> = {},
): AssessmentAttempt {
  return Object.assign(new AssessmentAttempt(), {
    id: 'attempt-1',
    talent_profile_id: 'profile-1',
    assessment_type: AssessmentType.ADVANCED,
    started_at: new Date(),
    completed_at: null,
    expires_at: new Date(Date.now() + 25 * 60 * 1000),
    tab_switch_count: 0,
    copy_paste_count: 0,
    force_submitted: false,
    generated_questions_json: makeSessionJson(),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });
}

/**
 * 8 MCQ + 2 short text + 2 LT-1 (SITUATIONAL) + 3 LT-2 (WORK_TASK).
 */
function makeSessionJson() {
  const mcqQuestions = Array.from({ length: 8 }, (_, i) => ({
    question_id: `mcq-${i + 1}`,
    question_number: i + 1,
    block: 'mcq',
    question_type: QuestionType.SINGLE_PICK,
    question_text: `MCQ question ${i + 1}`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    slot_type: null,
    metadata: { competency: 'sql_queries' },
    correct_answer: i < 7 ? 'Option A' : 'Option B',
  }));

  const shortTextQuestions = Array.from({ length: 2 }, (_, i) => ({
    question_id: `short-${i + 1}`,
    question_number: 9 + i,
    block: 'short_text',
    question_type: QuestionType.REQUIRED_TEXT,
    question_text: `Short text question ${i + 1}`,
    options: null,
    slot_type: SlotType.SITUATIONAL,
    metadata: { competency: 'debugging' },
    correct_answer: null,
  }));

  const longTextSlots = [
    SlotType.SITUATIONAL, // LT-1 (a)
    SlotType.SITUATIONAL, // LT-1 (b)
    SlotType.WORK_TASK, // LT-2 (a)
    SlotType.WORK_TASK, // LT-2 (b)
    SlotType.WORK_TASK, // LT-2 (c)
  ];
  const longTextQuestions = longTextSlots.map((slot_type, i) => ({
    question_id: `long-${i + 1}`,
    question_number: 11 + i,
    block: 'long_text',
    question_type: QuestionType.OPTIONAL_TEXT,
    question_text: `Long text question ${i + 1} (${slot_type})`,
    options: null,
    slot_type,
    metadata: { competency: 'system_design' },
    correct_answer: null,
  }));

  return {
    context: { verified_level: VerifiedLevel.MID },
    questions: [...mcqQuestions, ...shortTextQuestions, ...longTextQuestions],
  };
}

function makeSubmitDto(overrides: Record<string, unknown> = {}) {
  const session = makeSessionJson();
  return {
    sessionId: 'attempt-1',
    answers: session.questions.map((q) => ({
      questionId: q.question_id,
      answer:
        q.block === 'mcq'
          ? 'Option A'
          : q.block === 'short_text'
            ? SHORT_ANSWER
            : LT_ANSWER,
      timeSpentSeconds: q.block === 'long_text' ? 30 : 10,
    })),
    ...overrides,
  };
}

function makeSubmitJobData(overrides: Record<string, unknown> = {}) {
  const dto = makeSubmitDto(overrides);
  return {
    userId: 'talent-user-1',
    sessionId: dto.sessionId,
    answers: dto.answers,
    ...overrides,
  };
}

/**
 * Returns 7 scored text answers in the canonical scoring shape:
 * 2 short (max 12) + 5 long (max 12) = 84 total max.
 * The caller distributes total raw across all answers proportionally.
 */
function makeScoredAnswers(rawTotal: number, maxTotal = 84) {
  // 6 full-rubric questions (max 12 each = 72) + 1 LT-3 (max 8) = 80
  const proportion = rawTotal / maxTotal;
  const result = [];

  for (let i = 0; i < 2; i++) {
    const raw = Math.round(12 * proportion);
    result.push({
      question_id: `short-${i + 1}`,
      rubric: {
        relevance: 2,
        reasoning: 2,
        specificity: 2,
        completeness: 2,
        total: raw,
        feedback: 'Good.',
      },
      raw_score: raw,
      max_score: 12,
    });
  }

  // LT-1 (a), LT-1 (b), LT-2 (a), LT-2 (b), LT-2 (c)
  for (let i = 0; i < 5; i++) {
    const raw = Math.round(12 * proportion);
    result.push({
      question_id: `long-${i + 1}`,
      rubric: {
        relevance: 2,
        reasoning: 2,
        specificity: 2,
        completeness: 2,
        total: raw,
        feedback: 'Good.',
      },
      raw_score: raw,
      max_score: 12,
    });
  }

  return result;
}

function makePerfectScoredAnswers() {
  return makeScoredAnswers(84, 84);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdvancedAssessmentService', () => {
  let service: AdvancedAssessmentService;

  let talentProfileRepo: {
    findOne: jest.Mock;
    update: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let questionRepo: {};
  let attemptRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    increment: jest.Mock;
    update: jest.Mock;
  };
  let resultRepo: { findOne: jest.Mock; update: jest.Mock };
  let personalAssessmentService: { getAiContext: jest.Mock };
  let advancedAssessmentAiService: { generateQuestions: jest.Mock };
  let rubricScoring: { scoreAnswers: jest.Mock };
  let guidanceReport: { generate: jest.Mock };
  let employerPoolProfileService: { upsert: jest.Mock };
  let questionGeneration: { generateQuestions?: jest.Mock };
  let usersService: { findOne: jest.Mock };
  let notificationDispatch: { dispatch: jest.Mock };
  let submitQueue: { enqueue: jest.Mock };
  let bankExhaustedAlert: { notify: jest.Mock };

  // Cross-test captures
  let entityManagerSaveCalls: Array<{ entity: unknown; data: unknown }>;
  let entityManagerFindOne: jest.Mock;
  let entityManagerIncrement: jest.Mock;
  let entityManagerUpdate: jest.Mock;

  const userId = 'talent-user-1';
  let profileStore = makeTalentProfile({
    validated_level: VerifiedLevel.MID,
    assessment_locked_until: null,
  });
  let attemptStore: AssessmentAttempt;
  let attemptData: { current: AssessmentAttempt };

  beforeEach(() => {
    profileStore = makeTalentProfile({
      validated_level: VerifiedLevel.MID,
      assessment_locked_until: null,
      personal_assessment_completed_at: new Date(),
      track: 'backend_developer',
    });
    attemptStore = makeAttempt();
    attemptData = { current: attemptStore };
    questionRepo = {};
    resultRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    questionGeneration = {};
    entityManagerSaveCalls = [];
    entityManagerFindOne = jest
      .fn()
      .mockImplementation((_entity: unknown) =>
        Promise.resolve(
          Object.assign(new AssessmentAttempt(), attemptData.current),
        ),
      );
    entityManagerIncrement = jest
      .fn()
      .mockImplementation(
        (
          _entity: unknown,
          _criteria: Record<string, unknown>,
          field: string,
          value: number,
        ) => {
          const current = attemptData.current;
          if (field === 'tab_switch_count') {
            current.tab_switch_count += value;
          } else if (field === 'copy_paste_count') {
            current.copy_paste_count += value;
          }
          return Promise.resolve({ affected: 1 });
        },
      );
    entityManagerUpdate = jest.fn().mockResolvedValue(undefined);

    attemptRepo = {
      findOne: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            Object.assign(new AssessmentAttempt(), attemptData.current),
          ),
        ),
      save: jest.fn().mockImplementation((attempt: AssessmentAttempt) => {
        attemptData.current = attempt;
        return Promise.resolve(attempt);
      }),
      increment: jest
        .fn()
        .mockImplementation(
          (
            _criteria: Record<string, unknown>,
            field: string,
            value: number,
          ) => {
            const current = attemptData.current;
            if (field === 'tab_switch_count') {
              current.tab_switch_count += value;
            } else if (field === 'copy_paste_count') {
              current.copy_paste_count += value;
            }
            return Promise.resolve({ affected: 1 });
          },
        ),
      update: jest
        .fn()
        .mockImplementation(
          (
            _criteria: Record<string, unknown>,
            patch: Partial<AssessmentAttempt>,
          ) => {
            Object.assign(attemptData.current, patch);
            return Promise.resolve({ affected: 1 });
          },
        ),
    };

    const entityManager = {
      findOne: entityManagerFindOne,
      find: jest.fn().mockResolvedValue([]),
      increment: entityManagerIncrement,
      count: jest.fn().mockResolvedValue(1),
      save: jest.fn().mockImplementation((entity: unknown, data: unknown) => {
        entityManagerSaveCalls.push({ entity, data });
        if (
          entity === AssessmentAttempt &&
          data &&
          typeof data === 'object' &&
          'generated_questions_json' in data
        ) {
          Object.assign(attemptData.current, data);
        }
        return Promise.resolve(data);
      }),
      create: jest
        .fn()
        .mockImplementation((_entity: unknown, data: unknown) => data),
      update: entityManagerUpdate,
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockReturnValue({
          into: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          orUpdate: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    talentProfileRepo = {
      findOne: jest.fn().mockResolvedValue(profileStore),
      update: jest.fn().mockResolvedValue(undefined),
      manager: {
        transaction: jest
          .fn()
          .mockImplementation(
            (work: (em: typeof entityManager) => Promise<unknown>) =>
              work(entityManager),
          ),
      },
    };

    personalAssessmentService = {
      getAiContext: jest.fn().mockResolvedValue({
        track: 'backend_developer',
        educationLevel: 'bachelor',
        region: 'Lagos',
        country: 'Nigeria',
        claimedLevel: VerifiedLevel.MID,
      }),
    };

    advancedAssessmentAiService = {
      generateQuestions: jest.fn().mockReturnValue(makeSessionJson()),
    };

    rubricScoring = {
      // 37/84 ≈ 44% raw text yield → still emerging band by default
      // max-total 84 = 2 short×12 + 5 long×12
      scoreAnswers: jest.fn().mockResolvedValue(makeScoredAnswers(37, 84)),
    };

    guidanceReport = {
      generate: jest.fn().mockImplementation((input) =>
        Promise.resolve({
          report_type: input.report_type,
          ai_summary:
            'You demonstrate practical problem solving and clear product intuition. Your growth opportunities currently lie in communication and systems thinking.',
          growth_insight:
            'Your recent assessments show steady progress in structured thinking. Focusing on communication and systems thinking could improve your professional readiness.',
          summary:
            input.report_type === 'job_ready'
              ? 'You showed job-ready strengths.'
              : 'Keep improving.',
          strength_ratings: [
            { item: 'Clear practical problem solving.', rating: 3 },
            { item: 'Good product intuition.', rating: 2 },
            { item: 'Structured answer flow.', rating: 2 },
          ],
          weak_area_ratings: [
            { item: 'Needs clearer communication.', rating: 2 },
            { item: 'Improve systems-level reasoning.', rating: 1 },
            { item: 'Build confidence under ambiguity.', rating: 1 },
          ],
          recommended_resources: [
            {
              title: 'MDN Docs',
              provider: 'MDN',
              url: 'https://developer.mozilla.org/',
              tier: 'free',
              competency: 'Communication',
              reason: 'Strengthens practical fundamentals.',
            },
          ],
          ...(input.report_type === 'emerging' && {
            retake_advice: 'Review fundamentals before the 14-day retake.',
          }),
          resource_page_url: '/resources',
        }),
      ),
    };

    employerPoolProfileService = {
      upsert: jest.fn().mockResolvedValue({}),
    };

    usersService = {
      findOne: jest.fn().mockResolvedValue({
        id: userId,
        email: 'talent@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
      }),
    };

    notificationDispatch = {
      dispatch: jest.fn().mockResolvedValue(undefined),
    };

    submitQueue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    bankExhaustedAlert = {
      notify: jest.fn(),
    };

    service = new AdvancedAssessmentService(
      talentProfileRepo as never,
      questionRepo as never,
      attemptRepo as never,
      resultRepo as never,
      personalAssessmentService as never,
      advancedAssessmentAiService as never,
      rubricScoring as never,
      guidanceReport as never,
      employerPoolProfileService as never,
      questionGeneration as never,
      usersService as never,
      notificationDispatch as never,
      submitQueue as never,
      bankExhaustedAlert as never,
    );
  });

  // ── submit (HTTP enqueue) ─────────────────────────────────────────────────

  describe('submit()', () => {
    it('returns processing status and enqueues without calling rubric scoring', async () => {
      const dto = makeSubmitDto();
      const result = await service.submit(userId, dto as never);

      expect(result).toEqual({
        status: 'processing',
        message: expect.any(String),
        session_id: 'attempt-1',
      });
      expect(submitQueue.enqueue).toHaveBeenCalledWith({
        userId,
        sessionId: 'attempt-1',
        answers: dto.answers,
      });
      expect(rubricScoring.scoreAnswers).not.toHaveBeenCalled();
      const attemptSave = entityManagerSaveCalls.find(
        (call) => call.entity === AssessmentAttempt,
      );
      expect(attemptSave?.data).toEqual(
        expect.objectContaining({
          generated_questions_json: expect.objectContaining({
            context: expect.objectContaining({
              submit_enqueued_at: expect.any(String),
            }),
          }),
        }),
      );
    });

    it('rejects with 409 when another advanced submission is still processing', async () => {
      const processingAttempt = makeAttempt({
        id: 'attempt-processing',
        generated_questions_json: {
          ...makeSessionJson(),
          context: {
            verified_level: VerifiedLevel.MID,
            submit_enqueued_at: new Date().toISOString(),
          },
        },
      });
      const txManager = {
        findOne: jest.fn().mockResolvedValue(makeAttempt()),
        find: jest.fn().mockResolvedValue([processingAttempt]),
        save: jest.fn(),
        update: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(processingAttempt),
        }),
      };
      talentProfileRepo.manager.transaction.mockImplementationOnce(
        (work: (em: typeof txManager) => Promise<unknown>) => work(txManager),
      );

      await expect(
        service.submit(userId, makeSubmitDto() as never),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'ADVANCED_SUBMIT_PROCESSING',
          session_id: 'attempt-processing',
        }),
      });
      expect(submitQueue.enqueue).not.toHaveBeenCalled();
    });

    it('clears submit_enqueued_at when enqueue fails', async () => {
      submitQueue.enqueue.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        service.submit(userId, makeSubmitDto() as never),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(attemptRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          generated_questions_json: expect.objectContaining({
            context: expect.not.objectContaining({
              submit_enqueued_at: expect.anything(),
            }),
          }),
        }),
      );
    });

    it('throws 403 with probation metadata when profile lock is active', async () => {
      const lockedFrom = new Date('2026-05-01T00:00:00.000Z');
      const lockedUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      talentProfileRepo.findOne.mockResolvedValue(
        makeTalentProfile({
          advanced_retake_required: true,
          assessment_locked_from: lockedFrom,
          assessment_locked_until: lockedUntil,
        }),
      );

      await expect(
        service.submit(userId, makeSubmitDto() as never),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'ADVANCED_RETAKE_LOCKED',
          probation_started_at: lockedFrom.toISOString(),
          probation_ends_at: lockedUntil.toISOString(),
          remaining_seconds: expect.any(Number),
        }),
      });
    });

    it('throws 404 when profile not found', async () => {
      talentProfileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submit(userId, makeSubmitDto() as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when attempt not found', async () => {
      attemptRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submit(userId, makeSubmitDto() as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 400 when attempt already submitted', async () => {
      attemptRepo.findOne.mockResolvedValue(
        makeAttempt({ completed_at: new Date() }),
      );

      await expect(
        service.submit(userId, makeSubmitDto() as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when session was voided', async () => {
      attemptRepo.findOne.mockResolvedValue(
        makeAttempt({ force_submitted: true }),
      );

      await expect(
        service.submit(userId, makeSubmitDto() as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 403 when session is expired', async () => {
      attemptRepo.findOne.mockResolvedValue(
        makeAttempt({ expires_at: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.submit(userId, makeSubmitDto() as never),
      ).rejects.toMatchObject({
        response: {
          error: 'SESSION_EXPIRED',
          message: ErrorMessages.ADVANCED_ASSESSMENT.SESSION_EXPIRED,
        },
      });
      expect(submitQueue.enqueue).not.toHaveBeenCalled();
    });

    it('throws 503 when enqueue fails', async () => {
      submitQueue.enqueue.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        service.submit(userId, makeSubmitDto() as never),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ── processSubmitJob (worker) ─────────────────────────────────────────────

  describe('processSubmitJob()', () => {
    it('is a no-op when attempt is already completed', async () => {
      attemptRepo.findOne.mockResolvedValue(
        makeAttempt({ completed_at: new Date() }),
      );

      await service.processSubmitJob(makeSubmitJobData() as never);

      expect(rubricScoring.scoreAnswers).not.toHaveBeenCalled();
    });

    it('re-dispatches score-ready notification on completed-attempt retry when result exists', async () => {
      attemptRepo.findOne.mockResolvedValue(
        makeAttempt({ completed_at: new Date() }),
      );
      resultRepo.findOne.mockResolvedValue(
        Object.assign(new AssessmentResult(), {
          id: 'result-1',
          attempt_id: 'attempt-1',
          score: 78,
          max_score: 100,
          percentage: 78,
          tier: AssessmentTier.JOB_READY,
          guidance_report: { report_type: 'job_ready' },
        }),
      );

      await service.processSubmitJob(makeSubmitJobData() as never);

      expect(rubricScoring.scoreAnswers).not.toHaveBeenCalled();
      expect(notificationDispatch.dispatch).toHaveBeenCalledWith(
        NotificationType.ADVANCED_ASSESSMENT_SCORE_READY,
        userId,
        {
          score: 78,
          maxScore: 100,
          percentage: 78,
          tier: AssessmentTier.JOB_READY,
        },
      );
    });

    it('scores with weighted max 100 and persists job_ready tier', async () => {
      rubricScoring.scoreAnswers.mockResolvedValue(makePerfectScoredAnswers());
      await service.processSubmitJob(makeSubmitJobData() as never);

      expect(guidanceReport.generate).toHaveBeenCalledWith(
        expect.objectContaining({ report_type: 'job_ready' }),
      );
      expect(resultRepo.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          guidance_report: expect.objectContaining({
            report_type: 'job_ready',
            ai_summary: expect.any(String),
            growth_insight: expect.any(String),
            resource_page_url: '/resources',
          }),
        }),
      );
      expect(employerPoolProfileService.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          competencyByQuestion: expect.any(Map),
        }),
      );
    });

    it('keeps tier emerging when text scores are high but all MCQs are wrong', async () => {
      rubricScoring.scoreAnswers.mockResolvedValue(makePerfectScoredAnswers());
      const dto = makeSubmitDto();
      dto.answers = dto.answers.map((answer) =>
        String(answer.questionId).startsWith('mcq-')
          ? { ...answer, answer: 'Option C' }
          : answer,
      );

      await service.processSubmitJob(
        makeSubmitJobData({ answers: dto.answers }) as never,
      );

      expect(employerPoolProfileService.upsert).not.toHaveBeenCalled();
      const resultSave = entityManagerSaveCalls.find(
        (call) => call.entity === AssessmentResult,
      );
      expect(resultSave).toBeDefined();
    });

    it('can still be job_ready with high text scores and at least 2 correct MCQs', async () => {
      // With 8 MCQs (30% weight): 1/8 correct = 73.75% total (below 75% threshold).
      // 2/8 correct = 77.5% total — clears the job_ready threshold with perfect text.
      rubricScoring.scoreAnswers.mockResolvedValue(makePerfectScoredAnswers());
      const dto = makeSubmitDto();
      const correctIds = new Set(['mcq-1', 'mcq-2']);
      dto.answers = dto.answers.map((answer) => {
        if (!String(answer.questionId).startsWith('mcq-')) return answer;
        return {
          ...answer,
          answer: correctIds.has(String(answer.questionId))
            ? 'Option A'
            : 'Option C',
        };
      });

      await service.processSubmitJob(
        makeSubmitJobData({ answers: dto.answers }) as never,
      );

      const resultSave = entityManagerSaveCalls.find(
        (call) => call.entity === AssessmentResult,
      );
      expect((resultSave?.data as { tier: AssessmentTier }).tier).toBe(
        AssessmentTier.JOB_READY,
      );
    });

    it('fails closed when the session has no MCQs', async () => {
      rubricScoring.scoreAnswers.mockResolvedValue(makePerfectScoredAnswers());
      const loggerErrorSpy = jest
        .spyOn(
          (
            service as unknown as {
              logger: { error: (...args: unknown[]) => void };
            }
          ).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      const sessionNoMcq = makeSessionJson();
      sessionNoMcq.questions = sessionNoMcq.questions.filter(
        (question) => question.block !== 'mcq',
      );
      attemptStore = makeAttempt({ generated_questions_json: sessionNoMcq });
      attemptRepo.findOne.mockResolvedValue(attemptStore);

      const dto = makeSubmitDto();
      dto.answers = dto.answers.filter(
        (answer) => !String(answer.questionId).startsWith('mcq-'),
      );

      await service.processSubmitJob(
        makeSubmitJobData({ answers: dto.answers }) as never,
      );

      const resultSave = entityManagerSaveCalls.find(
        (call) => call.entity === AssessmentResult,
      );
      expect((resultSave?.data as { tier: AssessmentTier }).tier).toBe(
        AssessmentTier.EMERGING,
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('MCQ gate failed'),
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`attempt=${attemptStore.id}`),
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`user=${userId}`),
      );
    });

    it('places tier at Emerging when pct < 75%', async () => {
      rubricScoring.scoreAnswers.mockResolvedValue(makeScoredAnswers(53, 84));
      await service.processSubmitJob(makeSubmitJobData() as never);

      const resultSave = entityManagerSaveCalls.find(
        (call) => call.entity === AssessmentResult,
      );
      expect((resultSave?.data as { tier: AssessmentTier }).tier).toBe(
        AssessmentTier.EMERGING,
      );
    });

    it('marks sub-50% as failed without profile completion or guidance report', async () => {
      rubricScoring.scoreAnswers.mockResolvedValue(makeScoredAnswers(0, 84));
      await service.processSubmitJob(
        makeSubmitJobData({ answers: [] }) as never,
      );

      const resultSave = entityManagerSaveCalls.find(
        (call) => call.entity === AssessmentResult,
      );
      expect((resultSave?.data as { tier: AssessmentTier }).tier).toBe(
        AssessmentTier.NOT_READY,
      );
      expect(guidanceReport.generate).not.toHaveBeenCalled();
      expect(entityManagerUpdate).not.toHaveBeenCalledWith(
        TalentProfile,
        { id: profileStore.id },
        expect.objectContaining({
          advanced_assessment_completed_at: expect.any(Date),
        }),
      );
      expect(notificationDispatch.dispatch).toHaveBeenCalledWith(
        NotificationType.ADVANCED_ASSESSMENT_SCORE_READY,
        userId,
        expect.objectContaining({ tier: AssessmentTier.NOT_READY }),
      );
    });

    it('writes one assessment_scores row per session question (15)', async () => {
      rubricScoring.scoreAnswers.mockResolvedValue(makePerfectScoredAnswers());
      await service.processSubmitJob(makeSubmitJobData() as never);

      const scoreSaveCall = entityManagerSaveCalls.find(
        (call) => call.entity === AssessmentScore,
      );
      expect(scoreSaveCall).toBeDefined();
      const rows = scoreSaveCall!.data as Array<{
        question_type: AssessmentScoreQuestionType;
        max_score: number;
      }>;
      expect(rows).toHaveLength(15);

      const mcqRows = rows.filter(
        (r) => r.question_type === AssessmentScoreQuestionType.MCQ,
      );
      const shortRows = rows.filter(
        (r) => r.question_type === AssessmentScoreQuestionType.SHORT_TEXT,
      );
      const longRows = rows.filter(
        (r) => r.question_type === AssessmentScoreQuestionType.LONG_TEXT,
      );
      expect(mcqRows).toHaveLength(8);
      expect(shortRows).toHaveLength(2);
      expect(longRows).toHaveLength(5);
    });

    it('sets retake gate (assessment_locked_until) when tier is not job_ready', async () => {
      rubricScoring.scoreAnswers.mockResolvedValue(makeScoredAnswers(55, 84));

      await service.processSubmitJob(makeSubmitJobData() as never);
      expect(entityManagerUpdate).toHaveBeenCalledWith(
        TalentProfile,
        { id: profileStore.id },
        expect.objectContaining({
          assessment_locked_from: expect.any(Date),
          assessment_locked_until: expect.any(Date),
          advanced_retake_required: true,
        }),
      );
      const [, , patch] = entityManagerUpdate.mock.calls.find(
        (call) => call[0] === TalentProfile,
      ) as [
        unknown,
        unknown,
        { assessment_locked_from: Date; assessment_locked_until: Date },
      ];
      expect(patch.assessment_locked_from.getTime()).toBeLessThanOrEqual(
        patch.assessment_locked_until.getTime(),
      );
      const diffDays = Math.round(
        (patch.assessment_locked_until.getTime() - Date.now()) /
          (1000 * 60 * 60 * 24),
      );
      expect(diffDays).toBe(14);
    });

    it('sets retake gate (assessment_locked_until) when tier is job_ready', async () => {
      rubricScoring.scoreAnswers.mockResolvedValue(makePerfectScoredAnswers());

      await service.processSubmitJob(makeSubmitJobData() as never);

      expect(entityManagerUpdate).toHaveBeenCalledWith(
        TalentProfile,
        { id: profileStore.id },
        expect.objectContaining({
          assessment_locked_from: expect.any(Date),
          assessment_locked_until: expect.any(Date),
          advanced_retake_required: true,
        }),
      );
    });

    it('still scores when session is expired', async () => {
      attemptRepo.findOne.mockResolvedValue(
        makeAttempt({ expires_at: new Date(Date.now() - 1000) }),
      );

      await service.processSubmitJob(makeSubmitJobData() as never);

      const resultSave = entityManagerSaveCalls.find(
        (call) => call.entity === AssessmentResult,
      );
      expect(resultSave).toBeDefined();
    });

    it('flags abnormal long-text timing and sets integrity_confidence to low', async () => {
      const dto = {
        sessionId: 'attempt-1',
        answers: makeSessionJson().questions.map((q) => ({
          questionId: q.question_id,
          answer:
            q.block === 'mcq'
              ? 'Option A'
              : q.block === 'short_text'
                ? SHORT_ANSWER
                : LT_ANSWER,
          timeSpentSeconds: q.block === 'long_text' ? 2 : 10,
        })),
      };

      await service.processSubmitJob(
        makeSubmitJobData({ answers: dto.answers }) as never,
      );

      const resultSave = entityManagerSaveCalls.find(
        (call) => call.entity === AssessmentResult,
      );
      expect(
        (resultSave?.data as { integrity_confidence: string })
          .integrity_confidence,
      ).toBe('low');
    });

    it('sets integrity_confidence medium when tab_switch_count > 0', async () => {
      attemptRepo.findOne.mockResolvedValue(
        makeAttempt({ tab_switch_count: 1 }),
      );

      await service.processSubmitJob(makeSubmitJobData() as never);

      const resultSave = entityManagerSaveCalls.find(
        (call) => call.entity === AssessmentResult,
      );
      expect(
        (resultSave?.data as { integrity_confidence: string })
          .integrity_confidence,
      ).toBe('medium');
    });

    it('sets integrity_confidence medium when copy_paste_count > 0', async () => {
      attemptRepo.findOne.mockResolvedValue(
        makeAttempt({ copy_paste_count: 1 }),
      );

      await service.processSubmitJob(makeSubmitJobData() as never);

      const resultSave = entityManagerSaveCalls.find(
        (call) => call.entity === AssessmentResult,
      );
      expect(
        (resultSave?.data as { integrity_confidence: string })
          .integrity_confidence,
      ).toBe('medium');
    });

    describe('tier boundary cases', () => {
      it('49% → Not Ready', async () => {
        rubricScoring.scoreAnswers.mockResolvedValue(makeScoredAnswers(40, 84));
        await service.processSubmitJob(
          makeSubmitJobData({ answers: [] }) as never,
        );
        const resultSave = entityManagerSaveCalls.find(
          (call) => call.entity === AssessmentResult,
        );
        expect((resultSave?.data as { tier: AssessmentTier }).tier).toBe(
          AssessmentTier.NOT_READY,
        );
      });

      it('75% → Job Ready', async () => {
        rubricScoring.scoreAnswers.mockResolvedValue(
          makePerfectScoredAnswers(),
        );
        await service.processSubmitJob(makeSubmitJobData() as never);
        const resultSave = entityManagerSaveCalls.find(
          (call) => call.entity === AssessmentResult,
        );
        expect((resultSave?.data as { tier: AssessmentTier }).tier).toBe(
          AssessmentTier.JOB_READY,
        );
      });
    });
  });

  // ── getSession ──────────────────────────────────────────────────────────────

  describe('getSession()', () => {
    it('returns pending_lt3: false and correct question_count', async () => {
      const session = await service.getSession(userId, 'attempt-1');

      expect(session.question_count).toBe(15);
      expect(session.mcq_count).toBe(8);
      expect(session.open_text_count).toBe(7);
      expect(session.pending_lt3).toBe(false);
    });

    it('returns remaining_seconds 0 when submit is queued but scoring is pending', async () => {
      attemptRepo.findOne.mockResolvedValue(
        makeAttempt({
          generated_questions_json: {
            ...makeSessionJson(),
            context: {
              verified_level: VerifiedLevel.MID,
              submit_enqueued_at: new Date().toISOString(),
            },
          },
        }),
      );

      const result = await service.getSession(userId, 'attempt-1');

      expect(result.remaining_seconds).toBe(0);
      expect(result.is_expired).toBe(false);
      expect(result.completed_at).toBeNull();
    });

    it('returns remaining_seconds 0 and is_expired true when attempt is completed', async () => {
      attemptRepo.findOne.mockResolvedValue(
        makeAttempt({
          completed_at: new Date('2026-05-01T12:00:00.000Z'),
        }),
      );

      const result = await service.getSession(userId, 'attempt-1');

      expect(result.remaining_seconds).toBe(0);
      expect(result.is_expired).toBe(true);
      expect(result.completed_at).toBe('2026-05-01T12:00:00.000Z');
    });

    it('throws 403 with probation metadata when profile lock is active', async () => {
      const lockedFrom = new Date('2026-05-01T00:00:00.000Z');
      const lockedUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      talentProfileRepo.findOne.mockResolvedValue(
        makeTalentProfile({
          advanced_retake_required: true,
          assessment_locked_from: lockedFrom,
          assessment_locked_until: lockedUntil,
        }),
      );

      await expect(
        service.getSession(userId, 'attempt-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'ADVANCED_RETAKE_LOCKED',
          probation_started_at: lockedFrom.toISOString(),
          probation_ends_at: lockedUntil.toISOString(),
        }),
      });
    });
  });

  // ── flag ────────────────────────────────────────────────────────────────────

  describe('releaseFailedSubmit()', () => {
    it('releases the retake lock when scoring failed for good', async () => {
      attemptData.current.completed_at = null;

      await service.releaseFailedSubmit(userId, 'attempt-1');

      expect(talentProfileRepo.update).toHaveBeenCalledWith(
        { id: profileStore.id },
        {
          assessment_locked_from: null,
          assessment_locked_until: null,
          advanced_retake_required: false,
        },
      );
    });

    it('restores a retake requirement that existed before the submit', async () => {
      attemptData.current.completed_at = null;
      attemptData.current.generated_questions_json = {
        context: {
          submit_enqueued_at: '2026-10-01T00:00:00.000Z',
          pre_submit_lock: {
            locked_from: '2026-09-01T00:00:00.000Z',
            locked_until: '2026-09-15T00:00:00.000Z',
            retake_required: true,
          },
        },
        questions: [],
      };

      await service.releaseFailedSubmit(userId, 'attempt-1');

      expect(talentProfileRepo.update).toHaveBeenCalledWith(
        { id: profileStore.id },
        {
          assessment_locked_from: new Date('2026-09-01T00:00:00.000Z'),
          assessment_locked_until: new Date('2026-09-15T00:00:00.000Z'),
          advanced_retake_required: true,
        },
      );
    });

    it('leaves the lock alone once the attempt has been scored', async () => {
      attemptData.current.completed_at = new Date();

      await service.releaseFailedSubmit(userId, 'attempt-1');

      expect(talentProfileRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('flag()', () => {
    it('records a violation without ending the session while under the limit', async () => {
      const result = await service.flag(userId, 'attempt-1', {
        eventType: IntegrityEventType.TAB_SWITCH,
      });

      expect(result.status).toBe('recorded');
      expect(result.action).toBe('warn');
      expect(result.sessionVoided).toBe(false);
      expect(result.tabSwitchCount).toBe(1);
      expect(entityManagerUpdate).not.toHaveBeenCalled();
    });

    it('voids session and returns logout action on the third tab switch', async () => {
      attemptData.current.tab_switch_count = 2;
      const result = await service.flag(userId, 'attempt-1', {
        eventType: IntegrityEventType.TAB_SWITCH,
      });

      expect(result.status).toBe('voided');
      expect(result.action).toBe('logout');
      expect(result.sessionVoided).toBe(true);
      expect(result.tabSwitchCount).toBe(3);
      expect(talentProfileRepo.manager.transaction).toHaveBeenCalled();
      expect(entityManagerFindOne).toHaveBeenCalledWith(
        AssessmentAttempt,
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(entityManagerIncrement).toHaveBeenCalledWith(
        AssessmentAttempt,
        expect.anything(),
        'tab_switch_count',
        1,
      );
      expect(entityManagerUpdate).toHaveBeenCalledWith(
        AssessmentAttempt,
        expect.anything(),
        expect.objectContaining({ force_submitted: true }),
      );
      expect(entityManagerUpdate).toHaveBeenCalledWith(
        TalentProfile,
        { id: profileStore.id },
        expect.objectContaining({
          assessment_locked_from: expect.any(Date),
          assessment_locked_until: expect.any(Date),
          advanced_retake_required: true,
        }),
      );
    });

    it('sets 14-day retake gate when session is voided', async () => {
      attemptData.current.tab_switch_count = 2;
      await service.flag(userId, 'attempt-1', {
        eventType: IntegrityEventType.TAB_SWITCH,
      });

      const profileUpdate = entityManagerUpdate.mock.calls.find(
        ([entity]) => entity === TalentProfile,
      ) as [
        unknown,
        unknown,
        { assessment_locked_from: Date; assessment_locked_until: Date },
      ];
      const [, , patch] = profileUpdate;
      const gateDate = patch.assessment_locked_until;
      expect(patch.assessment_locked_from).toBeInstanceOf(Date);
      const diffDays = Math.round(
        (gateDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      expect(diffDays).toBe(14);
    });

    it('increments copy_paste_count on COPY_PASTE and voids session at the limit', async () => {
      attemptData.current.copy_paste_count = 2;
      const result = await service.flag(userId, 'attempt-1', {
        eventType: IntegrityEventType.COPY_PASTE,
      });

      expect(result.status).toBe('voided');
      expect(result.action).toBe('logout');
      expect(result.sessionVoided).toBe(true);
      expect(result.copyPasteCount).toBe(3);
      expect(entityManagerIncrement).toHaveBeenCalledWith(
        AssessmentAttempt,
        expect.anything(),
        'copy_paste_count',
        1,
      );
    });

    it('throws 404 when profile not found', async () => {
      talentProfileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.flag(userId, 'attempt-1', {
          eventType: IntegrityEventType.TAB_SWITCH,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when attempt not found', async () => {
      entityManagerFindOne.mockResolvedValueOnce(null);

      await expect(
        service.flag(userId, 'attempt-1', {
          eventType: IntegrityEventType.TAB_SWITCH,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 400 when attempting to flag a completed session', async () => {
      entityManagerFindOne.mockResolvedValueOnce(
        makeAttempt({ completed_at: new Date() }),
      );

      await expect(
        service.flag(userId, 'attempt-1', {
          eventType: IntegrityEventType.TAB_SWITCH,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 403 when attempting to flag an expired session', async () => {
      entityManagerFindOne.mockResolvedValueOnce(
        makeAttempt({ expires_at: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.flag(userId, 'attempt-1', {
          eventType: IntegrityEventType.TAB_SWITCH,
        }),
      ).rejects.toMatchObject({
        response: {
          error: 'SESSION_EXPIRED',
          message: ErrorMessages.ADVANCED_ASSESSMENT.SESSION_EXPIRED,
        },
      });
      expect(entityManagerIncrement).not.toHaveBeenCalled();
    });
  });

  // ── question composition constants ──────────────────────────────────────────

  describe('question composition constants', () => {
    it('MCQ count is 8 (spec requirement)', () => {
      // Regression guard: the spec mandates 8 MCQ / 2 short-text / 5 long-text.
      // Previously the constants were 5 / 5, causing wrong composition.
      const {
        ADVANCED_ASSESSMENT_MCQ_COUNT,
      } = require('./advanced-assessment-ai.service');
      expect(ADVANCED_ASSESSMENT_MCQ_COUNT).toBe(8);
    });

    it('short-text count is 2 (spec requirement)', () => {
      const {
        ADVANCED_ASSESSMENT_SHORT_TEXT_COUNT,
      } = require('./advanced-assessment-ai.service');
      expect(ADVANCED_ASSESSMENT_SHORT_TEXT_COUNT).toBe(2);
    });

    it('base questions total is 15 (8 MCQ + 2 short + 5 long)', () => {
      const {
        ADVANCED_ASSESSMENT_BASE_QUESTIONS,
      } = require('./advanced-assessment-ai.service');
      expect(ADVANCED_ASSESSMENT_BASE_QUESTIONS).toBe(15);
    });
  });

  describe('findEligibleQuestions()', () => {
    it('supplements live questions with generated questions instead of falling back only when live is empty', async () => {
      const profile = makeTalentProfile({
        id: 'profile-1',
        track: 'backend_developer',
        validated_level: VerifiedLevel.MID,
      });

      const liveQuestions = [
        { id: 'live-1', is_live: true },
        { id: 'live-2', is_live: true },
      ] as AssessmentQuestion[];
      const generatedQuestions = [
        { id: 'generated-1', is_live: false },
      ] as AssessmentQuestion[];

      const liveQuery = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(liveQuestions),
      };
      const generatedQuery = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(generatedQuestions),
      };
      const manager = {
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(liveQuery)
          .mockReturnValueOnce(generatedQuery),
      };

      const result = await (service as any).findEligibleQuestions(
        manager,
        profile,
      );

      expect(result).toEqual([...liveQuestions, ...generatedQuestions]);
      expect(manager.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('only excludes questions from completed or force-submitted attempts', async () => {
      const profile = makeTalentProfile({
        id: 'profile-1',
        track: 'backend_developer',
        validated_level: VerifiedLevel.MID,
      });

      const liveQuery = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      const generatedQuery = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      const manager = {
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(liveQuery)
          .mockReturnValueOnce(generatedQuery),
      };

      await (service as any).findEligibleQuestions(manager, profile);

      const exclusionClause = liveQuery.andWhere.mock.calls.find(
        ([sql]: [string]) => sql.includes('talent_question_history'),
      )?.[0];

      expect(exclusionClause).toContain('attempt.completed_at IS NOT NULL');
      expect(exclusionClause).toContain('attempt.force_submitted = true');
    });
  });

  // ── start — retake gate ─────────────────────────────────────────────────────

  describe('start() retake gate', () => {
    it('throws 409 when a previous advanced submission is still processing', async () => {
      const processingAttempt = makeAttempt({
        id: 'attempt-processing',
        expires_at: new Date(Date.now() - 1000),
        generated_questions_json: {
          ...makeSessionJson(),
          context: {
            verified_level: VerifiedLevel.MID,
            submit_enqueued_at: new Date().toISOString(),
          },
        },
      });
      const profile = makeTalentProfile({
        validated_level: VerifiedLevel.MID,
        personal_assessment_completed_at: new Date(),
        skill_assessment_completed_at: new Date('2026-05-02T00:00:00.000Z'),
        assessment_locked_until: null,
      });

      const skillResultQuery = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          percentage: 80,
          claimed_percentage: 80,
          validated_level: VerifiedLevel.MID,
        } as AssessmentResult),
      };

      const activeSessionQuery = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };

      const entityManager = {
        findOne: jest.fn().mockResolvedValue(profile),
        count: jest.fn().mockResolvedValue(1),
        find: jest.fn().mockResolvedValue([processingAttempt]),
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(skillResultQuery)
          .mockReturnValueOnce({
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(processingAttempt),
          }),
      };

      talentProfileRepo.manager.transaction.mockImplementationOnce(
        (work: (em: typeof entityManager) => Promise<unknown>) =>
          work(entityManager),
      );

      await expect(service.start(userId)).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'ADVANCED_SUBMIT_PROCESSING',
          session_id: 'attempt-processing',
        }),
      });
    });

    it('throws 403 when assessment_locked_until is in the future', async () => {
      const lockedFrom = new Date('2026-05-01T00:00:00.000Z');
      const lockedUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const lockedProfile = makeTalentProfile({
        validated_level: VerifiedLevel.MID,
        personal_assessment_completed_at: new Date(),
        skill_assessment_completed_at: new Date('2026-05-02T00:00:00.000Z'),
        advanced_retake_required: true,
        assessment_locked_from: lockedFrom,
        assessment_locked_until: lockedUntil,
      });

      const skillResultQuery = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          percentage: 80,
          claimed_percentage: 80,
          validated_level: VerifiedLevel.MID,
        } as AssessmentResult),
      };

      const lockedEntityManager = {
        findOne: jest.fn().mockResolvedValue(lockedProfile),
        find: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
        createQueryBuilder: jest.fn().mockReturnValue(skillResultQuery),
      };

      talentProfileRepo.manager.transaction.mockImplementation(
        (work: (em: typeof lockedEntityManager) => Promise<unknown>) =>
          work(lockedEntityManager),
      );

      await expect(service.start(userId)).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'ADVANCED_RETAKE_LOCKED',
          probation_started_at: lockedFrom.toISOString(),
          probation_ends_at: lockedUntil.toISOString(),
          remaining_seconds: expect.any(Number),
        }),
      });
    });

    it('throws 422 when no skill assessment attempt has been completed', async () => {
      const profile = makeTalentProfile({
        validated_level: VerifiedLevel.MID,
        personal_assessment_completed_at: new Date(),
      });

      const entityManager = {
        findOne: jest.fn().mockResolvedValue(profile),
        find: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        createQueryBuilder: jest.fn(),
      };

      talentProfileRepo.manager.transaction.mockImplementation(
        (work: (em: typeof entityManager) => Promise<unknown>) =>
          work(entityManager),
      );

      await expect(service.start(userId)).rejects.toMatchObject({
        response: expect.objectContaining({
          message: ErrorMessages.ADVANCED_ASSESSMENT.SKILL_GATE_REQUIRED,
        }),
      });
    });

    it('allows legacy profiles without personal_assessment_completed_at once skill validation exists', async () => {
      const legacyProfile = makeTalentProfile({
        validated_level: VerifiedLevel.MID,
        claimed_level: null,
        personal_assessment_completed_at: null,
        skill_assessment_completed_at: new Date('2026-05-02T00:00:00.000Z'),
        track: 'frontend_developer',
        assessment_locked_until: null,
      });

      jest
        .spyOn(service as any, 'findEligibleQuestions')
        .mockResolvedValue([] as any);
      jest.spyOn(service as any, 'selectQuestionBlocks').mockResolvedValue({
        mcq: [] as any,
        shortText: [] as any,
        longText: [] as any,
      });

      const skillResultQuery = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          percentage: 80,
          claimed_percentage: 80,
          validated_level: VerifiedLevel.MID,
        } as AssessmentResult),
      };

      const activeSessionQuery = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };

      talentProfileRepo.manager.transaction.mockImplementationOnce(
        async (work: (em: Record<string, jest.Mock>) => Promise<unknown>) =>
          work({
            findOne: jest.fn().mockResolvedValue(legacyProfile),
            count: jest.fn().mockResolvedValue(1),
            find: jest.fn().mockResolvedValue([]),
            createQueryBuilder: jest
              .fn()
              .mockReturnValueOnce(skillResultQuery)
              .mockReturnValueOnce({
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(null),
              })
              .mockReturnValueOnce(activeSessionQuery)
              .mockReturnValue({
                insert: jest.fn().mockReturnValue({
                  into: jest.fn().mockReturnThis(),
                  values: jest.fn().mockReturnThis(),
                  orUpdate: jest.fn().mockReturnThis(),
                  execute: jest.fn().mockResolvedValue(undefined),
                }),
              }),
            create: jest.fn((_entity: unknown, data: unknown) => data),
            save: jest
              .fn()
              .mockImplementation(async (_entity, data) =>
                Object.assign(makeAttempt(), data, { id: 'attempt-legacy-1' }),
              ),
          }),
      );

      const result = await service.start(userId);

      expect(result.session_id).toBe('attempt-legacy-1');
      expect(result.verified_level).toBe(VerifiedLevel.MID);
      expect(result.question_count).toBe(15);
      expect(result.mcq_count).toBe(8);
      expect(result.open_text_count).toBe(7);
    });

    it('throws 422 when validated_level is missing', async () => {
      const unverifiedProfile = makeTalentProfile({
        validated_level: null,
        personal_assessment_completed_at: new Date(),
      });

      const unverifiedManager = {
        findOne: jest.fn().mockResolvedValue(unverifiedProfile),
        createQueryBuilder: jest.fn(),
      };

      talentProfileRepo.manager.transaction.mockImplementation(
        (work: (em: typeof unverifiedManager) => Promise<unknown>) =>
          work(unverifiedManager),
      );

      await expect(service.start(userId)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'LEVEL_NOT_VERIFIED' }),
      });
    });

    it('throws 422 when the latest skill result has no validated level', async () => {
      const profile = makeTalentProfile({
        validated_level: VerifiedLevel.MID,
        personal_assessment_completed_at: new Date(),
        skill_assessment_completed_at: new Date('2026-05-02T00:00:00.000Z'),
        assessment_locked_until: null,
      });

      const makeQuery = (overrides: Record<string, jest.Mock> = {}) => {
        const query: Record<string, jest.Mock> = {
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          addOrderBy: jest.fn().mockReturnThis(),
          ...overrides,
        };
        for (const key of Object.keys(query)) {
          if (!overrides[key]) {
            query[key].mockReturnValue(query);
          }
        }
        return query;
      };

      const entityManager = {
        findOne: jest.fn().mockResolvedValue(profile),
        find: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
        create: jest
          .fn()
          .mockImplementation((_entity: unknown, data: unknown) => data),
        save: jest.fn().mockResolvedValue([]),
        createQueryBuilder: jest.fn(),
      };

      const skillQuery = makeQuery({
        getOne: jest.fn().mockResolvedValue({
          percentage: 60,
          claimed_percentage: 65,
          validated_level: null,
        }),
      });
      entityManager.createQueryBuilder.mockReturnValue(skillQuery);

      talentProfileRepo.manager.transaction.mockImplementation(
        (work: (em: typeof entityManager) => Promise<unknown>) =>
          work(entityManager),
      );

      await expect(service.start(userId)).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'SKILL_PASS_REQUIRED',
          message: ErrorMessages.SKILL_ASSESSMENT.PASS_REQUIRED,
        }),
      });
    });

    it('throws 503 BANK_EXHAUSTED when fewer than the required base questions can be assembled', async () => {
      const profile = makeTalentProfile({
        validated_level: VerifiedLevel.MID,
        personal_assessment_completed_at: new Date(),
        skill_assessment_completed_at: new Date('2026-05-02T00:00:00.000Z'),
        assessment_locked_until: null,
      });

      const makeQuery = (overrides: Record<string, jest.Mock> = {}) => {
        const query: Record<string, jest.Mock> = {
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          addOrderBy: jest.fn().mockReturnThis(),
          ...overrides,
        };
        for (const key of Object.keys(query)) {
          if (!overrides[key]) {
            query[key].mockReturnValue(query);
          }
        }
        return query;
      };

      const entityManager = {
        findOne: jest.fn().mockResolvedValue(profile),
        find: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
        create: jest
          .fn()
          .mockImplementation((_entity: unknown, data: unknown) => data),
        save: jest.fn().mockResolvedValue([]),
        createQueryBuilder: jest.fn(),
      };

      const skillQuery = makeQuery({
        getOne: jest.fn().mockResolvedValue({
          percentage: 80,
          claimed_percentage: 80,
          validated_level: VerifiedLevel.MID,
        }),
      });
      const activeAttemptQuery = makeQuery({
        getOne: jest.fn().mockResolvedValue(null),
      });
      const questionQuery = makeQuery({
        getMany: jest.fn().mockResolvedValue([]),
        getRawOne: jest.fn().mockResolvedValue({ max: '30' }),
      });
      entityManager.createQueryBuilder.mockImplementation((entity) => {
        if (entity === AssessmentResult) return skillQuery;
        if (entity === AssessmentAttempt) return activeAttemptQuery;
        return questionQuery;
      });

      questionGeneration.generateQuestions = jest.fn().mockResolvedValue([]);
      advancedAssessmentAiService.generateQuestions.mockReturnValue({
        context: { verified_level: VerifiedLevel.MID },
        questions: makeSessionJson().questions.slice(0, 10),
      });

      talentProfileRepo.manager.transaction.mockImplementation(
        (work: (em: typeof entityManager) => Promise<unknown>) =>
          work(entityManager),
      );

      await expect(service.start(userId)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(bankExhaustedAlert.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentType: 'advanced',
          expectedQuestions: 15,
          gotQuestions: 10,
        }),
      );
    });
  });
});
