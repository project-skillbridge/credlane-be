import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmployerAssessment } from '../employer-assessments/entities/employer-assessment.entity';
import {
  EmployerAssessmentInvite,
  EmployerAssessmentSubmission,
} from '../employer-assessments/entities';
import { Offer, OfferStatus } from '../offers/entities/offer.entity';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { TalentRoleInterest } from '../talent/entities/talent-role-interest.entity';
import {
  EmployerRole,
  EmployerRoleStatus,
  EmployerRoleVisibility,
} from './entities/employer-role.entity';
import { EmployerRolesService } from './employer-roles.service';

describe('EmployerRolesService', () => {
  let service: EmployerRolesService;

  const mockRoleRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    increment: jest.fn(),
  };

  const mockAssessmentRepo = {
    findOne: jest.fn(),
  };

  const mockPoolProfileRepo = {
    createQueryBuilder: jest.fn(),
  };
  const mockInterestRepo = {};
  const mockInviteRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const mockSubmissionRepo = {
    find: jest.fn(),
  };
  const mockOfferRepo = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployerRolesService,
        { provide: getRepositoryToken(EmployerRole), useValue: mockRoleRepo },
        {
          provide: getRepositoryToken(EmployerAssessment),
          useValue: mockAssessmentRepo,
        },
        {
          provide: getRepositoryToken(EmployerPoolProfile),
          useValue: mockPoolProfileRepo,
        },
        {
          provide: getRepositoryToken(TalentRoleInterest),
          useValue: mockInterestRepo,
        },
        {
          provide: getRepositoryToken(EmployerAssessmentInvite),
          useValue: mockInviteRepo,
        },
        {
          provide: getRepositoryToken(EmployerAssessmentSubmission),
          useValue: mockSubmissionRepo,
        },
        { provide: getRepositoryToken(Offer), useValue: mockOfferRepo },
      ],
    }).compile();

    service = module.get(EmployerRolesService);
    jest.clearAllMocks();
  });

  it('creates a role and validates the attached assessment belongs to the employer', async () => {
    mockAssessmentRepo.findOne.mockResolvedValue({ id: 'assessment-1' });
    mockRoleRepo.create.mockImplementation((payload: unknown) => payload);
    mockRoleRepo.save.mockImplementation(async (role: EmployerRole) => ({
      ...role,
      id: 'role-1',
    }));

    const result = await service.create('employer-1', {
      title: ' Backend Engineer ',
      track: 'backend_developer',
      category: 'Engineering',
      description: ' Build APIs ',
      employmentType: 'Full-time',
      workArrangement: 'Remote',
      salaryMin: 1000,
      salaryMax: 2000,
      currency: 'usd',
      keywords: [' NestJS ', ''],
      assessmentId: 'assessment-1',
    });

    expect(mockAssessmentRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'assessment-1', employer_user_id: 'employer-1' },
      select: ['id'],
    });
    expect(result).toMatchObject({
      id: 'role-1',
      employer_user_id: 'employer-1',
      title: 'Backend Engineer',
      work_arrangement: 'Remote',
      currency: 'USD',
      keywords: ['NestJS'],
      assessment_id: 'assessment-1',
      status: EmployerRoleStatus.ACTIVE,
      visibility: EmployerRoleVisibility.PUBLIC,
      applicant_cap: null,
      interested_count: 0,
    });
  });

  it('rejects invalid salary ranges', async () => {
    await expect(
      service.create('employer-1', {
        title: 'Role',
        track: 'backend_developer',
        category: 'Engineering',
        salaryMin: 3000,
        salaryMax: 2000,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('closes and reopens a role', async () => {
    const role = {
      id: 'role-1',
      employer_user_id: 'employer-1',
      status: EmployerRoleStatus.ACTIVE,
    } as EmployerRole;
    mockRoleRepo.findOne.mockResolvedValue(role);
    mockRoleRepo.save.mockImplementation(async (next: EmployerRole) => next);

    const closed = await service.close('employer-1', 'role-1');
    expect(closed.status).toBe(EmployerRoleStatus.CLOSED);

    const reopened = await service.reopen('employer-1', 'role-1');
    expect(reopened.status).toBe(EmployerRoleStatus.ACTIVE);
  });

  it('rejects closed roles when sending offers', async () => {
    mockRoleRepo.findOne.mockResolvedValue({
      id: 'role-1',
      employer_user_id: 'employer-1',
      status: EmployerRoleStatus.CLOSED,
    });

    await expect(
      service.findActiveRoleForOffer('employer-1', 'role-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('increments the role offer count', async () => {
    mockRoleRepo.increment.mockResolvedValue({ affected: 1 });

    await service.incrementOfferCount('role-1');

    expect(mockRoleRepo.increment).toHaveBeenCalledWith(
      { id: 'role-1' },
      'offers_sent_count',
      1,
    );
  });

  it('returns score-based role candidates with frontend-safe statuses', async () => {
    const makeQb = (
      count: number,
      rows: Array<Record<string, unknown>> = [],
    ) => {
      const qb = {
        innerJoin: jest.fn(),
        leftJoin: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        select: jest.fn(),
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        offset: jest.fn(),
        limit: jest.fn(),
        getCount: jest.fn().mockResolvedValue(count),
        getRawMany: jest.fn().mockResolvedValue(rows),
        clone: jest.fn(),
      };
      Object.keys(qb).forEach((key) => {
        if (!['getCount', 'getRawMany', 'clone'].includes(key)) {
          qb[key as keyof typeof qb] = jest.fn().mockReturnValue(qb) as never;
        }
      });
      return qb;
    };
    const rows = [
      {
        candidateId: 'candidate-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        avatarUrl: null,
        roleTrack: 'backend_developer',
        verifiedLevel: 'senior',
        score: 83,
        interestId: 'interest-1',
        interestedAt: new Date('2026-05-24T15:25:25.250Z'),
      },
    ];
    const baseQb = makeQb(0);
    const bestQb = makeQb(1);
    const otherQb = makeQb(2);
    const interestedQb = makeQb(1);
    const allCountQb = makeQb(3);
    const dataQb = makeQb(1, rows);
    baseQb.clone
      .mockReturnValueOnce(bestQb)
      .mockReturnValueOnce(otherQb)
      .mockReturnValueOnce(interestedQb)
      .mockReturnValueOnce(allCountQb)
      .mockReturnValueOnce(dataQb);

    mockRoleRepo.findOne.mockResolvedValue({
      id: 'role-1',
      title: 'Backend Engineer',
      employer_user_id: 'employer-1',
      category: 'backend_developer',
      applicant_cap: 10,
      interested_count: 1,
      assessment_id: 'assessment-1',
    });
    mockPoolProfileRepo.createQueryBuilder.mockReturnValue(baseQb);
    mockInviteRepo.find.mockResolvedValue([
      { candidate_user_id: 'candidate-1' },
    ]);
    mockSubmissionRepo.find.mockResolvedValue([
      {
        candidate_user_id: 'candidate-1',
        passed: false,
        score: 64,
        completed_at: new Date('2026-05-24T16:00:00.000Z'),
      },
    ]);
    mockOfferRepo.find.mockResolvedValue([
      {
        candidate_user_id: 'candidate-1',
        status: OfferStatus.PENDING,
        interview_link: 'https://meet.example/interview',
        updated_at: new Date('2026-05-24T16:05:00.000Z'),
      },
    ]);

    const result = await service.listRoleCandidates('employer-1', 'role-1', {
      tab: 'best_match',
    });

    expect(bestQb.andWhere).toHaveBeenCalledWith(
      'pool.score >= :bestMatchScore',
      { bestMatchScore: 80 },
    );
    expect(dataQb.andWhere).toHaveBeenCalledWith(
      'pool.score >= :bestMatchScore',
      { bestMatchScore: 80 },
    );
    expect(result.counts).toEqual({
      best_match: 1,
      other: 2,
      interested: 1,
      total: 3,
    });
    expect(result.candidates[0]).toMatchObject({
      candidate_id: 'candidate-1',
      seniority_badge: 'Senior',
      match_score: 83,
      pipeline_status: 'interview_invited',
      assessment_status: 'completed',
      assessment_result: 'fail',
      offer_status: 'invited',
      interview_link: 'https://meet.example/interview',
    });
  });
});
