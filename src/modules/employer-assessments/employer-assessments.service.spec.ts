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
import { AssessmentQuestion } from '../assessments/entities/assessment-question.entity';
import { EmployerSavedCandidate } from '../employer-discovery/entities/employer-saved-candidate.entity';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { EmployerRole } from '../employer-roles/entities/employer-role.entity';
import { User } from '../users/entities/user.entity';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { Offer, OfferStatus } from '../offers/entities/offer.entity';
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
  const mockInviteRepo = { save: jest.fn() };

  const mockSubmissionRepo = {
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    }),
  };

  const mockBankQuestionRepo = { find: jest.fn() };
  const mockSavedCandidateRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockPoolProfileRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockUserRepo = {
    findOne: jest.fn(),
    findBy: jest.fn(),
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

  const mockExternalApplicantRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockExternalInviteRepo = {
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockExternalSubmissionRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockNotificationDispatch = {
    dispatch: jest.fn(),
    notifyAssessmentPassed: jest.fn(),
    notifyAssessmentFailed: jest.fn(),
  };

  const mockMailService = {
    send: jest.fn(),
  };

  const mockCatalogueRepo = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
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
          provide: getRepositoryToken(AssessmentQuestion),
          useValue: mockBankQuestionRepo,
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
      expect(result.shareUrl).toContain('/assessments/token-abc');
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

  describe('listResults', () => {
    it('should return results filtered by pass/fail status', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.findOne.mockResolvedValue({
        id: 'ass-1',
        employer_user_id: 'emp-1',
      });

      const submissions = [
        {
          id: 'sub-1',
          candidate_user_id: 'c-1',
          candidate: { first_name: 'John', last_name: 'Doe' },
          score: 80,
          passed: true,
          time_taken_seconds: 600,
          completed_at: new Date(),
          delivery_mode: EmployerAssessmentDeliveryMode.LINK,
        },
      ];
      mockSubmissionRepo.findAndCount.mockResolvedValue([submissions, 1]);

      const result = await service.listResults('emp-1', 'ass-1', {
        status: 'pass',
      });

      expect(result.submissions[0].candidateName).toBe('John Doe');
      expect(result.submissions[0].status).toBe('pass');
      expect(result.total).toBe(1);
    });

    it('should return empty state when no submissions exist', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      mockAssessmentRepo.findOne.mockResolvedValue({
        id: 'ass-1',
        employer_user_id: 'emp-1',
      });
      mockSubmissionRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.listResults('emp-1', 'ass-1', {});

      expect(result.emptyState).toContain('No submissions yet');
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

      const result = await service.listAssessments('emp-1');

      expect(result.assessments).toHaveLength(2);
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
            fullName: 'Ada Lovelace',
            email: 'ada@example.com',
          },
          {
            candidateUserId: 'candidate-2',
            fullName: 'Grace Hopper',
            email: 'grace@example.com',
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
    it('should return paginated catalogue entries mapped to DTO shape', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'emp-1',
        is_verified: true,
      });
      const entries = [
        {
          id: 'cat-1',
          title: 'Backend – Junior',
          description: 'Basics',
          estimated_completion_time: '20 minutes',
          role_track: 'backend_developer',
          experience_level: EmployerAssessmentExperienceLevel.JUNIOR,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];
      mockCatalogueRepo.findAndCount.mockResolvedValue([entries, 1]);

      const result = await service.listCredlaneCatalogue('emp-1', 1, 20);

      expect(result.catalogue).toHaveLength(1);
      expect(result.catalogue[0]).toEqual({
        id: 'cat-1',
        title: 'Backend – Junior',
        description: 'Basics',
        estimated_completion_time: '20 minutes',
        role_track: 'backend_developer',
        experience_level: EmployerAssessmentExperienceLevel.JUNIOR,
      });
      // Should not expose internal fields
      expect(result.catalogue[0]).not.toHaveProperty('is_active');
      expect(result.catalogue[0]).not.toHaveProperty('created_at');
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
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
      mockBankQuestionRepo.find.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          question_text: `Bank Q${i + 1}`,
          question_type: 'multiple_choice',
          options: ['A', 'B', 'C', 'D'],
          correct_answer: 'A',
          question_number: i + 1,
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
      expect(mockBankQuestionRepo.find).toHaveBeenCalled();
    });
  });
});
