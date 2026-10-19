import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { EmployerAssessmentsService } from './employer-assessments.service';
import {
  EmployerAssessment,
  EmployerAssessmentExperienceLevel,
  EmployerAssessmentQuestionSource,
  EmployerAssessmentType,
} from './entities/employer-assessment.entity';
import {
  EmployerAssessmentQuestion,
  EmployerQuestionType,
} from './entities/employer-assessment-question.entity';
import {
  EmployerAssessmentDeliveryMode,
  EmployerAssessmentInvite,
} from './entities/employer-assessment-invite.entity';
import type { TalentRoleTrack } from '@modules/talent/talent.constants';
import { EmployerAssessmentSubmission } from './entities/employer-assessment-submission.entity';
import { CredlaneCatalogueAssessment } from './entities/credlane-catalogue-assessment.entity';
import { CredlaneCatalogueQuestion } from './entities/credlane-catalogue-question.entity';
import { PaymentRequiredError } from '../../shared';
import { EmployerAssessmentAttempt } from './entities/employer-assessment-attempt.entity';
import { EmployerSavedCandidate } from '../employer-discovery/entities/employer-saved-candidate.entity';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { EmployerRole } from '../employer-roles/entities/employer-role.entity';
import { User } from '../users/entities/user.entity';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { Offer, OfferStatus } from '../offers/entities/offer.entity';
import { EmployerBillingService } from '../employer-billing/employer-billing.service';
import { MailService } from '../mail/mail.service';
import { EmployerAssessmentExternalApplicant } from './entities/employer-assessment-external-applicant.entity';
import { EmployerAssessmentExternalInvite } from './entities/employer-assessment-external-invite.entity';
import { EmployerAssessmentExternalSubmission } from './entities/employer-assessment-external-submission.entity';

