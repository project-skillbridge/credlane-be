import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AssessmentAttempt,
  AssessmentQuestion,
  AssessmentResponse,
  AssessmentResult,
  AssessmentType,
  QuestionType,
  TalentQuestionHistory,
  VerifiedLevel,
} from '../../assessments/entities';
import { TalentProfile } from '../entities/talent-profile.entity';
import { ErrorMessages } from '../../../shared';
import {
  SKILL_ASSESSMENT_MAX_ATTEMPTS,
  SKILL_ASSESSMENT_SESSION_TIMEOUT_MS,
} from '../talent.constants';
import { SkillAssessmentService } from './skill-assessment.service';
import { SkillGuidanceReportQueueService } from './skill-guidance-report-queue.service';
import { makeTalentProfile } from './personal-assessment.test-fixtures';
import { IntegrityEventType } from './dto/integrity-event.dto';

describe('SkillAssessmentService', () => {
  let service: SkillAssessmentService;

  let talentProfileRepo: {
    findOne: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let attemptRepo: {
    count: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let questionRepo: Record<string, jest.Mock>;

  let guidanceReportQueue: Pick<SkillGuidanceReportQueueService, 'enqueue'>;
  let notificationDispatch: {
    notifySkillAssessmentPassed: jest.Mock;
    notifySkillAssessmentFailed: jest.Mock;
  };
  let bankExhaustedAlert: { notify: jest.Mock };
  let waitlist: { join: jest.Mock; isWaitlisted: jest.Mock };
  let eligibleSkillQuestions: AssessmentQuestion[];
  let warmCacheMock: jest.Mock;

  const userId = 'talent-user-1';
  let profile = makeTalentProfile({
    personal_assessment_completed_at: new Date(),
    claimed_level: 'mid' as never,
    track: 'frontend_developer',
    advanced_assessment_completed_at: null,
  });

  const insertBuilder = {
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orUpdate: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };

  function mockTransaction(probeQuestions: AssessmentQuestion[] = []) {
    let eligibleQueryCount = 0;
    talentProfileRepo.manager.transaction.mockImplementation(
      async (work: (manager: EntityManagerLike) => Promise<unknown>) => {
        const manager: EntityManagerLike = {
          findOne: jest.fn().mockResolvedValue(profile),
          getRepository: jest.fn(() => attemptRepo),
          createQueryBuilder: jest.fn(() => ({
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockImplementation(() => {
              eligibleQueryCount += 1;
              if (eligibleQueryCount === 1) {
                return eligibleSkillQuestions;
              }
              return probeQuestions;
            }),
            insert: jest.fn(() => insertBuilder),
          })),
          create: jest.fn(
            (
              _entity: typeof AssessmentAttempt | typeof AssessmentResult,
              data: Partial<AssessmentAttempt | AssessmentResult>,
            ) => attemptRepo.create(data),
          ),
          save: jest.fn(
            (
              _entity:
                | typeof AssessmentAttempt
                | typeof AssessmentResponse
                | typeof TalentQuestionHistory
                | typeof AssessmentResult,
              data: AssessmentAttempt | unknown[],
            ) => attemptRepo.save(data),
          ),
          update: jest.fn(),
        };
        return work(manager);
      },
    );
  }

  beforeEach(() => {
    profile = makeTalentProfile({
      personal_assessment_completed_at: new Date(),
      claimed_level: 'mid' as never,
      track: 'frontend_developer',
      advanced_assessment_completed_at: null,
    });

    attemptRepo = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => Object.assign(new AssessmentAttempt(), data)),
      save: jest.fn(async (data) =>
        Object.assign(new AssessmentAttempt(), data, { id: 'attempt-1' }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
    };

    questionRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
      findBy: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ max: '0' }),
      })),
    };
    eligibleSkillQuestions = makeSkillBankQuestions();

    talentProfileRepo = {
      findOne: jest.fn().mockResolvedValue(profile),
      manager: { transaction: jest.fn() },
    };

    mockTransaction(makeProbeQuestions());

    bankExhaustedAlert = { notify: jest.fn() };
    waitlist = {
      join: jest.fn().mockResolvedValue(undefined),
      isWaitlisted: jest.fn().mockResolvedValue(false),
    };

    warmCacheMock = jest.fn().mockResolvedValue(undefined);

    guidanceReportQueue = { enqueue: jest.fn() };
    notificationDispatch = {
      notifySkillAssessmentPassed: jest.fn().mockResolvedValue(undefined),
      notifySkillAssessmentFailed: jest.fn().mockResolvedValue(undefined),
    };

    service = new SkillAssessmentService(
      talentProfileRepo as never,
      questionRepo as never,
      attemptRepo as never,
      {} as never,
      {} as never,
      {} as never,
      { generate: jest.fn() } as never,
      bankExhaustedAlert as never,
      { warmCache: warmCacheMock } as never,
      guidanceReportQueue as never,
      waitlist as never,
      {
        issueForSkillPass: jest.fn().mockResolvedValue({ code: 'CERT123' }),
      } as never,
      notificationDispatch as never,
    );
  });

  it(`blocks start when ${SKILL_ASSESSMENT_MAX_ATTEMPTS} skill attempts are already completed`, async () => {
    attemptRepo.count.mockResolvedValue(SKILL_ASSESSMENT_MAX_ATTEMPTS);
    const startPromise = service.start(userId);

    await expect(startPromise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(startPromise).rejects.toMatchObject({
      response: {
        error: 'SKILL_MAX_ATTEMPTS_REACHED',
        message: ErrorMessages.SKILL_ASSESSMENT.MAX_ATTEMPTS_REACHED,
        attempts_used: SKILL_ASSESSMENT_MAX_ATTEMPTS,
        max_attempts: SKILL_ASSESSMENT_MAX_ATTEMPTS,
        unlock_condition: 'complete_advanced_assessment',
      },
    });
    expect(attemptRepo.save).not.toHaveBeenCalled();
  });

  it('blocks start when an active skill session already exists under lock', async () => {
    attemptRepo.count.mockResolvedValue(2);
    attemptRepo.findOne.mockResolvedValue(
      Object.assign(new AssessmentAttempt(), { id: 'active-attempt' }),
    );

    await expect(service.start(userId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.start(userId)).rejects.toMatchObject({
      response: expect.objectContaining({
        existing_session_id: 'active-attempt',
      }),
    });
    expect(attemptRepo.save).not.toHaveBeenCalled();
  });

  it('auto-abandons a stale session and allows a new start', async () => {
    const staleStartedAt = new Date(
      Date.now() - SKILL_ASSESSMENT_SESSION_TIMEOUT_MS - 1000,
    );
    attemptRepo.count.mockResolvedValue(0);
    attemptRepo.findOne.mockResolvedValue(
      Object.assign(new AssessmentAttempt(), {
        id: 'stale-attempt',
        started_at: staleStartedAt,
      }),
    );

    const result = await service.start(userId);

    expect(attemptRepo.update).toHaveBeenCalledWith('stale-attempt', {
      completed_at: expect.any(Date),
      force_submitted: true,
    });
    expect(result.session_id).toBe('attempt-1');
  });

  it('blocks start when stale session pushes completed count to max', async () => {
    const staleStartedAt = new Date(
      Date.now() - SKILL_ASSESSMENT_SESSION_TIMEOUT_MS - 1000,
    );
    // First call (initial count): 2 completed. Second call (after abandon): 3 completed.
    attemptRepo.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(SKILL_ASSESSMENT_MAX_ATTEMPTS);
    attemptRepo.findOne.mockResolvedValue(
      Object.assign(new AssessmentAttempt(), {
        id: 'stale-attempt',
        started_at: staleStartedAt,
      }),
    );

    const startPromise = service.start(userId);

    await expect(startPromise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(startPromise).rejects.toMatchObject({
      response: {
        error: 'SKILL_MAX_ATTEMPTS_REACHED',
        message: ErrorMessages.SKILL_ASSESSMENT.MAX_ATTEMPTS_REACHED,
        attempts_used: SKILL_ASSESSMENT_MAX_ATTEMPTS,
        max_attempts: SKILL_ASSESSMENT_MAX_ATTEMPTS,
        unlock_condition: 'complete_advanced_assessment',
      },
    });
    expect(attemptRepo.update).toHaveBeenCalledWith('stale-attempt', {
      completed_at: expect.any(Date),
      force_submitted: true,
    });
    expect(attemptRepo.save).not.toHaveBeenCalled();
  });

  it('returns session_id and attempt_number when starting a skill assessment', async () => {
    const result = await service.start(userId);

    expect(result.session_id).toBe('attempt-1');
    expect(result.attempt_number).toBe(1);
    expect(result).not.toHaveProperty('attempt_id');
    expect(result.questions).toHaveLength(20);
    expect(result.questions[0].block).toBe('mcq');
    expect(result.questions[19].block).toBe('mcq');
    expect(attemptRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        generated_questions_json: expect.objectContaining({
          context: expect.objectContaining({
            attempt_number: 1,
          }),
        }),
      }),
    );
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          question_id: 'skill-mcq-1',
          user_answer: { served: true },
        }),
      ]),
    );
  });

  it('gives a new skill session a 30-minute server-side deadline', async () => {
    const before = Date.now();
    const result = await service.start(userId);

    const expiresAt = new Date(result.expires_at as string).getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(30 * 60 * 1000 - 1000);
    expect(expiresAt - before).toBeLessThanOrEqual(30 * 60 * 1000 + 5000);
    expect(result.remaining_seconds).toBeGreaterThan(29 * 60);
    expect(attemptRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ expires_at: expect.any(Date) }),
    );
  });

  describe('time limit', () => {
    const timedAttempt = (expiresAt: Date | null) =>
      Object.assign(new AssessmentAttempt(), {
        id: 'attempt-1',
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.SKILL,
        started_at: new Date(Date.now() - 31 * 60 * 1000),
        completed_at: null,
        expires_at: expiresAt,
        generated_questions_json: {
          context: { verified_level: VerifiedLevel.MID },
          questions: [
            {
              question_id: 'question-1',
              question_number: 1,
              question_type: QuestionType.SINGLE_PICK,
              question_text: 'Which metric best indicates activation?',
              options: ['Signups', 'First key action', 'Page views'],
              correct_answer: 'First key action',
            },
          ],
        },
      });

    const answers = [{ questionId: 'question-1', answer: 'First key action' }];

    it('reports the remaining seconds when a timed session is resumed', async () => {
      attemptRepo.findOne.mockResolvedValue(
        timedAttempt(new Date(Date.now() + 10 * 60 * 1000)),
      );

      const result = await service.getSession(userId, 'attempt-1');

      expect(result.remaining_seconds).toBeGreaterThan(9 * 60);
      expect(result.remaining_seconds).toBeLessThanOrEqual(10 * 60);
    });

    it('accepts a submit that lands inside the grace window', async () => {
      attemptRepo.findOne.mockResolvedValue(
        timedAttempt(new Date(Date.now() - 30 * 1000)),
      );
      questionRepo.findBy.mockResolvedValue([
        Object.assign(new AssessmentQuestion(), {
          id: 'question-1',
          competency: 'activation',
          metadata: {},
        }),
      ]);

      const result = await service.submit(userId, {
        attemptId: 'attempt-1',
        answers,
      });

      expect(result.session_id).toBe('attempt-1');
    });

    it('rejects a submit after the deadline and uses up the attempt', async () => {
      attemptRepo.findOne.mockResolvedValue(
        timedAttempt(new Date(Date.now() - 10 * 60 * 1000)),
      );

      await expect(
        service.submit(userId, { attemptId: 'attempt-1', answers }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'SKILL_TIME_EXPIRED' }),
      });
      expect(attemptRepo.update).toHaveBeenCalledWith('attempt-1', {
        completed_at: expect.any(Date),
        force_submitted: true,
      });
    });

    it('treats a session with no deadline (started before the limit) as untimed', async () => {
      attemptRepo.findOne.mockResolvedValue(timedAttempt(null));
      questionRepo.findBy.mockResolvedValue([
        Object.assign(new AssessmentQuestion(), {
          id: 'question-1',
          competency: 'activation',
          metadata: {},
        }),
      ]);

      await expect(
        service.submit(userId, { attemptId: 'attempt-1', answers }),
      ).resolves.toMatchObject({ session_id: 'attempt-1' });
    });
  });

  it('breaks the score down by competency, weakest first', async () => {
    const q = (id: string) => ({
      question_id: id,
      question_number: 1,
      question_type: QuestionType.SINGLE_PICK,
      question_text: `Question ${id}`,
      options: ['right', 'wrong'],
      correct_answer: 'right',
    });
    attemptRepo.findOne.mockResolvedValue(
      Object.assign(new AssessmentAttempt(), {
        id: 'attempt-1',
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.SKILL,
        started_at: new Date('2026-05-21T10:00:00.000Z'),
        completed_at: null,
        generated_questions_json: {
          context: { verified_level: VerifiedLevel.MID },
          questions: [q('q1'), q('q2'), q('q3')],
        },
      }),
    );
    const entity = (id: string, competency: string | null) =>
      Object.assign(new AssessmentQuestion(), { id, competency, metadata: {} });
    questionRepo.findBy.mockResolvedValue([
      entity('q1', 'css-layout'),
      entity('q2', 'css-layout'),
      entity('q3', 'async-programming'),
    ]);

    const result = await service.submit(userId, {
      attemptId: 'attempt-1',
      answers: [
        { questionId: 'q1', answer: 'right' },
        { questionId: 'q2', answer: 'wrong' },
        { questionId: 'q3', answer: 'wrong' },
      ],
    });

    expect(result.competency_breakdown).toEqual([
      { competency: 'async-programming', correct: 0, total: 1, percentage: 0 },
      { competency: 'css-layout', correct: 1, total: 2, percentage: 50 },
    ]);
  });

  it('returns attempt_number 3 when two skill attempts are already completed', async () => {
    attemptRepo.count.mockResolvedValue(2);

    const result = await service.start(userId);

    expect(result.attempt_number).toBe(3);
  });

  it('never returns text questions even when they exist in the bank', async () => {
    // Inject text questions into the bank alongside MCQs
    eligibleSkillQuestions = [
      ...makeSkillBankQuestions(),
      Object.assign(new AssessmentQuestion(), {
        id: 'skill-text-sneaky-1',
        question_type: QuestionType.REQUIRED_TEXT,
        question_text: 'Describe your approach.',
        options: null,
        correct_answer: null,
      }),
      Object.assign(new AssessmentQuestion(), {
        id: 'skill-text-sneaky-2',
        question_type: QuestionType.OPTIONAL_TEXT,
        question_text: 'Any additional thoughts?',
        options: null,
        correct_answer: null,
      }),
    ];

    const result = await service.start(userId);

    for (const question of result.questions) {
      expect(question.block).toBe('mcq');
      expect([QuestionType.SINGLE_PICK, QuestionType.MULTI_PICK]).toContain(
        question.question_type,
      );
    }
  });

  it('refuses to start when the unseen bank lacks the skill question mix', async () => {
    eligibleSkillQuestions = makeSkillBankQuestions().slice(0, 15);

    await expect(service.start(userId)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service.start(userId)).rejects.toMatchObject({
      message: ErrorMessages.SKILL_ASSESSMENT.NO_QUESTIONS_AVAILABLE,
    });
    expect(bankExhaustedAlert.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentType: 'skill',
        detail: expect.stringContaining('Primary bank mix insufficient'),
      }),
    );
    expect(attemptRepo.save).not.toHaveBeenCalled();
  });

  it('fails with BANK_EXHAUSTED instead of repeating served questions', async () => {
    attemptRepo.count.mockResolvedValue(1);
    attemptRepo.findOne.mockResolvedValue(null); // no active session

    let eligibleQueryCount = 0;
    talentProfileRepo.manager.transaction.mockImplementation(
      async (work: (manager: EntityManagerLike) => Promise<unknown>) => {
        const manager: EntityManagerLike = {
          findOne: jest.fn().mockResolvedValue(profile),
          getRepository: jest.fn(() => attemptRepo),
          createQueryBuilder: jest.fn(() => ({
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockImplementation(() => {
              eligibleQueryCount += 1;
              // Fresh (unserved) bank is too small to build a full session.
              if (eligibleQueryCount === 1) {
                return makeSkillBankQuestions().slice(0, 5);
              }
              return makeProbeQuestions();
            }),
            insert: jest.fn(() => insertBuilder),
          })),
          create: jest.fn((_entity: unknown, data: unknown) =>
            attemptRepo.create(data),
          ),
          save: jest.fn((_entity: unknown, data: unknown) =>
            attemptRepo.save(data),
          ),
          update: jest.fn(),
        };
        return work(manager);
      },
    );

    const failure = service.start(userId);
    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(failure).rejects.toMatchObject({
      response: { error: 'ASSESSMENT_PREPARING', waitlisted: true },
    });
    // The client never sees the word "bank" or any counts.
    await failure.catch((err: ServiceUnavailableException) => {
      expect(JSON.stringify(err.getResponse())).not.toMatch(/bank|exhaust/i);
    });
    // The talent is waitlisted and the team is alerted.
    expect(waitlist.join).toHaveBeenCalledWith(
      expect.objectContaining({ id: profile.id }),
      'skill',
      'mid',
    );
    expect(bankExhaustedAlert.notify).toHaveBeenCalled();
    // The history exclusion is never lifted, so no query ran without it.
    expect(eligibleQueryCount).toBe(1);
  });

  describe('getAvailability', () => {
    it('reports can_start when a fresh session can be built', async () => {
      jest
        .spyOn(service as never, 'planFreshSession' as never)
        .mockResolvedValue({} as never);

      await expect(service.getAvailability(userId)).resolves.toEqual({
        can_start: true,
        waitlisted: false,
      });
    });

    it('reports can_start false, and the waitlist state, when questions are still being prepared', async () => {
      jest
        .spyOn(service as never, 'hasFreshCapacity' as never)
        .mockResolvedValue(false as never);
      waitlist.isWaitlisted.mockResolvedValue(true);

      await expect(service.getAvailability(userId)).resolves.toEqual({
        can_start: false,
        waitlisted: true,
      });
    });

    it('lets a talent with an open session through so they can resume', async () => {
      attemptRepo.findOne.mockResolvedValue({ id: 'active' });
      const capacity = jest.spyOn(
        service as never,
        'hasFreshCapacity' as never,
      );

      await expect(service.getAvailability(userId)).resolves.toEqual({
        can_start: true,
        waitlisted: false,
      });
      expect(capacity).not.toHaveBeenCalled();
    });
  });

  it('excludes all previously served questions from full history', async () => {
    attemptRepo.count.mockResolvedValue(1);
    attemptRepo.findOne.mockResolvedValue(null);

    let andWhereCallArgs: unknown[] = [];
    talentProfileRepo.manager.transaction.mockImplementation(
      async (work: (manager: EntityManagerLike) => Promise<unknown>) => {
        const andWhereMock = jest.fn().mockReturnThis();
        const manager: EntityManagerLike = {
          findOne: jest.fn().mockResolvedValue(profile),
          getRepository: jest.fn(() => attemptRepo),
          createQueryBuilder: jest.fn(() => ({
            where: jest.fn().mockReturnThis(),
            andWhere: andWhereMock,
            orderBy: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue(eligibleSkillQuestions),
            insert: jest.fn(() => insertBuilder),
          })),
          create: jest.fn((_entity: unknown, data: unknown) =>
            attemptRepo.create(data),
          ),
          save: jest.fn((_entity: unknown, data: unknown) =>
            attemptRepo.save(data),
          ),
          update: jest.fn(),
        };
        const result = await work(manager);
        andWhereCallArgs = andWhereMock.mock.calls.map((call) => call[1]);
        return result;
      },
    );

    await service.start(userId);

    const historyFilter = andWhereCallArgs.find(
      (args): args is Record<string, unknown> =>
        args !== null &&
        typeof args === 'object' &&
        'talentProfileId' in (args as Record<string, unknown>),
    );

    expect(historyFilter).toBeDefined();
    expect(historyFilter!.talentProfileId).toBe(profile.id);
    // Should NOT have lastAttemptId — full history is excluded
    expect(historyFilter).not.toHaveProperty('lastAttemptId');
  });

  it('starts a retake session successfully with full history exclusion', async () => {
    attemptRepo.count.mockResolvedValue(1);
    attemptRepo.findOne.mockResolvedValue(null);

    const result = await service.start(userId);

    expect(result.session_id).toBe('attempt-1');
    expect(result.questions).toHaveLength(20);
  });

  it('returns a stored skill session without exposing correct answers or side effects', async () => {
    const attempt = Object.assign(new AssessmentAttempt(), {
      id: 'attempt-1',
      talent_profile_id: profile.id,
      assessment_type: AssessmentType.SKILL,
      started_at: new Date('2026-05-21T10:00:00.000Z'),
      completed_at: null,
      generated_questions_json: {
        context: { verified_level: VerifiedLevel.MID },
        questions: [
          {
            question_id: 'question-1',
            question_number: 1,
            question_type: QuestionType.SINGLE_PICK,
            question_text: 'Which metric best indicates activation?',
            options: ['Signups', 'First key action', 'Page views'],
            correct_answer: 'First key action',
          },
        ],
      },
    });
    attemptRepo.findOne.mockResolvedValue(attempt);

    const first = await service.getSession(userId, attempt.id);
    const second = await service.getSession(userId, attempt.id);

    expect(first).toEqual(second);
    expect(first).toEqual({
      status: 'success',
      message: 'Skill assessment session returned',
      attempt_id: 'attempt-1',
      session_id: 'attempt-1',
      attempt_number: 1,
      started_at: '2026-05-21T10:00:00.000Z',
      verified_level: VerifiedLevel.MID,
      expires_at: null,
      remaining_seconds: null,
      questions: [
        {
          question_id: 'question-1',
          question_number: 1,
          block: 'mcq',
          question_type: QuestionType.SINGLE_PICK,
          question_text: 'Which metric best indicates activation?',
          options: ['Signups', 'First key action', 'Page views'],
        },
      ],
    });
    expect(first.questions[0]).not.toHaveProperty('correct_answer');
    expect(attemptRepo.save).not.toHaveBeenCalled();
  });

  it('throws 404 when skill session does not exist for the talent', async () => {
    attemptRepo.findOne.mockResolvedValue(null);

    await expect(
      service.getSession(userId, 'missing-attempt'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 400 when stored skill session has no questions', async () => {
    attemptRepo.findOne.mockResolvedValue(
      Object.assign(new AssessmentAttempt(), {
        id: 'attempt-1',
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.SKILL,
        started_at: new Date('2026-05-21T10:00:00.000Z'),
        generated_questions_json: {
          context: { verified_level: VerifiedLevel.MID },
          questions: [],
        },
      }),
    );

    await expect(
      service.getSession(userId, 'attempt-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 400 when a stored skill session contains a text question', async () => {
    attemptRepo.findOne.mockResolvedValue(
      Object.assign(new AssessmentAttempt(), {
        id: 'attempt-1',
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.SKILL,
        started_at: new Date('2026-05-21T10:00:00.000Z'),
        generated_questions_json: {
          context: { verified_level: VerifiedLevel.MID },
          questions: [
            {
              question_id: 'question-1',
              question_number: 1,
              question_type: QuestionType.REQUIRED_TEXT,
              question_text: 'Describe your process.',
              options: null,
              correct_answer: null,
            },
          ],
        },
      }),
    );

    await expect(
      service.getSession(userId, 'attempt-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns session_id when submitting a skill assessment', async () => {
    const attempt = Object.assign(new AssessmentAttempt(), {
      id: 'attempt-1',
      talent_profile_id: profile.id,
      assessment_type: AssessmentType.SKILL,
      started_at: new Date('2026-05-21T10:00:00.000Z'),
      completed_at: null,
      generated_questions_json: {
        context: { verified_level: VerifiedLevel.MID },
        questions: [
          {
            question_id: 'question-1',
            question_number: 1,
            question_type: QuestionType.SINGLE_PICK,
            question_text: 'Which metric best indicates activation?',
            options: ['Signups', 'First key action', 'Page views'],
            correct_answer: 'First key action',
          },
        ],
      },
    });
    attemptRepo.findOne.mockResolvedValue(attempt);
    questionRepo.findBy.mockResolvedValue([
      Object.assign(new AssessmentQuestion(), {
        id: 'question-1',
        competency: 'activation',
        metadata: {},
      }),
    ]);

    const result = await service.submit(userId, {
      attemptId: 'attempt-1',
      answers: [{ questionId: 'question-1', answer: 'First key action' }],
    });

    expect(result.session_id).toBe('attempt-1');
    expect(result.attempt_number).toBe(1);
    expect(result).not.toHaveProperty('attempt_id');
    expect(guidanceReportQueue.enqueue).not.toHaveBeenCalled();
  });

  it('includes retake metadata in the submit response', async () => {
    const attempt = Object.assign(new AssessmentAttempt(), {
      id: 'attempt-1',
      talent_profile_id: profile.id,
      assessment_type: AssessmentType.SKILL,
      started_at: new Date('2026-05-21T10:00:00.000Z'),
      completed_at: null,
      generated_questions_json: {
        context: { verified_level: VerifiedLevel.MID },
        questions: [
          {
            question_id: 'question-1',
            question_number: 1,
            question_type: QuestionType.SINGLE_PICK,
            question_text: 'Which metric best indicates activation?',
            options: ['Signups', 'First key action', 'Page views'],
            correct_answer: 'First key action',
          },
        ],
      },
    });
    attemptRepo.findOne.mockResolvedValue(attempt);
    attemptRepo.count.mockResolvedValue(1);
    questionRepo.findBy.mockResolvedValue([
      Object.assign(new AssessmentQuestion(), {
        id: 'question-1',
        competency: 'activation',
        metadata: {},
      }),
    ]);

    const result = await service.submit(userId, {
      attemptId: 'attempt-1',
      answers: [{ questionId: 'question-1', answer: 'Wrong answer' }],
    });

    expect(result.max_attempts).toBe(SKILL_ASSESSMENT_MAX_ATTEMPTS);
    expect(result.attempts_used).toBe(1);
    expect(result.retake_available).toBe(true);
    expect(guidanceReportQueue.enqueue).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      track: 'frontend_developer',
      claimed_level: VerifiedLevel.MID,
      validated_level: VerifiedLevel.JUNIOR,
      percentage: 0,
    });
  });

  it('does not pass when all primary MCQs are wrong', async () => {
    const attempt = Object.assign(new AssessmentAttempt(), {
      id: 'attempt-1',
      talent_profile_id: profile.id,
      assessment_type: AssessmentType.SKILL,
      started_at: new Date('2026-05-21T10:00:00.000Z'),
      completed_at: null,
      generated_questions_json: {
        context: { verified_level: VerifiedLevel.MID },
        questions: [
          {
            question_id: 'question-mcq-1',
            question_number: 1,
            block: 'mcq',
            question_type: QuestionType.SINGLE_PICK,
            question_text: 'Which metric best indicates activation?',
            options: ['Signups', 'First key action', 'Page views'],
            correct_answer: 'First key action',
          },
          {
            question_id: 'question-mcq-2',
            question_number: 2,
            block: 'mcq',
            question_type: QuestionType.SINGLE_PICK,
            question_text: 'What is the primary goal?',
            options: ['Growth', 'Retention', 'Awareness'],
            correct_answer: 'Growth',
          },
        ],
      },
    });
    attemptRepo.findOne.mockResolvedValue(attempt);
    questionRepo.findBy.mockResolvedValue([
      Object.assign(new AssessmentQuestion(), {
        id: 'question-mcq-1',
        metadata: {},
      }),
      Object.assign(new AssessmentQuestion(), {
        id: 'question-mcq-2',
        metadata: {},
      }),
    ]);

    const result = await service.submit(userId, {
      attemptId: 'attempt-1',
      answers: [
        { questionId: 'question-mcq-1', answer: 'Signups' },
        { questionId: 'question-mcq-2', answer: 'Retention' },
      ],
    });

    expect(result.percentage).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.failed).toBe(true);
    expect(result.validated_level).toBeNull();
    expect(guidanceReportQueue.enqueue).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      track: 'frontend_developer',
      claimed_level: VerifiedLevel.MID,
      validated_level: VerifiedLevel.JUNIOR,
      percentage: 0,
    });
  });

  it('returns failed without profile verification when overall is below 50%', async () => {
    const attempt = Object.assign(new AssessmentAttempt(), {
      id: 'attempt-1',
      talent_profile_id: profile.id,
      assessment_type: AssessmentType.SKILL,
      started_at: new Date('2026-05-21T10:00:00.000Z'),
      completed_at: null,
      generated_questions_json: {
        context: { verified_level: VerifiedLevel.MID },
        questions: [
          {
            question_id: 'question-mcq-1',
            question_number: 1,
            block: 'mcq',
            question_type: QuestionType.SINGLE_PICK,
            question_text: 'Which metric best indicates activation?',
            options: ['Signups', 'First key action', 'Page views'],
            correct_answer: 'First key action',
          },
          {
            question_id: 'question-mcq-2',
            question_number: 2,
            block: 'mcq',
            question_type: QuestionType.SINGLE_PICK,
            question_text: 'What is the primary goal?',
            options: ['Growth', 'Retention', 'Awareness'],
            correct_answer: 'Growth',
          },
        ],
      },
    });
    attemptRepo.findOne.mockResolvedValue(attempt);
    questionRepo.findBy.mockResolvedValue([
      Object.assign(new AssessmentQuestion(), {
        id: 'question-mcq-1',
        metadata: {},
      }),
      Object.assign(new AssessmentQuestion(), {
        id: 'question-mcq-2',
        metadata: {},
      }),
    ]);

    const updateMock = jest.fn();
    talentProfileRepo.manager.transaction.mockImplementation(
      async (work: (manager: EntityManagerLike) => Promise<unknown>) => {
        const insertBuilder = {
          into: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          orUpdate: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue(undefined),
        };
        const manager: EntityManagerLike = {
          findOne: jest.fn(),
          getRepository: jest.fn(() => attemptRepo),
          createQueryBuilder: jest.fn(() => ({
            insert: jest.fn(() => insertBuilder),
          })),
          save: jest.fn(),
          update: updateMock,
          create: jest.fn((_entity: unknown, data: unknown) => data),
        };
        return work(manager);
      },
    );

    const result = await service.submit(userId, {
      attemptId: 'attempt-1',
      answers: [
        { questionId: 'question-mcq-1', answer: 'Signups' },
        { questionId: 'question-mcq-2', answer: 'Retention' },
      ],
    });

    expect(result.failed).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.percentage).toBeLessThan(50);
    expect(result.validated_level).toBeNull();
    expect(result.passed).toBe(false);
    expect(
      notificationDispatch.notifySkillAssessmentFailed,
    ).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ percentage: result.percentage }),
    );
    expect(
      notificationDispatch.notifySkillAssessmentPassed,
    ).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      TalentProfile,
      { id: profile.id },
      { status: expect.any(String) },
    );
    expect(updateMock).not.toHaveBeenCalledWith(
      TalentProfile,
      { id: profile.id },
      expect.objectContaining({
        skill_assessment_completed_at: expect.any(Date),
      }),
    );
    expect(guidanceReportQueue.enqueue).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      track: 'frontend_developer',
      claimed_level: VerifiedLevel.MID,
      validated_level: VerifiedLevel.JUNIOR,
      percentage: 0,
    });
  });

  it('scores MCQ answers correctly as pass when majority are correct', async () => {
    const attempt = Object.assign(new AssessmentAttempt(), {
      id: 'attempt-1',
      talent_profile_id: profile.id,
      assessment_type: AssessmentType.SKILL,
      started_at: new Date('2026-05-21T10:00:00.000Z'),
      completed_at: null,
      generated_questions_json: {
        context: { verified_level: VerifiedLevel.MID },
        questions: [
          {
            question_id: 'question-mcq-1',
            question_number: 1,
            block: 'mcq',
            question_type: QuestionType.SINGLE_PICK,
            question_text: 'Q1?',
            options: ['A', 'B'],
            correct_answer: 'A',
          },
          {
            question_id: 'question-mcq-2',
            question_number: 2,
            block: 'mcq',
            question_type: QuestionType.SINGLE_PICK,
            question_text: 'Q2?',
            options: ['A', 'B'],
            correct_answer: 'A',
          },
        ],
      },
    });
    attemptRepo.findOne.mockResolvedValue(attempt);
    questionRepo.findBy.mockResolvedValue([
      Object.assign(new AssessmentQuestion(), {
        id: 'question-mcq-1',
        metadata: {},
      }),
      Object.assign(new AssessmentQuestion(), {
        id: 'question-mcq-2',
        metadata: {},
      }),
    ]);

    const result = await service.submit(userId, {
      attemptId: 'attempt-1',
      answers: [
        { questionId: 'question-mcq-1', answer: 'A' },
        { questionId: 'question-mcq-2', answer: 'A' },
      ],
    });

    expect(result.percentage).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.failed).toBe(false);
    expect(
      notificationDispatch.notifySkillAssessmentPassed,
    ).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        certificateCode: 'CERT123',
        percentage: 100,
      }),
    );
    expect(
      notificationDispatch.notifySkillAssessmentFailed,
    ).not.toHaveBeenCalled();
    expect(warmCacheMock).toHaveBeenCalledWith(
      profile.track,
      expect.any(String),
    );
    expect(guidanceReportQueue.enqueue).not.toHaveBeenCalled();
  });

  it('resolves Stage 2 confirmed-level outcomes from claimed-level score', () => {
    const resolveLevel = (
      service as unknown as {
        resolveValidatedLevel: (
          claimedPercentage: number,
          aboveLevelPercentage: number,
          belowLevelPercentage: number,
          overallPercentage: number,
          claimedLevel: VerifiedLevel,
          primaryMcqGatePassed?: boolean,
          aboveProbeMcqGatePassed?: boolean,
        ) => VerifiedLevel;
      }
    ).resolveValidatedLevel.bind(service);

    expect(resolveLevel(70, 0, 0, 70, VerifiedLevel.MID)).toBe(
      VerifiedLevel.MID,
    );
    expect(resolveLevel(59, 0, 65, 60, VerifiedLevel.SENIOR)).toBe(
      VerifiedLevel.SENIOR,
    );
    expect(resolveLevel(59, 0, 50, 58, VerifiedLevel.SENIOR)).toBe(
      VerifiedLevel.SENIOR,
    );
    expect(resolveLevel(54, 0, 0, 54, VerifiedLevel.EXPERT)).toBe(
      VerifiedLevel.JUNIOR,
    );
    expect(resolveLevel(54, 0, 0, 54, VerifiedLevel.JUNIOR)).toBe(
      VerifiedLevel.JUNIOR,
    );
    expect(resolveLevel(95, 70, 0, 92, VerifiedLevel.MID)).toBe(
      VerifiedLevel.SENIOR,
    );
    expect(resolveLevel(95, 70, 0, 92, VerifiedLevel.MID, true, false)).toBe(
      VerifiedLevel.MID,
    );
    expect(resolveLevel(70, 0, 0, 70, VerifiedLevel.MID, false, true)).toBe(
      VerifiedLevel.JUNIOR,
    );
    expect(resolveLevel(95, 50, 0, 90, VerifiedLevel.MID)).toBe(
      VerifiedLevel.MID,
    );
    expect(resolveLevel(65, 0, 0, 65, VerifiedLevel.MID)).toBe(
      VerifiedLevel.MID,
    );
  });

  it('does not enforce attempt limit after advanced assessment is complete', async () => {
    profile.advanced_assessment_completed_at = new Date();
    attemptRepo.count.mockResolvedValue(SKILL_ASSESSMENT_MAX_ATTEMPTS);

    await expect(
      (
        service as unknown as {
          assertSkillAssessmentAttemptsRemaining: (
            p: TalentProfile,
          ) => Promise<void>;
        }
      ).assertSkillAssessmentAttemptsRemaining(profile),
    ).resolves.toBeUndefined();

    expect(attemptRepo.count).not.toHaveBeenCalled();
  });

  describe('flag()', () => {
    it('records a violation without voiding while under the limit', async () => {
      const attempt = Object.assign(new AssessmentAttempt(), {
        id: 'attempt-1',
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.SKILL,
        completed_at: null,
        force_submitted: false,
        tab_switch_count: 0,
        copy_paste_count: 0,
      });
      const update = jest.fn().mockResolvedValue(undefined);
      talentProfileRepo.manager.transaction.mockImplementation(
        async (
          work: (manager: Record<string, jest.Mock>) => Promise<unknown>,
        ) =>
          work({
            findOne: jest
              .fn()
              .mockResolvedValueOnce(attempt)
              .mockResolvedValueOnce({ ...attempt, tab_switch_count: 2 }),
            increment: jest.fn().mockResolvedValue(undefined),
            update,
          }),
      );

      const result = await service.flag(userId, 'attempt-1', {
        eventType: IntegrityEventType.TAB_SWITCH,
      });

      expect(result.status).toBe('recorded');
      expect(result.action).toBe('warn');
      expect(result.sessionVoided).toBe(false);
      expect(result.tabSwitchCount).toBe(2);
      expect(update).not.toHaveBeenCalled();
    });

    it('voids an active skill session on the third violation', async () => {
      const attempt = Object.assign(new AssessmentAttempt(), {
        id: 'attempt-1',
        talent_profile_id: profile.id,
        assessment_type: AssessmentType.SKILL,
        completed_at: null,
        force_submitted: false,
        tab_switch_count: 0,
        copy_paste_count: 0,
      });

      talentProfileRepo.manager.transaction.mockImplementation(
        async (
          work: (manager: Record<string, jest.Mock>) => Promise<unknown>,
        ) =>
          work({
            findOne: jest
              .fn()
              .mockResolvedValueOnce(attempt)
              .mockResolvedValueOnce({
                ...attempt,
                tab_switch_count: 3,
                copy_paste_count: 0,
              }),
            increment: jest.fn().mockResolvedValue(undefined),
            update: jest.fn().mockResolvedValue(undefined),
          }),
      );

      const result = await service.flag(userId, 'attempt-1', {
        eventType: IntegrityEventType.TAB_SWITCH,
      });

      expect(result.status).toBe('voided');
      expect(result.action).toBe('logout');
      expect(result.sessionVoided).toBe(true);
      expect(result.tabSwitchCount).toBe(3);
    });

    it('throws 400 when flagging a completed skill session', async () => {
      talentProfileRepo.manager.transaction.mockImplementation(
        async (
          work: (manager: Record<string, jest.Mock>) => Promise<unknown>,
        ) =>
          work({
            findOne: jest.fn().mockResolvedValue(
              Object.assign(new AssessmentAttempt(), {
                id: 'attempt-1',
                completed_at: new Date(),
              }),
            ),
          }),
      );

      await expect(
        service.flag(userId, 'attempt-1', {
          eventType: IntegrityEventType.COPY_PASTE,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

type EntityManagerLike = {
  findOne: jest.Mock;
  getRepository: jest.Mock;
  createQueryBuilder: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
};

function makeSkillBankQuestions(): AssessmentQuestion[] {
  return Array.from({ length: 16 }, (_ignored, index) =>
    Object.assign(new AssessmentQuestion(), {
      id: `skill-mcq-${index + 1}`,
      question_type: QuestionType.SINGLE_PICK,
      question_text: `Skill MCQ ${index + 1}`,
      options: ['A', 'B'],
      correct_answer: 'A',
    }),
  );
}

function makeProbeQuestions(): AssessmentQuestion[] {
  return [
    Object.assign(new AssessmentQuestion(), {
      id: 'probe-mcq-1',
      question_type: QuestionType.SINGLE_PICK,
      question_text: 'Probe MCQ 1',
      options: ['A', 'B'],
      correct_answer: 'A',
    }),
    Object.assign(new AssessmentQuestion(), {
      id: 'probe-mcq-2',
      question_type: QuestionType.SINGLE_PICK,
      question_text: 'Probe MCQ 2',
      options: ['A', 'B'],
      correct_answer: 'A',
    }),
  ];
}
