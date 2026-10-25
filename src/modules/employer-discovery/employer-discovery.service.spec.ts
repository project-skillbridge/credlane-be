import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmployerDiscoveryService } from './employer-discovery.service';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { EmployerSavedCandidate } from './entities/employer-saved-candidate.entity';
import { EmployerContactRequest } from './entities/employer-contact-request.entity';
import { User } from '../users/entities/user.entity';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { EmployerVerificationService } from '../employer/employer-verification.service';
import { Offer } from '../offers/entities/offer.entity';
import { EmployerBillingService } from '../employer-billing/employer-billing.service';
import { VerifiedProfileService } from '../verified-profile/verified-profile.service';
import { ForbiddenError, NotFoundError } from '../../shared';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';

describe('EmployerDiscoveryService', () => {
  let service: EmployerDiscoveryService;

  const mockFinishedEvaluationQuery = jest.fn();
  const mockPoolProfileRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    manager: { query: mockFinishedEvaluationQuery },
  };

  const mockSavedCandidateRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockContactRequestRepo = {
    save: jest.fn(),
  };

  const mockUserRepo = {
    findOne: jest.fn(),
  };

  const mockOfferRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn().mockResolvedValue(null),
  };

  const mockEmployerProfileRepo = {
    findOne: jest.fn(),
  };

  const mockNotificationDispatch = {
    dispatch: jest.fn(),
  };

  const mockVerificationService = {
    assertEmployerVerified: jest.fn(),
  };

  const mockVerifiedProfileService = {
    getForEmployerView: jest.fn(),
  };

  const mockBillingService = {
    getUnlockedIds: jest.fn(),
    isUnlocked: jest.fn(),
    unlock: jest.fn(),
  };

  beforeEach(async () => {
    // By default the candidate has finished the job evaluation.
    mockFinishedEvaluationQuery.mockReset();
    mockFinishedEvaluationQuery.mockResolvedValue([{ ok: 1 }]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployerDiscoveryService,
        {
          provide: getRepositoryToken(EmployerPoolProfile),
          useValue: mockPoolProfileRepo,
        },
        {
          provide: getRepositoryToken(EmployerSavedCandidate),
          useValue: mockSavedCandidateRepo,
        },
        {
          provide: getRepositoryToken(EmployerContactRequest),
          useValue: mockContactRequestRepo,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
        {
          provide: getRepositoryToken(Offer),
          useValue: mockOfferRepo,
        },
        {
          provide: getRepositoryToken(EmployerProfile),
          useValue: mockEmployerProfileRepo,
        },
        {
          provide: NotificationDispatchService,
          useValue: mockNotificationDispatch,
        },
        {
          provide: EmployerVerificationService,
          useValue: mockVerificationService,
        },
        {
          provide: EmployerBillingService,
          useValue: mockBillingService,
        },
        {
          provide: VerifiedProfileService,
          useValue: mockVerifiedProfileService,
        },
      ],
    }).compile();

    service = module.get<EmployerDiscoveryService>(EmployerDiscoveryService);
    mockBillingService.getUnlockedIds.mockResolvedValue(new Set());
    mockBillingService.isUnlocked.mockResolvedValue(false);
    jest.clearAllMocks();
    mockVerificationService.assertEmployerVerified.mockResolvedValue(undefined);
    mockOfferRepo.createQueryBuilder.mockReturnValue(createOfferQb());
  });

  const createOfferQb = (
    rows: Array<{
      offer_candidate_user_id: string;
      offer_status: string;
    }> = [],
  ) => ({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  });

  const createSavedQb = (savedIds: string[] = []) => ({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest
      .fn()
      .mockResolvedValue(savedIds.map((id) => ({ s_candidate_user_id: id }))),
  });

  describe('talent who has not finished the job evaluation', () => {
    beforeEach(() => {
      mockFinishedEvaluationQuery.mockResolvedValue([]);
      mockPoolProfileRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        tier: 'job_ready',
        talent_profile_id: 'tp-1',
        talent_profile: { id: 'tp-1' },
      });
    });

    it('cannot be opened by an employer', async () => {
      await expect(
        service.getCandidateProfile('emp-1', 'cand-1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('cannot be shortlisted', async () => {
      await expect(service.saveCandidate('emp-1', 'cand-1')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('cannot be unlocked or contacted', async () => {
      await expect(service.unlockCandidate('emp-1', 'cand-1')).rejects.toThrow(
        NotFoundError,
      );
      await expect(
        service.contactCandidate('emp-1', 'cand-1', 'hi'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getCandidateProfile', () => {
    it('should return verified profile with employer context for job_ready candidate', async () => {
      mockVerifiedProfileService.getForEmployerView.mockResolvedValue({
        full_name: 'Jane Doe',
        role: 'Frontend Developer',
        score_percentage: 85,
        tier: 'job_ready',
        is_owner: false,
        skill_breakdown_tabs: [],
        about_tags: [],
        skills: [],
        working_style: [],
        ai_report: '',
        growth_insight: '',
        recommended_resources: [],
        resource_page_url: '/resources',
        share_url: 'https://example.com/share',
        qr_code_url: null,
        verified: true,
        verified_at: '2026-05-03T00:00:00.000Z',
      });
      mockSavedCandidateRepo.createQueryBuilder.mockReturnValue(
        createSavedQb(['user-1']),
      );
      mockOfferRepo.createQueryBuilder.mockReturnValue(
        createOfferQb([
          {
            offer_candidate_user_id: 'user-1',
            offer_status: 'pending',
          },
        ]),
      );

      const result = await service.getCandidateProfile('employer-1', 'user-1');

      expect(
        mockVerifiedProfileService.getForEmployerView,
      ).toHaveBeenCalledWith('user-1');
      expect(result.user_id).toBe('user-1');
      expect(result.full_name).toBe('Jane D.');
      expect(result.is_unlocked).toBe(false);
      expect(result.avatar_url).toBeNull();
      expect(result.resume_url).toBeNull();
      expect(result.email).toBe('');
      expect(result.portfolio_url).toBeNull();
      expect(result.score_percentage).toBe(85);
      expect(result.is_saved).toBe(true);
      expect(result.offer_sent).toBe(true);
      expect(result.offer_status).toBe('pending');
      expect(result.is_owner).toBe(false);
    });

    it('should reveal the full profile once the employer has unlocked it', async () => {
      mockBillingService.isUnlocked.mockResolvedValue(true);
      mockPoolProfileRepo.findOne.mockResolvedValue({
        talent_profile_id: 'tp-1',
        talent_profile: {
          personal_website: 'https://jane.dev',
          linkedin_url: 'https://linkedin.com/in/jane',
        },
      });
      mockVerifiedProfileService.getForEmployerView.mockResolvedValue({
        full_name: 'Jane Doe',
        avatar_url: 'https://example.com/a.jpg',
        email: 'jane@example.com',
        resume_url: 'https://example.com/r.pdf',
        share_url: 'https://example.com/share',
        qr_code_url: null,
      });
      mockSavedCandidateRepo.createQueryBuilder.mockReturnValue(
        createSavedQb([]),
      );
      mockOfferRepo.createQueryBuilder.mockReturnValue(createOfferQb([]));

      const result = await service.getCandidateProfile('employer-1', 'user-1');

      expect(result).toMatchObject({
        full_name: 'Jane Doe',
        avatar_url: 'https://example.com/a.jpg',
        email: 'jane@example.com',
        resume_url: 'https://example.com/r.pdf',
        portfolio_url: 'https://jane.dev',
        linkedin_url: 'https://linkedin.com/in/jane',
        is_unlocked: true,
      });
    });

    it('should throw NotFoundError if candidate not in pool', async () => {
      mockVerifiedProfileService.getForEmployerView.mockRejectedValue(
        new NotFoundError('Candidate profile not found'),
      );

      await expect(
        service.getCandidateProfile('employer-1', 'missing'),
      ).rejects.toThrow('Candidate profile not found');
    });

    it('should throw NotFoundError if candidate is not job_ready', async () => {
      mockVerifiedProfileService.getForEmployerView.mockRejectedValue(
        new NotFoundError('Candidate profile not found'),
      );

      await expect(
        service.getCandidateProfile('employer-1', 'user-1'),
      ).rejects.toThrow('Candidate profile not found');
    });
  });

  describe('saveCandidate', () => {
    it('should save a job_ready candidate', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'user-1',
        talent_profile_id: 'tp-1',
        tier: 'job_ready',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);
      mockSavedCandidateRepo.save.mockResolvedValue({ id: 'saved-1' });

      const result = await service.saveCandidate(
        'employer-1',
        'user-1',
        'Great candidate',
      );

      expect(result.status).toBe('success');
      expect(mockSavedCandidateRepo.save).toHaveBeenCalledWith({
        employer_user_id: 'employer-1',
        candidate_user_id: 'user-1',
        employer_pool_profile_id: 'pool-1',
        notes: 'Great candidate',
      });
    });

    it('should throw ConflictError if already saved', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'user-1',
        talent_profile_id: 'tp-1',
        tier: 'job_ready',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);
      const duplicateError = Object.assign(new Error('duplicate'), {
        code: '23505',
      });
      mockSavedCandidateRepo.save.mockRejectedValue(duplicateError);

      await expect(
        service.saveCandidate('employer-1', 'user-1'),
      ).rejects.toThrow('Candidate already saved');
    });

    it('should throw ForbiddenError if candidate not job_ready', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'user-1',
        talent_profile_id: 'tp-1',
        tier: 'emerging',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);

      await expect(
        service.saveCandidate('employer-1', 'user-1'),
      ).rejects.toThrow('Only Job Ready candidates can be saved');
    });
  });

  describe('unsaveCandidate', () => {
    it('should remove a saved candidate', async () => {
      mockSavedCandidateRepo.delete.mockResolvedValue({ affected: 1 });

      const result = await service.unsaveCandidate('employer-1', 'user-1');
      expect(result.status).toBe('success');
    });

    it('should throw NotFoundError if not saved', async () => {
      mockSavedCandidateRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(
        service.unsaveCandidate('employer-1', 'user-1'),
      ).rejects.toThrow('Saved candidate not found');
    });
  });

  describe('contactCandidate', () => {
    it('should throw ForbiddenError if employer is not verified', async () => {
      mockVerificationService.assertEmployerVerified.mockRejectedValue(
        new ForbiddenError(
          'Your employer account is pending verification. You will be notified once approved.',
        ),
      );

      await expect(
        service.contactCandidate('employer-1', 'user-1', 'Hello'),
      ).rejects.toThrow(
        'Your employer account is pending verification. You will be notified once approved.',
      );
      expect(mockPoolProfileRepo.findOne).not.toHaveBeenCalled();
    });

    it('should create contact request and trigger notification', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'user-1',
        talent_profile_id: 'tp-1',
        tier: 'job_ready',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);
      mockContactRequestRepo.save.mockResolvedValue({ id: 'contact-1' });
      mockUserRepo.findOne.mockResolvedValue({
        id: 'employer-1',
        first_name: 'John',
        last_name: 'Doe',
      });
      mockNotificationDispatch.dispatch.mockResolvedValue(undefined);

      const result = await service.contactCandidate(
        'employer-1',
        'user-1',
        'Interested in your profile',
      );

      expect(result.status).toBe('success');
      expect(mockContactRequestRepo.save).toHaveBeenCalled();
      expect(mockNotificationDispatch.dispatch).toHaveBeenCalled();
    });

    it('should throw ForbiddenError if candidate not job_ready', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'user-1',
        talent_profile_id: 'tp-1',
        tier: 'not_ready',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);

      await expect(
        service.contactCandidate('employer-1', 'user-1', 'Hello'),
      ).rejects.toThrow('Only Job Ready candidates can be contacted');
    });

    it('should succeed even if notification dispatch throws', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'user-1',
        talent_profile_id: 'tp-1',
        tier: 'job_ready',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);
      mockContactRequestRepo.save.mockResolvedValue({ id: 'contact-1' });
      mockUserRepo.findOne.mockResolvedValue({
        id: 'employer-1',
        first_name: 'John',
        last_name: 'Doe',
      });
      mockNotificationDispatch.dispatch.mockRejectedValue(
        new Error('Email service down'),
      );

      const result = await service.contactCandidate(
        'employer-1',
        'user-1',
        'Interested',
      );

      expect(result.status).toBe('success');
    });
  });

  describe('discoverCandidates', () => {
    const createMockQb = (rawResults: unknown[] = [], count = 0) => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(count),
        getRawMany: jest.fn().mockResolvedValue(rawResults),
      };
      return qb;
    };

    it('should return paginated candidates with enriched card fields', async () => {
      const rawResults = [
        {
          userId: 'user-1',
          roleTrack: 'frontend_developer',
          tier: 'job_ready',
          availability: 'immediately_available',
          verifiedAt: new Date(),
          score: 85,
          strongCompetencies: ['api_design'],
          shareToken: 'abc',
          firstName: 'Alice',
          lastName: 'Dev',
          avatarUrl: 'https://example.com/alice.jpg',
          country: 'Nigeria',
          verifiedLevel: 'mid',
          location: 'Lagos, Nigeria',
          jobSearchStatus: 'open_to_opportunities',
          specialization: null,
          personalAssessmentAnswers: {
            tools: ['react', 'typescript'],
            work_arrangement_preference: ['fully_remote'],
          },
        },
      ];
      const poolQb = createMockQb(rawResults, 1);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);

      const savedQb = createSavedQb(['user-1']);
      mockSavedCandidateRepo.createQueryBuilder.mockReturnValue(savedQb);

      const result = await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
      });

      expect(result.total).toBe(1);
      expect(result.candidates[0].user_id).toBe('user-1');
      expect(result.candidates[0].full_name).toBe('Alice D.');
      expect(result.candidates[0].is_unlocked).toBe(false);
      expect(result.candidates[0].role).toBe('Frontend Developer');
      expect(result.candidates[0].seniority_badge).toBe('Mid Level');
      expect(result.candidates[0].score).toBe(85);
      expect(result.candidates[0].skills).toEqual(['react', 'typescript']);
      expect(result.candidates[0].avatar_url).toBeNull();
      expect(result.candidates[0].is_saved).toBe(true);
      expect(result.total_pages).toBe(1);
    });

    it('should return empty results when no candidates match', async () => {
      const poolQb = createMockQb([], 0);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);

      const result = await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
      });

      expect(result.total).toBe(0);
      expect(result.candidates).toHaveLength(0);
    });

    it('should apply roleTrack filter', async () => {
      const poolQb = createMockQb([], 0);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);

      await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
        roleTrack: ['backend_developer'],
      });

      expect(poolQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('pool.track'),
        expect.objectContaining({ roleTracks: ['backend_developer'] }),
      );
    });

    it('should apply availability filter', async () => {
      const poolQb = createMockQb([], 0);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);

      await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
        availability: ['immediately_available'],
      });

      expect(poolQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('pool.availability'),
        expect.objectContaining({ availabilities: ['immediately_available'] }),
      );
    });

    it('should apply composite score range filters', async () => {
      const poolQb = createMockQb([], 0);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);

      await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
        minScore: 75,
        maxScore: 100,
      });

      expect(poolQb.andWhere).toHaveBeenCalledWith('pool.score >= :minScore', {
        minScore: 75,
      });
      expect(poolQb.andWhere).toHaveBeenCalledWith('pool.score <= :maxScore', {
        maxScore: 100,
      });
    });

    it('should apply experience level filter', async () => {
      const poolQb = createMockQb([], 0);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);

      await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
        experienceLevel: ['mid'] as any,
      });

      expect(poolQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('pool.verified_level'),
        expect.objectContaining({ experienceLevels: ['mid'] }),
      );
    });

    it('should apply region filter', async () => {
      const poolQb = createMockQb([], 0);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);

      await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
        region: 'Nigeria',
      });

      expect(poolQb.andWhere).toHaveBeenCalledWith(
        '((pool.location ILIKE :region0 OR u.country ILIKE :region0))',
        { region0: '%Nigeria%' },
      );
    });

    it('should match any of several comma-separated regions', async () => {
      const poolQb = createMockQb([], 0);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);

      await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
        region: 'Nigeria, Ghana',
      });

      expect(poolQb.andWhere).toHaveBeenCalledWith(
        '((pool.location ILIKE :region0 OR u.country ILIKE :region0) OR (pool.location ILIKE :region1 OR u.country ILIKE :region1))',
        { region0: '%Nigeria%', region1: '%Ghana%' },
      );
    });

    it('should apply search filter', async () => {
      const poolQb = createMockQb([], 0);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);

      await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
        search: 'Alice',
      });

      expect(poolQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        { search: '%Alice%' },
      );
    });

    it('should mark candidates as not saved when none are saved', async () => {
      const rawResults = [
        {
          userId: 'user-1',
          roleTrack: 'frontend_developer',
          tier: 'job_ready',
          availability: 'immediately_available',
          verifiedAt: new Date(),
          score: 80,
          strongCompetencies: null,
          shareToken: null,
          firstName: 'Bob',
          lastName: null,
          avatarUrl: null,
          country: 'Ghana',
          verifiedLevel: 'junior',
          location: null,
          jobSearchStatus: null,
          specialization: null,
          personalAssessmentAnswers: null,
        },
      ];
      const poolQb = createMockQb(rawResults, 1);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);

      const savedQb = createSavedQb([]);
      mockSavedCandidateRepo.createQueryBuilder.mockReturnValue(savedQb);

      const result = await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
      });

      expect(result.candidates[0].is_saved).toBe(false);
      expect(result.candidates[0].full_name).toBe('Bob');
    });

    it("should default roleTrack to employer's desired_roles when query.roleTrack is not provided", async () => {
      const poolQb = createMockQb([], 0);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);
      mockEmployerProfileRepo.findOne.mockResolvedValue({
        desired_roles: ['backend_developer', 'devops_engineer'],
      });

      await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
      });

      expect(mockEmployerProfileRepo.findOne).toHaveBeenCalledWith({
        where: { user_id: 'employer-1' },
        select: ['desired_roles'],
      });
      expect(poolQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('pool.track'),
        expect.objectContaining({
          roleTracks: ['backend_developer', 'devops_engineer'],
        }),
      );
    });

    it('should not override roleTrack with desired_roles when query.roleTrack is explicitly provided', async () => {
      const poolQb = createMockQb([], 0);
      mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);
      mockEmployerProfileRepo.findOne.mockResolvedValue({
        desired_roles: ['backend_developer', 'devops_engineer'],
      });

      await service.discoverCandidates('employer-1', {
        page: 1,
        limit: 20,
        roleTrack: ['frontend_developer'],
      });

      expect(mockEmployerProfileRepo.findOne).not.toHaveBeenCalled();
      expect(poolQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('pool.track'),
        expect.objectContaining({ roleTracks: ['frontend_developer'] }),
      );
    });

    it.each([
      { search: 'Alice' },
      { region: 'Nigeria' },
      { availability: ['immediately_available'] },
      { experienceLevel: ['mid'] as any },
      { minScore: 80 },
      { maxScore: 90 },
    ])(
      'should not fetch desired_roles when explicit filters are present: %p',
      async (filters) => {
        const poolQb = createMockQb([], 0);
        mockPoolProfileRepo.createQueryBuilder.mockReturnValue(poolQb);

        await service.discoverCandidates('employer-1', {
          page: 1,
          limit: 20,
          ...filters,
        });

        expect(mockEmployerProfileRepo.findOne).not.toHaveBeenCalled();
      },
    );
  });
});