describe('EmployerAssessmentsService', () => {
  let service: EmployerAssessmentsService;

  const mockAssessmentRepo = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    manager: { transaction: jest.fn(), save: jest.fn() },
  };

  const mockQuestionRepo = { save: jest.fn() };
  const mockInviteRepo = {
    save: jest.fn(),
    count: jest.fn(),
    find: jest.fn(),
  };

  const mockSubmissionRepo = {
    save: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    }),
  };

  const mockCatalogueQuestionQb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  const mockCatalogueQuestionRepo = {
    find: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockCatalogueQuestionQb),
  };
  const mockSavedCandidateRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockPoolProfileRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockUserQb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };

  const mockUserRepo = {
    findOne: jest.fn(),
    findBy: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockUserQb),
  };

  const mockEmployerRoleRepo = {
    find: jest.fn(),
  };

  const mockEmployerProfileRepo = {
    findOne: jest.fn(),
  };

  const mockManager = {
    update: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest
      .fn()
      .mockImplementation(
        async (cb: (m: typeof mockManager) => Promise<unknown>) =>
          cb(mockManager),
      ),
  };

  const mockOfferRepo = {
    update: jest.fn(),
    find: jest.fn(),
    manager: {
      transaction: jest
        .fn()
        .mockImplementation(
          async (cb: (m: typeof mockManager) => Promise<unknown>) =>
            cb(mockManager),
        ),
    },
  };

  const mockAttemptRepo = {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    save: jest.fn(),
  };

  const mockExternalApplicantRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };

  const mockExternalInviteRepo = {
    find: jest.fn(),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(),
  };

  const mockExternalSubmissionRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    save: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };

  const mockNotificationDispatch = {
    dispatch: jest.fn(),
    notifyAssessmentPassed: jest.fn(),
    notifyAssessmentFailed: jest.fn(),
  };

  const mockMailService = {
    send: jest.fn(),
  };

  const mockBilling = {
    getUnlockedIds: jest.fn().mockResolvedValue(new Set()),
    spendInvites: jest.fn().mockResolvedValue({ invites_remaining: 9 }),
    refundInvites: jest.fn().mockResolvedValue(undefined),
  };

  const mockCatalogueRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployerAssessmentsService,
        {
          provide: getRepositoryToken(EmployerAssessment),
          useValue: mockAssessmentRepo,
        },
        {
          provide: getRepositoryToken(EmployerAssessmentQuestion),
          useValue: mockQuestionRepo,
        },
        {
          provide: getRepositoryToken(EmployerAssessmentInvite),
          useValue: mockInviteRepo,
        },
        {
          provide: getRepositoryToken(EmployerAssessmentSubmission),
          useValue: mockSubmissionRepo,
        },
        {
          provide: getRepositoryToken(EmployerAssessmentAttempt),
          useValue: mockAttemptRepo,
        },
        {
          provide: getRepositoryToken(CredlaneCatalogueQuestion),
          useValue: mockCatalogueQuestionRepo,
        },
        {
          provide: getRepositoryToken(EmployerSavedCandidate),
          useValue: mockSavedCandidateRepo,
        },
        {
          provide: getRepositoryToken(EmployerPoolProfile),
          useValue: mockPoolProfileRepo,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
        {
          provide: getRepositoryToken(EmployerRole),
          useValue: mockEmployerRoleRepo,
        },
        {
          provide: getRepositoryToken(EmployerProfile),
          useValue: mockEmployerProfileRepo,
        },
        {
          provide: getRepositoryToken(Offer),
          useValue: mockOfferRepo,
        },
        {
          provide: getRepositoryToken(EmployerAssessmentExternalApplicant),
          useValue: mockExternalApplicantRepo,
        },
        {
          provide: getRepositoryToken(EmployerAssessmentExternalInvite),
          useValue: mockExternalInviteRepo,
        },
        {
          provide: getRepositoryToken(EmployerAssessmentExternalSubmission),
          useValue: mockExternalSubmissionRepo,
        },
        {
          provide: NotificationDispatchService,
          useValue: mockNotificationDispatch,
        },
        {
          provide: EmployerBillingService,
          useValue: mockBilling,
        },
        {
          provide: MailService,
          useValue: mockMailService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: getRepositoryToken(CredlaneCatalogueAssessment),
          useValue: mockCatalogueRepo,
        },
      ],
    }).compile();

    service = module.get<EmployerAssessmentsService>(
      EmployerAssessmentsService,
    );
    jest.clearAllMocks();
    // Aggregates need real query builders; default to "no activity".
    jest
      .spyOn(
        service as unknown as { loadAssessmentStats: () => Promise<unknown> },
        'loadAssessmentStats',
      )
      .mockResolvedValue(new Map());
  });

  // ─── createAssessment ──────────────────────────────────────────────────────

  describe('createAssessment', () => {
    const baseDto = {
      title: 'Frontend Assessment',
      type: EmployerAssessmentType.EXTERNAL,
      roleTrack: 'frontend_developer' as TalentRoleTrack,
      experienceLevel: EmployerAssessmentExperienceLevel.MID,
      timeLimitMinutes: 30,
      passingThreshold: 70,
      questionSource: EmployerAssessmentQuestionSource.COMPANY_QUESTIONS,
      shareViaLink: true,
      sendToCandidates: false,
      questions: Array.from({ length: 5 }, (_, i) => ({
        questionText: `Question ${i + 1}`,
        questionType: EmployerQuestionType.MULTIPLE_CHOICE,
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 'A',
      })),
    };

    it('should create an assessment with company questions', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      const lockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'emp-1',
          is_verified: true,
        }),
      };
      const saveMock = jest
        .fn()
        .mockResolvedValueOnce({
          id: 'assessment-1',
          employer_user_id: 'emp-1',
          title: baseDto.title,
          share_token: 'abc123',
          is_active: true,
        })
        .mockResolvedValueOnce([]);
      mockAssessmentRepo.manager.transaction.mockImplementation(
        async (cb: (manager: unknown) => Promise<unknown>) => {
          const manager = {
            getRepository: jest.fn().mockReturnValue({
              createQueryBuilder: jest.fn().mockReturnValue(lockQueryBuilder),
            }),
            count: jest.fn().mockResolvedValue(0),
            save: saveMock,
          };
          return cb(manager);
        },
      );

      const result = await service.createAssessment('emp-1', baseDto);

      expect(result.id).toBe('assessment-1');
      expect(result.shareUrl).toContain('abc123');
      expect(lockQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
      expect(lockQueryBuilder.where).toHaveBeenCalledWith('user.id = :userId', {
        userId: 'emp-1',
      });
      // credlane_assessment_id must be null for COMPANY_QUESTIONS
      expect(saveMock.mock.calls[0][1]).toHaveProperty(
        'credlane_assessment_id',
        null,
      );
    });

    it('should reject when less than 5 company questions are provided', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.count.mockResolvedValue(0);

      const dto = {
        ...baseDto,
        questions: baseDto.questions.slice(0, 3),
      };

      await expect(service.createAssessment('emp-1', dto)).rejects.toThrow(
        'A minimum of 5 questions is required',
      );
    });

    it('should reject when 5 active assessments already exist', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.manager.transaction.mockImplementation(
        async (cb: (manager: unknown) => Promise<unknown>) => {
          const manager = {
            getRepository: jest.fn().mockReturnValue({
              createQueryBuilder: jest.fn().mockReturnValue({
                setLock: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue({
                  id: 'emp-1',
                  is_verified: true,
                }),
              }),
            }),
            count: jest.fn().mockResolvedValue(5),
            save: jest.fn(),
          };
          return cb(manager);
        },
      );

      await expect(service.createAssessment('emp-1', baseDto)).rejects.toThrow(
        'active assessment limit',
      );
    });

    it('should reject when no delivery mode is selected', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });

      const dto = {
        ...baseDto,
        shareViaLink: false,
        sendToCandidates: false,
      };

      await expect(service.createAssessment('emp-1', dto)).rejects.toThrow(
        'Select at least one delivery mode',
      );
    });

    it('should reject duplicate candidate ids before creating invites', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });

      await expect(
        service.createAssessment('emp-1', {
          ...baseDto,
          sendToCandidates: true,
          candidateUserIds: [
            '7b4f68b2-e1f4-4e91-b14b-1b26fca0b817',
            '7b4f68b2-e1f4-4e91-b14b-1b26fca0b817',
          ],
        }),
      ).rejects.toThrow('duplicate entries');
      expect(mockAssessmentRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('should reject unverified employers', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: false,
      });

      await expect(service.createAssessment('emp-1', baseDto)).rejects.toThrow(
        'Only verified employers',
      );
    });
  });

  // ─── deactivateAssessment ──────────────────────────────────────────────────

  describe('deactivateAssessment', () => {
    it('should deactivate an active assessment', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.deactivateAssessment('emp-1', 'ass-1');

      expect(result.status).toBe('success');
      expect(mockAssessmentRepo.update).toHaveBeenCalledWith(
        { id: 'ass-1', employer_user_id: 'emp-1', is_active: true },
        { is_active: false },
      );
    });

    it('should throw NotFoundError if assessment not found or already inactive', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.deactivateAssessment('emp-1', 'ass-1'),
      ).rejects.toThrow('Active assessment not found');
    });
  });

  // ─── getAssessment ────────────────────────────────────────────────────────

  describe('getAssessment', () => {
    it('should return an employer assessment with questions and share URL', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.findOne.mockResolvedValue({
        id: 'ass-1',
        employer_user_id: 'emp-1',
        title: 'Frontend Assessment',
        share_token: 'token-abc',
        questions: [
          {
            id: 'q-1',
            position: 1,
            question_text: 'What is React?',
            question_type: EmployerQuestionType.SHORT_ANSWER,
            correct_answer: 'A library',
          },
        ],
      });

      const result = await service.getAssessment('emp-1', 'ass-1');

      expect(result.id).toBe('ass-1');
      expect(result.title).toBe('Frontend Assessment');
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].question_text).toBe('What is React?');
      expect(result.shareUrl).toContain('/assessment/token-abc');
      expect(mockAssessmentRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'ass-1', employer_user_id: 'emp-1' },
        relations: ['questions'],
        order: { questions: { position: 'ASC' } },
      });
    });

    it('should scope lookup to the requesting employer and reject wrong-owner access', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-2',
        is_verified: true,
      });
      mockAssessmentRepo.findOne.mockResolvedValue(null);

      await expect(service.getAssessment('emp-2', 'ass-1')).rejects.toThrow(
        'Assessment not found',
      );

      expect(mockAssessmentRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ass-1', employer_user_id: 'emp-2' },
        }),
      );
    });

    it('should throw NotFoundError when assessment does not exist', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getAssessment('emp-1', 'missing-ass'),
      ).rejects.toThrow('Assessment not found');
    });
  });

  // ─── getPublicAssessmentByToken ────────────────────────────────────────────

  describe('getPublicAssessmentByToken', () => {
    it('should strip correct answers from returned questions', async () => {
      mockAssessmentRepo.findOne.mockResolvedValue({
        id: 'ass-1',
        is_active: true,
        share_token: 'token-abc',
        questions: [
          {
            id: 'q-1',
            question_text: 'What is 1+1?',
            question_type: EmployerQuestionType.MULTIPLE_CHOICE,
            options: ['1', '2', '3'],
            correct_answer: '2',
            position: 1,
          },
        ],
      });

      const result = await service.getPublicAssessmentByToken('token-abc');
      const question = result.questions[0] as unknown as Record<
        string,
        unknown
      >;

      expect(question.question_text).toBe('What is 1+1?');
      expect(question).not.toHaveProperty('correct_answer');
    });

    it('should throw ForbiddenError for deactivated assessments', async () => {
      mockAssessmentRepo.findOne.mockResolvedValue({
        id: 'ass-1',
        is_active: false,
      });

      await expect(
        service.getPublicAssessmentByToken('token-abc'),
      ).rejects.toThrow('no longer accepting submissions');
    });

    it('should throw NotFoundError for unknown token', async () => {
      mockAssessmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getPublicAssessmentByToken('bad-token'),
      ).rejects.toThrow('Assessment not found');
    });
  });

  // ─── submitAssessment ──────────────────────────────────────────────────────

  describe('submitAssessment', () => {
    const questions = [
      {
        id: 'q-1',
        correct_answer: 'A',
        question_text: 'Q1',
        question_type: EmployerQuestionType.MULTIPLE_CHOICE,
      },
      {
        id: 'q-2',
        correct_answer: 'True',
        question_text: 'Q2',
        question_type: EmployerQuestionType.TRUE_FALSE,
      },
      {
        id: 'q-3',
        correct_answer: 'B',
        question_text: 'Q3',
        question_type: EmployerQuestionType.MULTIPLE_CHOICE,
      },
      {
        id: 'q-4',
        correct_answer: 'C',
        question_text: 'Q4',
        question_type: EmployerQuestionType.MULTIPLE_CHOICE,
      },
      {
        id: 'q-5',
        correct_answer: 'D',
        question_text: 'Q5',
        question_type: EmployerQuestionType.MULTIPLE_CHOICE,
      },
    ];

    const assessment = {
      id: 'ass-1',
      is_active: true,
      share_token: 'token-abc',
      passing_threshold: 60,
      questions,
    };

    it('should compute score server-side and save submission', async () => {
      mockAssessmentRepo.findOne.mockResolvedValue(assessment);
      mockSubmissionRepo.findOne.mockResolvedValue(null);
      mockManager.save.mockImplementation(
        async (_entity: unknown, data: unknown) => ({
          id: 'sub-1',
          ...(data as Record<string, unknown>),
        }),
      );
      mockEmployerRoleRepo.find.mockResolvedValue([
        { id: 'role-1' },
        { id: 'role-2' },
      ]);
      mockManager.find.mockResolvedValue([
        {
          id: 'offer-1',
          employer_user_id: 'employer-1',
          candidate_user_id: 'candidate-1',
          role_title: 'Engineer',
        },
      ]);
      mockManager.update.mockResolvedValue({ affected: 1 });

      const result = await service.submitAssessment(
        'candidate-1',
        'token-abc',
        {
          timeTakenSeconds: 600,
          deliveryMode: EmployerAssessmentDeliveryMode.LINK,
          answers: {
            'q-1': 'A',
            'q-2': 'True',
            'q-3': 'B',
            'q-4': 'C',
            'q-5': 'D',
          },
        },
      );

      // All 5 correct → score should be 100
      expect(result.score).toBe(100);
      expect(result.passed).toBe(true);
      expect(mockEmployerRoleRepo.find).toHaveBeenCalledWith({
        where: { assessment_id: 'ass-1' },
        select: ['id'],
      });
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(mockManager.find).toHaveBeenCalledWith(Offer, {
        where: {
          candidate_user_id: 'candidate-1',
          role_id: expect.any(Object),
          status: expect.any(Object),
        },
        select: ['id', 'employer_user_id', 'candidate_user_id', 'role_title'],
      });
    });

    it('should compute partial score correctly', async () => {
      mockAssessmentRepo.findOne.mockResolvedValue(assessment);
      mockSubmissionRepo.findOne.mockResolvedValue(null);
      mockManager.save.mockImplementation(
        async (_entity: unknown, data: unknown) => ({
          id: 'sub-1',
          ...(data as Record<string, unknown>),
        }),
      );
      mockEmployerRoleRepo.find.mockResolvedValue([]);

      const result = await service.submitAssessment(
        'candidate-1',
        'token-abc',
        {
          timeTakenSeconds: 300,
          deliveryMode: EmployerAssessmentDeliveryMode.LINK,
          answers: {
            'q-1': 'A',
            'q-2': 'False', // wrong
            'q-3': 'A', // wrong
            'q-4': 'C',
            'q-5': 'D',
          },
        },
      );

      // 3 out of 5 correct → 60%
      expect(result.score).toBe(60);
      expect(result.passed).toBe(true); // threshold is 60
      expect(mockManager.update).not.toHaveBeenCalled();
    });

    it('should mark linked role offer as failed when candidate fails attached assessment', async () => {
      mockAssessmentRepo.findOne.mockResolvedValue({
        ...assessment,
        passing_threshold: 80,
      });
      mockSubmissionRepo.findOne.mockResolvedValue(null);
      mockManager.save.mockImplementation(
        async (_entity: unknown, data: unknown) => ({
          id: 'sub-1',
          ...(data as Record<string, unknown>),
        }),
      );
      mockEmployerRoleRepo.find.mockResolvedValue([{ id: 'role-1' }]);
      mockManager.update.mockResolvedValue({ affected: 1 });
      mockManager.find.mockResolvedValue([
        {
          id: 'offer-1',
          employer_user_id: 'employer-1',
          candidate_user_id: 'candidate-1',
          role_title: 'Engineer',
        },
      ]);

      const result = await service.submitAssessment(
        'candidate-1',
        'token-abc',
        {
          timeTakenSeconds: 300,
          deliveryMode: EmployerAssessmentDeliveryMode.LINK,
          answers: {
            'q-1': 'A',
            'q-2': 'False',
            'q-3': 'A',
            'q-4': 'C',
            'q-5': 'D',
          },
        },
      );

      expect(result.passed).toBe(false);
      expect(mockManager.update).not.toHaveBeenCalled();
    });

    it('should reject duplicate submissions', async () => {
      mockAssessmentRepo.findOne.mockResolvedValue(assessment);
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'existing-sub',
      });

      await expect(
        service.submitAssessment('candidate-1', 'token-abc', {
          timeTakenSeconds: 300,
          deliveryMode: EmployerAssessmentDeliveryMode.LINK,
          answers: {},
        }),
      ).rejects.toThrow('already submitted');
    });

    it('should translate concurrent duplicate submissions to ConflictError', async () => {
      mockAssessmentRepo.findOne.mockResolvedValue(assessment);
      mockSubmissionRepo.findOne.mockResolvedValue(null);
      mockManager.save.mockRejectedValue(
        new QueryFailedError(
          'INSERT INTO employer_assessment_submissions',
          [],
          { code: '23505' } as unknown as Error,
        ),
      );

      await expect(
        service.submitAssessment('candidate-1', 'token-abc', {
          timeTakenSeconds: 300,
          deliveryMode: EmployerAssessmentDeliveryMode.LINK,
          answers: {},
        }),
      ).rejects.toThrow('already submitted');
    });

    it('should reject submissions for deactivated assessments', async () => {
      mockAssessmentRepo.findOne.mockResolvedValue({
        ...assessment,
        is_active: false,
      });

      await expect(
        service.submitAssessment('candidate-1', 'token-abc', {
          timeTakenSeconds: 300,
          deliveryMode: EmployerAssessmentDeliveryMode.LINK,
          answers: {},
        }),
      ).rejects.toThrow('no longer accepting submissions');
    });
  });

  // ─── validateUploadedQuestionFile ──────────────────────────────────────────

  describe('validateUploadedQuestionFile', () => {
    it('should reject when no file is provided', () => {
      expect(() => service.validateUploadedQuestionFile(undefined)).toThrow(
        "couldn't read this file",
      );
    });

    it('should reject files larger than 5MB', () => {
      const file = {
        originalname: 'questions.csv',
        size: 6 * 1024 * 1024,
        buffer: Buffer.from(''),
      } as Express.Multer.File;

      expect(() => service.validateUploadedQuestionFile(file)).toThrow('5 MB');
    });

    it('should reject unsupported file extensions', () => {
      const file = {
        originalname: 'questions.pdf',
        size: 100,
        buffer: Buffer.from(''),
      } as Express.Multer.File;

      expect(() => service.validateUploadedQuestionFile(file)).toThrow(
        "couldn't read this file",
      );
    });

    it('should validate and import a valid CSV file', () => {
      const csv = [
        'Question Text,Question Type,Option A,Option B,Option C,Option D,Correct Answer',
        '"What is 1+1?","Multiple Choice","1","2","3","4","2"',
        '"Is the sky blue?","True/False","True","False","","","True"',
        '"Explain OOP","Short Answer","","","","","Encapsulation"',
        '"What is CSS?","Multiple Choice","Styling","Logic","Data","Storage","Styling"',
        '"HTML is markup?","True/False","True","False","","","True"',
      ].join('\n');

      const file = {
        originalname: 'questions.csv',
        size: Buffer.byteLength(csv),
        buffer: Buffer.from(csv),
      } as Express.Multer.File;

      const result = service.validateUploadedQuestionFile(file);

      expect(result.status).toBe('success');
      expect(result.questionCount).toBe(5);
      expect(result.questions[0].questionText).toBe('What is 1+1?');
      expect(result.questions[0].correctAnswer).toBe('2');
    });

    it('should validate and import a valid XLSX file', () => {
      const xlsx = service.getTemplateXlsx();
      const file = {
        originalname: 'questions.xlsx',
        size: xlsx.length,
        buffer: xlsx,
      } as Express.Multer.File;

      const result = service.validateUploadedQuestionFile(file);

      expect(result.status).toBe('success');
      expect(result.questionCount).toBeGreaterThan(0);
      expect(result.questions[0].questionText).toBe(
        'Which option best answers the question?',
      );
      expect(result.questions[0].questionType).toBe(
        EmployerQuestionType.MULTIPLE_CHOICE,
      );
    });

    it('should flag missing columns', () => {
      const csv = 'Question Text,Question Type\n"Q1","Multiple Choice"\n';

      const file = {
        originalname: 'questions.csv',
        size: Buffer.byteLength(csv),
        buffer: Buffer.from(csv),
      } as Express.Multer.File;

      expect(() => service.validateUploadedQuestionFile(file)).toThrow(
        'Missing required columns',
      );
    });

    it('should flag missing question text before missing correct answer', () => {
      const csv = [
        'Question Text,Question Type,Option A,Option B,Option C,Option D,Correct Answer',
        ',"Multiple Choice","A","B","C","D",',
      ].join('\n');

      const file = {
        originalname: 'questions.csv',
        size: Buffer.byteLength(csv),
        buffer: Buffer.from(csv),
      } as Express.Multer.File;

      expect(() => service.validateUploadedQuestionFile(file)).toThrow(
        'missing question text',
      );
    });

    it('should flag missing correct answer', () => {
      const csv = [
        'Question Text,Question Type,Option A,Option B,Option C,Option D,Correct Answer',
        '"What is 1+1?","Multiple Choice","1","2","3","4",',
      ].join('\n');

      const file = {
        originalname: 'questions.csv',
        size: Buffer.byteLength(csv),
        buffer: Buffer.from(csv),
      } as Express.Multer.File;

      expect(() => service.validateUploadedQuestionFile(file)).toThrow(
        'missing a correct answer',
      );
    });

    it('should flag unsupported question types', () => {
      const csv = [
        'Question Text,Question Type,Option A,Option B,Option C,Option D,Correct Answer',
        '"What is 1+1?","Essay","1","2","3","4","2"',
      ].join('\n');

      const file = {
        originalname: 'questions.csv',
        size: Buffer.byteLength(csv),
        buffer: Buffer.from(csv),
      } as Express.Multer.File;

      expect(() => service.validateUploadedQuestionFile(file)).toThrow(
        'unsupported question type',
      );
    });
  });

  // ─── listResults ───────────────────────────────────────────────────────────

  describe('getEmployerOverview', () => {
    const verified = () =>
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

    it('returns zeros when the employer has no assessments', async () => {
      verified();
      mockAssessmentRepo.find.mockResolvedValue([]);

      const result = await service.getEmployerOverview('emp-1');

      expect(result.last30Days.assessed).toBe(0);
      expect(result.recent).toEqual([]);
    });

    it('summarises the last 30 days and lists the latest completions', async () => {
      verified();
      mockAssessmentRepo.find.mockResolvedValue([
        { id: 'a-1', title: 'Frontend', is_active: true },
        { id: 'a-2', title: 'Backend', is_active: false },
      ]);
      mockSubmissionRepo.find.mockResolvedValue([
        {
          id: 's-1',
          assessment_id: 'a-1',
          candidate: { first_name: 'Ada', last_name: 'Obi' },
          score: 90,
          passed: true,
          integrity_level: 'clean',
          completed_at: daysAgo(1),
        },
        {
          id: 's-old',
          assessment_id: 'a-1',
          candidate: null,
          score: 10,
          passed: false,
          integrity_level: null,
          completed_at: daysAgo(60),
        },
      ]);
      mockExternalSubmissionRepo.find.mockResolvedValue([
        {
          id: 'e-1',
          assessment_id: 'a-2',
          external_applicant: { email: 'x@y.co' },
          score: 40,
          passed: false,
          integrity_level: 'flagged',
          submitted_at: daysAgo(2),
        },
      ]);

      const result = await service.getEmployerOverview('emp-1');

      expect(result.activeAssessments).toBe(1);
      expect(result.last30Days).toEqual({
        assessed: 2,
        passRate: 50,
        averageScore: 65,
        needsReview: 1,
      });
      expect(result.recent.map((r) => r.id)).toEqual(['s-1', 'e-1', 's-old']);
      expect(result.recent[1]).toMatchObject({
        assessmentTitle: 'Backend',
        email: 'x@y.co',
      });
    });
  });

  describe('listResults', () => {
    const verifiedEmployer = () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.findOne.mockResolvedValue({
        id: 'ass-1',
        employer_user_id: 'emp-1',
      });
    };

    const talentSubmission = (
      id: string,
      score: number,
      passed: boolean,
      first = 'John',
    ) => ({
      id,
      candidate_user_id: `u-${id}`,
      candidate: { first_name: first, last_name: 'Doe' },
      score,
      passed,
      time_taken_seconds: 600,
      completed_at: new Date('2026-01-02T00:00:00Z'),
      delivery_mode: EmployerAssessmentDeliveryMode.LINK,
    });

    const externalSubmission = (
      id: string,
      score: number,
      passed: boolean,
    ) => ({
      id,
      score,
      passed,
      external_applicant: { email: `${id}@mail.com` },
      submitted_at: new Date('2026-01-03T00:00:00Z'),
    });

    it('marks link takers who joined SkillSift with a verified account', async () => {
      verifiedEmployer();
      mockSubmissionRepo.find.mockResolvedValue([]);
      mockExternalSubmissionRepo.find.mockResolvedValue([
        externalSubmission('joined', 80, true),
        externalSubmission('guest', 50, false),
      ]);
      mockUserQb.getMany.mockResolvedValueOnce([
        { id: 'user-9', email: 'Joined@Mail.com' },
      ]);

      const result = await service.listResults('emp-1', 'ass-1', {});

      const byEmail = Object.fromEntries(
        result.submissions.map((r) => [r.email, r.joinedSkillsiftUserId]),
      );
      expect(byEmail['joined@mail.com']).toBe('user-9');
      expect(byEmail['guest@mail.com']).toBeNull();
      expect(mockUserQb.andWhere).toHaveBeenCalledWith(
        'user.is_verified = true',
      );
    });

    it('should return results filtered by pass/fail status', async () => {
      verifiedEmployer();
      mockSubmissionRepo.find.mockResolvedValue([
        talentSubmission('s1', 80, true),
        talentSubmission('s2', 40, false, 'Jane'),
      ]);
      mockExternalSubmissionRepo.find.mockResolvedValue([]);

      const result = await service.listResults('emp-1', 'ass-1', {
        status: 'pass',
      });

      expect(result.submissions[0].candidateName).toBe('John Doe');
      expect(result.submissions[0].status).toBe('pass');
      expect(result.total).toBe(1);
      expect(result.summary.total).toBe(2);
    });

    it('should include external takers, ranked together with talent', async () => {
      verifiedEmployer();
      mockSubmissionRepo.find.mockResolvedValue([
        talentSubmission('s1', 70, true),
      ]);
      mockExternalSubmissionRepo.find.mockResolvedValue([
        externalSubmission('e1', 90, true),
        externalSubmission('e2', 50, false),
      ]);

      const result = await service.listResults('emp-1', 'ass-1', {});

      expect(result.submissions.map((r) => r.id)).toEqual(['e1', 's1', 'e2']);
      expect(result.submissions[0]).toMatchObject({
        source: 'external',
        email: 'e1@mail.com',
        candidateName: null,
        rank: 1,
        percentile: 100,
      });
      expect(result.submissions[1].rank).toBe(2);
      expect(result.summary).toMatchObject({
        total: 3,
        averageScore: 70,
        medianScore: 70,
        topScore: 90,
        passRate: 67,
      });
    });

    it('should give tied scores the same rank and hide percentile under 3', async () => {
      verifiedEmployer();
      mockSubmissionRepo.find.mockResolvedValue([
        talentSubmission('s1', 80, true),
        talentSubmission('s2', 80, true),
      ]);
      mockExternalSubmissionRepo.find.mockResolvedValue([]);

      const result = await service.listResults('emp-1', 'ass-1', {});

      expect(result.submissions.map((r) => r.rank)).toEqual([1, 1]);
      expect(result.submissions[0].percentile).toBeNull();
    });

    it('should return empty state when no submissions exist', async () => {
      verifiedEmployer();
      mockSubmissionRepo.find.mockResolvedValue([]);
      mockExternalSubmissionRepo.find.mockResolvedValue([]);

      const result = await service.listResults('emp-1', 'ass-1', {});

      expect(result.emptyState).toContain('No submissions yet');
      expect(result.summary.averageScore).toBeNull();
    });
  });

  describe('server-side timing and integrity', () => {
    const assessment = {
      id: 'ass-1',
      is_active: true,
      share_token: 'token-abc',
      type: 'external',
      access_code: 'ABC123',
      passing_threshold: 60,
      time_limit_minutes: 10,
      employer_user_id: 'employer-1',
      questions: [
        {
          id: 'q-1',
          correct_answer: 'A',
          question_text: 'Q1',
          question_type: EmployerQuestionType.MULTIPLE_CHOICE,
        },
      ],
    };
    const secondsAgo = (n: number) => new Date(Date.now() - n * 1000);
    const submitDto = {
      externalApplicantId: 'app-1',
      responses: [
        { moduleId: 'ass-1', answers: [{ questionId: 'q-1', answer: 'A' }] },
      ],
    } as unknown as Parameters<typeof service.submitExternalAssessment>[2];

    beforeEach(() => {
      mockAssessmentRepo.findOne.mockResolvedValue(assessment);
      mockExternalSubmissionRepo.findOne.mockResolvedValue(null);
      mockExternalSubmissionRepo.save.mockImplementation(
        async (data: Record<string, unknown>) => ({ id: 'sub-1', ...data }),
      );
      mockExternalApplicantRepo.count.mockResolvedValue(0);
      mockEmployerProfileRepo.findOne.mockResolvedValue(null);
      mockUserRepo.findOne.mockResolvedValue(null);
    });

    it('measures external time from registration, not from the client', async () => {
      mockExternalApplicantRepo.findOne.mockResolvedValue({
        id: 'app-1',
        email: 'a@b.co',
        ip_hash: null,
        created_at: secondsAgo(120),
        session_expires_at: new Date(Date.now() + 100000),
      });

      await service.submitExternalAssessment('token-abc', 'sess', {
        ...submitDto,
        integrity: {
          tabSwitches: 0,
          awaySeconds: 0,
          pasteAttempts: 0,
          copyAttempts: 0,
        },
      } as typeof submitDto);

      const saved = mockExternalSubmissionRepo.save.mock.calls[0][0] as {
        time_taken_seconds: number;
        integrity_level: string;
      };
      expect(saved.time_taken_seconds).toBeGreaterThanOrEqual(119);
      expect(saved.time_taken_seconds).toBeLessThanOrEqual(122);
      expect(saved.integrity_level).toBe('clean');
    });

    it('flags an external submission finished impossibly fast', async () => {
      mockExternalApplicantRepo.findOne.mockResolvedValue({
        id: 'app-1',
        email: 'a@b.co',
        ip_hash: null,
        created_at: secondsAgo(1),
        session_expires_at: new Date(Date.now() + 100000),
      });

      await service.submitExternalAssessment('token-abc', 'sess', submitDto);

      const saved = mockExternalSubmissionRepo.save.mock.calls[0][0] as {
        integrity_level: string;
      };
      expect(saved.integrity_level).toBe('flagged');
    });

    it('marks a shared network for review, never flagged on its own', async () => {
      mockExternalApplicantRepo.findOne.mockResolvedValue({
        id: 'app-1',
        email: 'a@b.co',
        ip_hash: 'hash',
        created_at: secondsAgo(120),
        session_expires_at: new Date(Date.now() + 100000),
      });
      mockExternalApplicantRepo.count.mockResolvedValue(2);

      await service.submitExternalAssessment('token-abc', 'sess', submitDto);

      const saved = mockExternalSubmissionRepo.save.mock.calls[0][0] as {
        integrity_level: string;
      };
      expect(saved.integrity_level).toBe('review');
    });

    it('turns away a candidate with the wrong access code', async () => {
      await expect(
        service.registerExternalApplicant('token-abc', {
          email: 'x@y.co',
          consentedMarketing: false,
          fullName: 'Test Taker',
          accessCode: 'WRONG1',
        }),
      ).rejects.toThrow('access code');
      expect(mockExternalApplicantRepo.save).not.toHaveBeenCalled();
      expect(mockBilling.spendInvites).not.toHaveBeenCalled();
    });

    it('stores the name and releases the questions after a correct sign in', async () => {
      mockExternalApplicantRepo.findOne.mockResolvedValue(null);
      mockExternalApplicantRepo.save.mockImplementation(
        async (data: Record<string, unknown>) => ({
          id: 'app-1',
          created_at: new Date(),
          ...data,
        }),
      );
      const result = await service.registerExternalApplicant('token-abc', {
        email: 'x@y.co',
        consentedMarketing: false,
        fullName: '  Ada   Lovelace ',
        accessCode: 'abc123',
      });
      const saved = mockExternalApplicantRepo.save.mock.calls[0][0] as {
        full_name: string;
      };
      expect(saved.full_name).toBe('Ada Lovelace');
      expect(Array.isArray(result.questions)).toBe(true);
    });

    it('stores only a hash of the applicant ip on registration', async () => {
      mockExternalApplicantRepo.findOne.mockResolvedValue(null);
      mockExternalApplicantRepo.save.mockImplementation(
        async (data: Record<string, unknown>) => ({
          id: 'app-1',
          created_at: new Date(),
          ...data,
        }),
      );

      const result = await service.registerExternalApplicant(
        'token-abc',
        {
          email: 'A@B.co',
          consentedMarketing: false,
          fullName: 'Test Taker',
          accessCode: 'abc123',
        },
        '203.0.113.9',
      );

      const saved = mockExternalApplicantRepo.save.mock.calls[0][0] as {
        ip_hash: string;
      };
      expect(saved.ip_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(saved.ip_hash).not.toContain('203.0.113.9');
      expect(result.remaining_seconds).toBe(600);
      expect(result.submitted).toBe(false);
    });

    it('resumes a returning applicant with the time left', async () => {
      mockExternalApplicantRepo.findOne.mockResolvedValue({
        id: 'app-1',
        email: 'a@b.co',
        session_token: 'sess',
        created_at: secondsAgo(100),
      });

      const result = await service.registerExternalApplicant('token-abc', {
        email: 'a@b.co',
        consentedMarketing: false,
        fullName: 'Test Taker',
        accessCode: 'ABC123',
      });

      expect(result.remaining_seconds).toBeGreaterThanOrEqual(498);
      expect(result.remaining_seconds).toBeLessThanOrEqual(500);
    });

    it('starts a talent attempt once and resumes it afterwards', async () => {
      mockSubmissionRepo.count.mockResolvedValue(0);
      const startedAt = secondsAgo(60);
      mockAttemptRepo.findOne.mockResolvedValueOnce(null);
      mockAttemptRepo.save.mockResolvedValue({ started_at: startedAt });

      const first = await service.startAssessment('cand-1', 'token-abc');
      expect(mockAttemptRepo.save).toHaveBeenCalledTimes(1);
      expect(first.time_limit_seconds).toBe(600);

      mockAttemptRepo.findOne.mockResolvedValueOnce({ started_at: startedAt });
      const again = await service.startAssessment('cand-1', 'token-abc');
      expect(mockAttemptRepo.save).toHaveBeenCalledTimes(1);
      expect(again.remaining_seconds).toBeLessThanOrEqual(540);
    });

    it('blocks talent who were not invited to an internal assessment', async () => {
      mockAssessmentRepo.findOne.mockResolvedValue({
        id: 'a1',
        share_token: 'token-abc',
        is_active: true,
        type: 'internal',
        time_limit_minutes: 10,
      });
      mockInviteRepo.count.mockResolvedValue(0);
      await expect(
        service.startAssessment('cand-1', 'token-abc'),
      ).rejects.toThrow('only open to talent');
      await expect(
        service.submitAssessment('cand-1', 'token-abc', {
          timeTakenSeconds: 300,
          deliveryMode: EmployerAssessmentDeliveryMode.LINK,
          answers: {},
        }),
      ).rejects.toThrow('only open to talent');
      expect(mockAttemptRepo.save).not.toHaveBeenCalled();
    });

    it('refuses to start an already submitted talent assessment', async () => {
      mockSubmissionRepo.count.mockResolvedValue(1);
      await expect(
        service.startAssessment('cand-1', 'token-abc'),
      ).rejects.toThrow('already submitted');
    });
  });

  describe('invite metering', () => {
    const externalAssessment = {
      id: 'ass-1',
      is_active: true,
      type: 'external',
      share_token: 'token-abc',
      access_code: 'ABC123',
      questions: [],
      employer_user_id: 'employer-1',
      time_limit_minutes: 10,
    };

    beforeEach(() => {
      mockBilling.spendInvites.mockResolvedValue({ invites_remaining: 9 });
      mockAssessmentRepo.findOne.mockResolvedValue(externalAssessment);
      mockExternalApplicantRepo.findOne.mockResolvedValue(null);
      mockExternalApplicantRepo.save.mockImplementation(
        async (data: Record<string, unknown>) => ({
          id: 'app-1',
          created_at: new Date(),
          ...data,
        }),
      );
    });

    it('charges one invite when an uninvited candidate starts via the link', async () => {
      mockExternalInviteRepo.findOne.mockResolvedValue(null);

      await service.registerExternalApplicant('token-abc', {
        email: 'new@x.co',
        consentedMarketing: false,
        fullName: 'Test Taker',
        accessCode: 'ABC123',
      });

      expect(mockBilling.spendInvites).toHaveBeenCalledWith('employer-1', 1);
    });

    it('does not charge again for a candidate who was invited by email', async () => {
      mockExternalInviteRepo.findOne.mockResolvedValue({ id: 'inv-1' });

      await service.registerExternalApplicant('token-abc', {
        email: 'invited@x.co',
        consentedMarketing: false,
        fullName: 'Test Taker',
        accessCode: 'ABC123',
      });

      expect(mockBilling.spendInvites).not.toHaveBeenCalled();
    });

    it('turns candidates away politely when the employer is out of invites', async () => {
      mockExternalInviteRepo.findOne.mockResolvedValue(null);
      mockBilling.spendInvites.mockRejectedValue(
        new PaymentRequiredError('No invites left'),
      );

      await expect(
        service.registerExternalApplicant('token-abc', {
          email: 'late@x.co',
          consentedMarketing: false,
          fullName: 'Test Taker',
          accessCode: 'ABC123',
        }),
      ).rejects.toThrow("isn't taking new candidates");
      expect(mockExternalApplicantRepo.save).not.toHaveBeenCalled();
    });

    it('charges per new email, skips repeats, and refunds bounced emails', async () => {
      mockExternalInviteRepo.find.mockResolvedValue([{ email: 'old@x.co' }]);
      mockExternalInviteRepo.save.mockResolvedValue([]);
      mockUserRepo.findOne.mockResolvedValue({
        id: 'employer-1',
        is_verified: true,
      });
      mockMailService.send
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('bounce'));

      const result = await service.inviteAssessment('employer-1', 'ass-1', {
        emails: ['old@x.co', 'a@x.co', 'b@x.co'],
      } as Parameters<typeof service.inviteAssessment>[2]);

      expect(mockBilling.spendInvites).toHaveBeenCalledWith('employer-1', 2);
      expect(mockBilling.refundInvites).toHaveBeenCalledWith('employer-1', 1);
      expect(result.invited_count).toBe(1);
    });

    it('only invites job-ready talent who finished the job evaluation', async () => {
      mockAssessmentRepo.findOne.mockResolvedValue({
        id: 'ass-1',
        type: 'internal',
        title: 'T',
      });
      mockUserRepo.findOne.mockResolvedValue({
        id: 'employer-1',
        is_verified: true,
      });
      mockInviteRepo.find.mockResolvedValue([]);
      mockInviteRepo.save.mockResolvedValue([]);
      (mockUserRepo as unknown as { findBy: jest.Mock }).findBy = jest
        .fn()
        .mockResolvedValue([{ id: 'talent-ok' }]);
      const rows = [{ id: 'talent-ok' }];
      const qb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      (
        mockPoolProfileRepo as unknown as { createQueryBuilder: jest.Mock }
      ).createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.inviteAssessment('employer-1', 'ass-1', {
        talentIds: ['talent-ok', 'talent-unfinished'],
      } as Parameters<typeof service.inviteAssessment>[2]);

      expect(result.invited_count).toBe(1);
      expect(result.failed).toEqual([
        { target: 'talent-unfinished', reason: 'Talent not found' },
      ]);
      expect(mockBilling.spendInvites).toHaveBeenCalledWith('employer-1', 1);
    });

    it('sends nothing when the employer cannot cover the batch', async () => {
      mockExternalInviteRepo.find.mockResolvedValue([]);
      mockUserRepo.findOne.mockResolvedValue({
        id: 'employer-1',
        is_verified: true,
      });
      mockBilling.spendInvites.mockRejectedValue(
        new PaymentRequiredError('Not enough invites'),
      );
      mockMailService.send.mockClear();

      await expect(
        service.inviteAssessment('employer-1', 'ass-1', {
          emails: ['a@x.co'],
        } as Parameters<typeof service.inviteAssessment>[2]),
      ).rejects.toThrow('Not enough invites');
      expect(mockMailService.send).not.toHaveBeenCalled();
      expect(mockExternalInviteRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getResultDetail', () => {
    it('should mark each question right or wrong for an external taker', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.findOne.mockResolvedValue({
        id: 'ass-1',
        employer_user_id: 'emp-1',
        questions: [
          {
            id: 'q2',
            position: 2,
            question_text: 'Second',
            question_type: 'true_false',
            options: null,
            correct_answer: 'false',
          },
          {
            id: 'q1',
            position: 1,
            question_text: 'First',
            question_type: 'multiple_choice',
            options: ['a', 'b'],
            correct_answer: 'a',
          },
        ],
      });
      mockSubmissionRepo.find.mockResolvedValue([]);
      const external = {
        id: 'e1',
        score: 50,
        passed: false,
        external_applicant: { email: 'x@mail.com' },
        submitted_at: new Date(),
        responses: [
          {
            answers: [
              { questionId: 'q1', answer: 'a' },
              { questionId: 'q2', answer: 'true' },
            ],
          },
        ],
      };
      mockExternalSubmissionRepo.find.mockResolvedValue([external]);
      mockExternalSubmissionRepo.findOne.mockResolvedValue(external);

      const result = await service.getResultDetail('emp-1', 'ass-1', 'e1');

      expect(result.questions.map((q) => q.questionId)).toEqual(['q1', 'q2']);
      expect(result.questions.map((q) => q.isCorrect)).toEqual([true, false]);
      expect(result.correctCount).toBe(1);
      expect(result.questionCount).toBe(2);
    });

    it('hides the correct answer for library assessments but still marks right and wrong', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.findOne.mockResolvedValue({
        id: 'ass-1',
        employer_user_id: 'emp-1',
        question_source: EmployerAssessmentQuestionSource.CREDLANE_BANK,
        questions: [
          {
            id: 'q1',
            position: 1,
            question_text: 'First',
            question_type: 'multiple_choice',
            options: ['a', 'b'],
            correct_answer: 'a',
          },
        ],
      });
      mockSubmissionRepo.find.mockResolvedValue([]);
      const external = {
        id: 'e1',
        score: 0,
        passed: false,
        external_applicant: { email: 'x@mail.com' },
        submitted_at: new Date(),
        responses: [{ answers: [{ questionId: 'q1', answer: 'b' }] }],
      };
      mockExternalSubmissionRepo.find.mockResolvedValue([external]);
      mockExternalSubmissionRepo.findOne.mockResolvedValue(external);

      const result = await service.getResultDetail('emp-1', 'ass-1', 'e1');

      expect(result.questions[0].isCorrect).toBe(false);
      expect(result.questions[0].correctAnswer).toBeNull();
    });

    it('should 404 when the submission is not on this assessment', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.findOne.mockResolvedValue({
        id: 'ass-1',
        employer_user_id: 'emp-1',
        questions: [],
      });
      mockSubmissionRepo.find.mockResolvedValue([]);
      mockExternalSubmissionRepo.find.mockResolvedValue([]);

      await expect(
        service.getResultDetail('emp-1', 'ass-1', 'nope'),
      ).rejects.toThrow('Submission not found');
    });
  });

  // ─── listAssessments ───────────────────────────────────────────────────────

  describe('listAssessments', () => {
    it('should return assessments and no empty state when assessments exist', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.find.mockResolvedValue([
        {
          id: 'ass-1',
          employer_user_id: 'emp-1',
          title: 'Frontend Assessment',
          created_at: new Date('2026-05-01T00:00:00.000Z'),
          questions: [{ id: 'q-1', position: 1 }],
        },
        {
          id: 'ass-2',
          employer_user_id: 'emp-1',
          title: 'Backend Assessment',
          created_at: new Date('2026-05-02T00:00:00.000Z'),
          questions: [{ id: 'q-2', position: 1 }],
        },
      ]);

      jest
        .spyOn(
          service as unknown as { loadAssessmentStats: () => Promise<unknown> },
          'loadAssessmentStats',
        )
        .mockResolvedValue(
          new Map([
            [
              'ass-1',
              {
                talents: 4,
                submissions: 2,
                passed: 1,
                lastActivityAt: new Date('2026-05-03T00:00:00.000Z'),
              },
            ],
          ]),
        );

      const result = await service.listAssessments('emp-1');

      expect(result.assessments).toHaveLength(2);
      expect(result.assessments[0]).toMatchObject({
        submission_count: 2,
        talents_count: 4,
        pass_rate: 50,
      });
      expect(result.assessments[1]).toMatchObject({
        submission_count: 0,
        talents_count: 0,
        pass_rate: null,
        last_activity_at: null,
      });
      expect(result.emptyState).toBeNull();
      expect(mockAssessmentRepo.find).toHaveBeenCalledWith({
        where: { employer_user_id: 'emp-1' },
        order: { created_at: 'DESC' },
        relations: ['questions'],
      });
    });

    it('should return empty state when no assessments exist', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.find.mockResolvedValue([]);

      const result = await service.listAssessments('emp-1');

      expect(result.emptyState).toContain('No assessments yet');
      expect(result.assessments).toHaveLength(0);
    });
  });

  // ─── searchCandidates ─────────────────────────────────────────────────────

  describe('searchCandidates', () => {
    const createQueryBuilderMock = () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            candidateUserId: 'candidate-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
          },
          {
            candidateUserId: 'candidate-2',
            firstName: 'Grace',
            lastName: 'Hopper',
            email: 'grace@example.com',
          },
        ]),
      };
      mockSavedCandidateRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    };

    it('should search shortlisted candidates with ILIKE, ordering, and pagination', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      const qb = createQueryBuilderMock();

      const result = await service.searchCandidates('emp-1', {
        search: 'ada',
        page: 2,
        limit: 10,
      });

      expect(result).toEqual({
        candidates: [
          {
            candidateUserId: 'candidate-1',
            fullName: 'Ada L.',
          },
          {
            candidateUserId: 'candidate-2',
            fullName: 'Grace H.',
          },
        ],
        total: 2,
        page: 2,
        limit: 10,
        totalPages: 1,
      });
      expect(mockSavedCandidateRepo.createQueryBuilder).toHaveBeenCalledWith(
        'saved',
      );
      expect(qb.innerJoin).toHaveBeenCalledWith(
        User,
        'u',
        'u.id = saved.candidate_user_id',
      );
      expect(qb.where).toHaveBeenCalledWith(
        'saved.employer_user_id = :employerUserId',
        { employerUserId: 'emp-1' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE :search'),
        { search: '%ada%' },
      );
      expect(qb.orderBy).toHaveBeenCalledWith('saved.created_at', 'DESC');
      expect(qb.offset).toHaveBeenCalledWith(10);
      expect(qb.limit).toHaveBeenCalledWith(10);
      expect(qb.getCount).toHaveBeenCalledTimes(1);
      expect(qb.getRawMany).toHaveBeenCalledTimes(1);
    });

    it('should reject unverified employers before searching candidates', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: false,
      });

      await expect(service.searchCandidates('emp-1', {})).rejects.toThrow(
        'Only verified employers',
      );
      expect(mockSavedCandidateRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ─── getTemplateCsv ────────────────────────────────────────────────────────

  describe('getTemplateCsv', () => {
    it('should return CSV with all required columns', () => {
      const csv = service.getTemplateCsv();
      const header = csv.split('\n')[0];

      expect(header).toContain('Question Text');
      expect(header).toContain('Question Type');
      expect(header).toContain('Option A');
      expect(header).toContain('Option B');
      expect(header).toContain('Option C');
      expect(header).toContain('Option D');
      expect(header).toContain('Correct Answer');
    });
  });

  // ─── getTemplateXlsx ───────────────────────────────────────────────────────

  describe('getTemplateXlsx', () => {
    it('should return a valid XLSX buffer', () => {
      const result = service.getTemplateXlsx();

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      // XLSX files start with the ZIP magic number PK\x03\x04
      expect(result.readUInt32LE(0)).toBe(0x04034b50);
    });
  });

  // ─── indexToColumnName (via XLSX output) ───────────────────────────────────

  describe('XLSX column naming', () => {
    it('should produce correct column refs in generated XLSX', () => {
      // Access private method through the XLSX output
      // The template has 7 columns (A-G), verify they appear in output
      const xlsxBuffer = service.getTemplateXlsx();
      const content = xlsxBuffer.toString('utf8');

      // Columns A through G should be present in cell refs
      expect(content).toContain('r="A1"');
      expect(content).toContain('r="G1"');
    });
  });

  describe('XLSX sheet relationship resolution', () => {
    it('should ignore unsafe relationship ids and use the default sheet', () => {
      const resolveFirstSheetPath = (
        service as unknown as {
          resolveFirstSheetPath: (
            workbookXml: string | undefined,
            relsXml: string | undefined,
          ) => string;
        }
      ).resolveFirstSheetPath.bind(service);

      const workbookXml =
        '<workbook><sheets><sheet name="Questions" sheetId="1" r:id="rId1.*"/></sheets></workbook>';
      const relsXml =
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';

      expect(resolveFirstSheetPath(workbookXml, relsXml)).toBe(
        'xl/worksheets/sheet1.xml',
      );
    });
  });

  // ─── listCredlaneCatalogue ──────────────────────────────────────────────────

  describe('listCredlaneCatalogue', () => {
    const entry = (
      id: string,
      level = EmployerAssessmentExperienceLevel.JUNIOR,
    ) => ({
      id,
      title: 'Frontend – Mid',
      description: 'Basics',
      estimated_completion_time: '20 minutes',
      role_track: 'frontend_developer',
      experience_level: level,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    beforeEach(() => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
    });

    it('lists usable entries with a question count and no internal fields', async () => {
      mockCatalogueRepo.find.mockResolvedValue([entry('cat-1')]);
      mockCatalogueQuestionQb.getRawMany.mockResolvedValue([
        { id: 'cat-1', count: '8' },
      ]);

      const result = await service.listCredlaneCatalogue('emp-1', 1, 20);

      expect(result.catalogue).toEqual([
        {
          id: 'cat-1',
          title: 'Frontend – Mid',
          description: 'Basics',
          estimated_completion_time: '20 minutes',
          role_track: 'frontend_developer',
          experience_level: EmployerAssessmentExperienceLevel.JUNIOR,
          question_count: 8,
        },
      ]);
      expect(result.total).toBe(1);
    });

    it('hides entries that do not have enough questions yet', async () => {
      mockCatalogueRepo.find.mockResolvedValue([
        entry('cat-1'),
        entry('cat-2'),
      ]);
      mockCatalogueQuestionQb.getRawMany.mockResolvedValue([
        { id: 'cat-1', count: '4' },
      ]);

      const result = await service.listCredlaneCatalogue('emp-1', 1, 20);

      expect(result.catalogue).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('filters by track and level', async () => {
      mockCatalogueRepo.find.mockResolvedValue([]);

      await service.listCredlaneCatalogue('emp-1', 1, 20, {
        roleTrack: 'frontend_developer',
        experienceLevel: EmployerAssessmentExperienceLevel.MID,
      });

      expect(mockCatalogueRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            is_active: true,
            role_track: 'frontend_developer',
            experience_level: EmployerAssessmentExperienceLevel.MID,
          },
        }),
      );
    });

    it('should reject unverified employers', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: false,
      });

      await expect(
        service.listCredlaneCatalogue('emp-1', 1, 20),
      ).rejects.toThrow('Only verified employers');
    });
  });

  describe('getCredlaneCatalogueEntry', () => {
    const questions = Array.from({ length: 5 }, (_, i) => ({
      position: i + 1,
      question_text: `Q${i + 1}`,
      question_type: 'multiple_choice',
      options: ['a', 'b', 'c', 'd'],
      correct_answer: 'a',
    }));

    beforeEach(() => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
    });

    it('returns the questions without any answer key', async () => {
      mockCatalogueRepo.findOne.mockResolvedValue({
        id: 'cat-1',
        title: 'T',
        description: null,
        estimated_completion_time: '20 minutes',
        role_track: 'frontend_developer',
        experience_level: EmployerAssessmentExperienceLevel.MID,
      });
      mockCatalogueQuestionRepo.find.mockResolvedValue(questions);

      const result = await service.getCredlaneCatalogueEntry('emp-1', 'cat-1');

      expect(result.question_count).toBe(5);
      expect(result.questions[0]).toEqual({
        position: 1,
        questionText: 'Q1',
        questionType: 'multiple_choice',
        options: ['a', 'b', 'c', 'd'],
      });
      expect(JSON.stringify(result)).not.toContain('correct');
    });

    it('404s for a missing or too-small entry', async () => {
      mockCatalogueRepo.findOne.mockResolvedValue({ id: 'cat-1' });
      mockCatalogueQuestionRepo.find.mockResolvedValue(questions.slice(0, 3));

      await expect(
        service.getCredlaneCatalogueEntry('emp-1', 'cat-1'),
      ).rejects.toThrow('Library assessment not found');
    });
  });

  // ─── createAssessment with credlane_bank ────────────────────────────────────

  describe('createAssessment (credlane_bank validation)', () => {
    const credlaneBankDto = {
      title: 'Backend Assessment',
      type: EmployerAssessmentType.EXTERNAL,
      roleTrack: 'backend_developer' as TalentRoleTrack,
      experienceLevel: EmployerAssessmentExperienceLevel.MID,
      timeLimitMinutes: 30,
      passingThreshold: 70,
      questionSource: EmployerAssessmentQuestionSource.CREDLANE_BANK,
      shareViaLink: true,
      sendToCandidates: false,
    };

    it('should reject when credlaneAssessmentId is missing for credlane_bank source', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockCatalogueRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createAssessment('emp-1', credlaneBankDto),
      ).rejects.toThrow('was not found or is no longer available');
    });

    it('should reject when credlaneAssessmentId does not exist in catalogue', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockCatalogueRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createAssessment('emp-1', {
          ...credlaneBankDto,
          credlaneAssessmentId: '00000000-0000-0000-0000-000000000001',
        }),
      ).rejects.toThrow('was not found or is no longer available');
    });

    it('should reject when catalogue item role_track does not match dto', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockCatalogueRepo.findOne.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        role_track: 'frontend_developer',
        experience_level: EmployerAssessmentExperienceLevel.MID,
        is_active: true,
      });

      await expect(
        service.createAssessment('emp-1', {
          ...credlaneBankDto,
          credlaneAssessmentId: '00000000-0000-0000-0000-000000000001',
        }),
      ).rejects.toThrow('does not match the specified role track');
    });

    it('should reject when catalogue item experience_level does not match dto', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockCatalogueRepo.findOne.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        role_track: 'backend_developer',
        experience_level: EmployerAssessmentExperienceLevel.SENIOR,
        is_active: true,
      });

      await expect(
        service.createAssessment('emp-1', {
          ...credlaneBankDto,
          credlaneAssessmentId: '00000000-0000-0000-0000-000000000001',
        }),
      ).rejects.toThrow('does not match the specified role track');
    });

    it('should reject a library assessment with too few questions', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockCatalogueRepo.findOne.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        role_track: 'backend_developer',
        experience_level: EmployerAssessmentExperienceLevel.MID,
        is_active: true,
      });
      mockCatalogueQuestionRepo.find.mockResolvedValue([
        {
          question_text: 'Only one',
          question_type: 'multiple_choice',
          options: ['A', 'B'],
          correct_answer: 'A',
          position: 1,
        },
      ]);

      await expect(
        service.createAssessment('emp-1', {
          ...credlaneBankDto,
          credlaneAssessmentId: '00000000-0000-0000-0000-000000000001',
        }),
      ).rejects.toThrow('does not have enough questions');
    });

    it('should reject asking for more questions than the library entry has', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockCatalogueRepo.findOne.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        role_track: 'backend_developer',
        experience_level: EmployerAssessmentExperienceLevel.MID,
        is_active: true,
      });
      mockCatalogueQuestionRepo.find.mockResolvedValue(
        Array.from({ length: 6 }, (_, i) => ({
          question_text: `Library Q${i + 1}`,
          question_type: 'multiple_choice',
          options: ['A', 'B', 'C', 'D'],
          correct_answer: 'A',
          position: i + 1,
        })),
      );

      await expect(
        service.createAssessment('emp-1', {
          ...credlaneBankDto,
          credlaneAssessmentId: '00000000-0000-0000-0000-000000000001',
          questionCount: 10,
        }),
      ).rejects.toThrow('only has 6 questions');
    });

    it('should copy only the requested number of library questions, in library order', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockCatalogueRepo.findOne.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        role_track: 'backend_developer',
        experience_level: EmployerAssessmentExperienceLevel.MID,
        is_active: true,
      });
      mockCatalogueQuestionRepo.find.mockResolvedValue(
        Array.from({ length: 12 }, (_, i) => ({
          question_text: `Library Q${i + 1}`,
          question_type: 'multiple_choice',
          options: ['A', 'B', 'C', 'D'],
          correct_answer: 'A',
          position: i + 1,
        })),
      );
      const lockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'emp-1', is_verified: true }),
      };
      const save = jest
        .fn()
        .mockResolvedValueOnce({
          id: 'assessment-3',
          employer_user_id: 'emp-1',
          share_token: 'tok',
          is_active: true,
        })
        .mockResolvedValueOnce([]);
      mockAssessmentRepo.manager.transaction.mockImplementation(
        async (cb: (manager: unknown) => Promise<unknown>) =>
          cb({
            getRepository: jest.fn().mockReturnValue({
              createQueryBuilder: jest.fn().mockReturnValue(lockQueryBuilder),
            }),
            count: jest.fn().mockResolvedValue(0),
            save,
          }),
      );

      await service.createAssessment('emp-1', {
        ...credlaneBankDto,
        credlaneAssessmentId: '00000000-0000-0000-0000-000000000001',
        questionCount: 7,
      });

      const copied = save.mock.calls[1][1] as Array<{
        question_text: string;
        position: number;
      }>;
      expect(copied).toHaveLength(7);
      expect(copied.map((q) => q.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      const sourceNumbers = copied.map((q) =>
        Number(q.question_text.replace('Library Q', '')),
      );
      expect(sourceNumbers).toEqual([...sourceNumbers].sort((a, b) => a - b));
      expect(new Set(sourceNumbers).size).toBe(7);
    });

    it('should create an assessment from credlane_bank with valid catalogue item', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockCatalogueRepo.findOne.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        role_track: 'backend_developer',
        experience_level: EmployerAssessmentExperienceLevel.MID,
        is_active: true,
      });
      mockCatalogueQuestionRepo.find.mockResolvedValue(
        Array.from({ length: 8 }, (_, i) => ({
          question_text: `Library Q${i + 1}`,
          question_type: 'multiple_choice',
          options: ['A', 'B', 'C', 'D'],
          correct_answer: 'A',
          position: i + 1,
        })),
      );
      const lockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'emp-1',
          is_verified: true,
        }),
      };
      mockAssessmentRepo.manager.transaction.mockImplementation(
        async (cb: (manager: unknown) => Promise<unknown>) => {
          const manager = {
            getRepository: jest.fn().mockReturnValue({
              createQueryBuilder: jest.fn().mockReturnValue(lockQueryBuilder),
            }),
            count: jest.fn().mockResolvedValue(0),
            save: jest
              .fn()
              .mockResolvedValueOnce({
                id: 'assessment-2',
                employer_user_id: 'emp-1',
                title: credlaneBankDto.title,
                credlane_assessment_id: '00000000-0000-0000-0000-000000000001',
                share_token: 'xyz456',
                is_active: true,
              })
              .mockResolvedValueOnce([]),
          };
          return cb(manager);
        },
      );

      const result = await service.createAssessment('emp-1', {
        ...credlaneBankDto,
        credlaneAssessmentId: '00000000-0000-0000-0000-000000000001',
      });

      expect(result.id).toBe('assessment-2');
      expect(mockCatalogueRepo.findOne).toHaveBeenCalledWith({
        where: {
          id: '00000000-0000-0000-0000-000000000001',
          is_active: true,
        },
      });
      expect(mockCatalogueQuestionRepo.find).toHaveBeenCalledWith({
        where: {
          catalogue_assessment_id: '00000000-0000-0000-0000-000000000001',
        },
        order: { position: 'ASC' },
      });
    });
  });
});
