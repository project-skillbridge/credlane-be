import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, IsNull, QueryFailedError } from 'typeorm';
import { OffersService } from './offers.service';
import { Offer, OfferStatus } from './entities/offer.entity';
import { OfferDistributionLog } from './entities/offer-distribution-log.entity';
import { EmployerPoolProfile } from '../talent/entities/employer-pool-profile.entity';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';
import { User } from '../users/entities/user.entity';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { EmployerVerificationService } from '../employer/employer-verification.service';
import { EmployerRolesService } from '../employer-roles/employer-roles.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared';

describe('OffersService', () => {
  let service: OffersService;

  const mockOfferRepo = {
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    manager: {
      save: jest.fn(),
      transaction: jest.fn(),
    },
  };

  const mockDistributionLogRepo = {
    save: jest.fn(),
    count: jest.fn(),
  };

  const mockPoolProfileRepo = {
    findOne: jest.fn(),
  };

  const mockUserRepo = {
    findOne: jest.fn(),
  };

  const mockNotificationDispatch = {
    notifyOfferReceived: jest.fn(),
    notifyOfferAccepted: jest.fn(),
    notifyOfferDeclined: jest.fn(),
    notifyAssessmentUnlocked: jest.fn(),
    notifyOfferWithdrawn: jest.fn(),
    notifyAssessmentWindowExtended: jest.fn(),
    dispatch: jest.fn(),
  };

  const mockVerificationService = {
    assertEmployerVerified: jest.fn(),
  };

  const mockEmployerRolesService = {
    findActiveRoleForOffer: jest.fn(),
  };

  const mockEmployerProfileRepo = {
    increment: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OffersService,
        { provide: getRepositoryToken(Offer), useValue: mockOfferRepo },
        {
          provide: getRepositoryToken(OfferDistributionLog),
          useValue: mockDistributionLogRepo,
        },
        {
          provide: getRepositoryToken(EmployerPoolProfile),
          useValue: mockPoolProfileRepo,
        },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        {
          provide: NotificationDispatchService,
          useValue: mockNotificationDispatch,
        },
        {
          provide: EmployerVerificationService,
          useValue: mockVerificationService,
        },
        {
          provide: EmployerRolesService,
          useValue: mockEmployerRolesService,
        },
        {
          provide: getRepositoryToken(EmployerProfile),
          useValue: mockEmployerProfileRepo,
        },
      ],
    }).compile();

    service = module.get<OffersService>(OffersService);
    jest.clearAllMocks();
    mockVerificationService.assertEmployerVerified.mockResolvedValue(undefined);
    mockEmployerRolesService.findActiveRoleForOffer.mockReset();
  });

  describe('createOffer', () => {
    const dto = {
      candidateUserId: 'candidate-1',
      roleId: 'role-1',
      roleTitle: 'Frontend Developer',
      roleTrack: 'frontend_developer',
      roleDescription: 'We would like to offer you a position',
      compensation: '$80k - $100k',
      employmentType: 'Full-time',
      workArrangement: 'Remote',
      expiresInDays: 14,
    };

    it('should create an offer for a job_ready candidate', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'candidate-1',
        tier: 'job_ready',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);
      mockOfferRepo.manager.transaction.mockImplementation(
        async (
          cb: (manager: typeof mockOfferRepo.manager) => Promise<unknown>,
        ) => {
          const manager = {
            query: jest.fn().mockResolvedValue(undefined),
            count: jest.fn().mockResolvedValue(0),
            save: jest
              .fn()
              .mockResolvedValueOnce({
                id: 'offer-1',
                employer_user_id: 'employer-1',
                candidate_user_id: dto.candidateUserId,
                role_title: dto.roleTitle,
                status: OfferStatus.PENDING,
              })
              .mockResolvedValueOnce({ id: 'log-1' }),
          };
          return cb(manager as unknown as typeof mockOfferRepo.manager);
        },
      );
      mockUserRepo.findOne.mockResolvedValue({
        id: 'employer-1',
        first_name: 'Jane',
        last_name: 'Employer',
      });
      mockNotificationDispatch.notifyOfferReceived.mockResolvedValue(undefined);

      const result = await service.createOffer('employer-1', dto);

      expect(result.id).toBe('offer-1');
      expect(mockOfferRepo.manager.transaction).toHaveBeenCalled();
      expect(mockNotificationDispatch.notifyOfferReceived).toHaveBeenCalled();
    });

    it('should throw ForbiddenError if employer is not verified', async () => {
      mockVerificationService.assertEmployerVerified.mockRejectedValue(
        new ForbiddenError(
          'Your employer account is pending verification. You will be notified once approved.',
        ),
      );

      await expect(service.createOffer('employer-1', dto)).rejects.toThrow(
        'Your employer account is pending verification. You will be notified once approved.',
      );
      expect(mockPoolProfileRepo.findOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if candidate not in pool', async () => {
      mockPoolProfileRepo.findOne.mockResolvedValue(null);

      await expect(service.createOffer('employer-1', dto)).rejects.toThrow(
        'Candidate not found',
      );
    });

    it('should throw ForbiddenError if candidate is not job_ready', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'candidate-1',
        tier: 'emerging',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);

      await expect(service.createOffer('employer-1', dto)).rejects.toThrow(
        'Offers can only be sent to Job Ready candidates',
      );
    });

    it('should throw ForbiddenError if candidate role track does not match', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'candidate-1',
        tier: 'job_ready',
        track: 'backend_developer',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);

      await expect(service.createOffer('employer-1', dto)).rejects.toThrow(
        'Offers can only be sent to candidates that match this role.',
      );
    });

    it('should throw TooManyRequestsError if monthly cap reached', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'candidate-1',
        tier: 'job_ready',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);
      mockOfferRepo.manager.transaction.mockImplementation(
        async (cb: (manager: unknown) => Promise<unknown>) => {
          const manager = {
            query: jest.fn().mockResolvedValue(undefined),
            count: jest.fn().mockResolvedValue(50),
          };
          return cb(manager);
        },
      );

      await expect(service.createOffer('employer-1', dto)).rejects.toThrow(
        'Monthly offer limit reached',
      );
    });

    it('should throw ConflictError when a pending or accepted offer already exists', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'candidate-1',
        tier: 'job_ready',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);
      mockOfferRepo.findOne.mockResolvedValue({
        id: 'existing-offer',
        status: OfferStatus.PENDING,
      });

      await expect(service.createOffer('employer-1', dto)).rejects.toThrow(
        'Offer already sent to this candidate',
      );

      expect(mockOfferRepo.findOne).toHaveBeenCalledWith({
        where: {
          employer_user_id: 'employer-1',
          candidate_user_id: dto.candidateUserId,
          role_id: IsNull(),
          status: In([OfferStatus.PENDING, OfferStatus.ACCEPTED]),
        },
      });
      expect(mockOfferRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('should allow a new offer when only declined or expired offers exist', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'candidate-1',
        tier: 'job_ready',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);
      mockOfferRepo.findOne.mockResolvedValue(null);
      mockOfferRepo.manager.transaction.mockImplementation(
        async (
          cb: (manager: typeof mockOfferRepo.manager) => Promise<unknown>,
        ) => {
          const manager = {
            query: jest.fn().mockResolvedValue(undefined),
            count: jest.fn().mockResolvedValue(0),
            save: jest
              .fn()
              .mockResolvedValueOnce({
                id: 'offer-2',
                employer_user_id: 'employer-1',
                candidate_user_id: dto.candidateUserId,
                role_title: dto.roleTitle,
                status: OfferStatus.PENDING,
              })
              .mockResolvedValueOnce({ id: 'log-2' }),
          };
          return cb(manager as unknown as typeof mockOfferRepo.manager);
        },
      );
      mockUserRepo.findOne.mockResolvedValue({
        id: 'employer-1',
        first_name: 'Jane',
        last_name: 'Employer',
      });
      mockNotificationDispatch.notifyOfferReceived.mockResolvedValue(undefined);

      const result = await service.createOffer('employer-1', dto);

      expect(result.id).toBe('offer-2');
      expect(mockOfferRepo.findOne).toHaveBeenCalledWith({
        where: {
          employer_user_id: 'employer-1',
          candidate_user_id: dto.candidateUserId,
          role_id: IsNull(),
          status: In([OfferStatus.PENDING, OfferStatus.ACCEPTED]),
        },
      });
      expect(mockOfferRepo.manager.transaction).toHaveBeenCalled();
    });

    it('should prefill offer details from an active role and increment role offer count', async () => {
      const role = {
        id: 'role-1',
        title: 'Backend Engineer',
        description: 'Build APIs',
        employment_type: 'Contract',
        work_arrangement: 'Hybrid',
        salary_min: 1000,
        salary_max: 2000,
        currency: 'USD',
      };
      mockEmployerRolesService.findActiveRoleForOffer.mockResolvedValue(role);
      mockPoolProfileRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        candidate_id: 'candidate-1',
        tier: 'job_ready',
      });
      mockOfferRepo.findOne.mockResolvedValue(null);

      const mockManager = {
        query: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(0),
        save: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'offer-1',
            employer_user_id: 'employer-1',
            candidate_user_id: 'candidate-1',
            role_id: 'role-1',
            role_title: 'Backend Engineer',
            status: OfferStatus.PENDING,
          })
          .mockResolvedValueOnce({ id: 'log-1' }),
        increment: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockOfferRepo.manager.transaction.mockImplementation(
        async (cb: (manager: unknown) => Promise<unknown>) => cb(mockManager),
      );
      mockUserRepo.findOne.mockResolvedValue({
        first_name: 'Jane',
        last_name: 'Employer',
      });

      await service.createOffer('employer-1', {
        candidateUserId: 'candidate-1',
        roleId: 'role-1',
      });

      expect(
        mockEmployerRolesService.findActiveRoleForOffer,
      ).toHaveBeenCalledWith('employer-1', 'role-1');
      expect(mockManager.save).toHaveBeenNthCalledWith(
        1,
        Offer,
        expect.objectContaining({
          role_id: 'role-1',
          role_title: 'Backend Engineer',
          role_description: 'Build APIs',
          compensation: 'USD 1000-2000',
          employment_type: 'Contract',
          work_arrangement: 'Hybrid',
        }),
      );
      expect(mockManager.increment).toHaveBeenCalledWith(
        expect.any(Function),
        { id: 'role-1', employer_user_id: 'employer-1' },
        'offers_sent_count',
        1,
      );
    });

    it('should translate concurrent duplicate active offers to ConflictError', async () => {
      const pool = {
        id: 'pool-1',
        candidate_id: 'candidate-1',
        tier: 'job_ready',
      };
      mockPoolProfileRepo.findOne.mockResolvedValue(pool);
      mockOfferRepo.findOne.mockResolvedValue(null);
      mockOfferRepo.manager.transaction.mockRejectedValue(
        new QueryFailedError('INSERT INTO offers', [], {
          code: '23505',
          constraint: 'UQ_offers_active_employer_candidate',
        } as unknown as Error),
      );

      await expect(service.createOffer('employer-1', dto)).rejects.toThrow(
        'Offer already sent to this candidate',
      );
    });
  });

  describe('bulkCreateOffers', () => {
    const bulkDto = {
      candidateUserIds: ['candidate-1', 'candidate-2'],
      roleId: 'role-1',
      message: 'We would like to invite you to this role.',
      expiresInDays: 14,
    };

    it('should send role-based offers to multiple candidates', async () => {
      const createOfferSpy = jest
        .spyOn(service, 'createOffer')
        .mockImplementation(
          async (_employerUserId, dto) =>
            ({
              id: `offer-${dto.candidateUserId}`,
              candidate_user_id: dto.candidateUserId,
              status: OfferStatus.PENDING,
            }) as Offer,
        );

      const result = await service.bulkCreateOffers('employer-1', bulkDto);

      expect(result.offers).toHaveLength(2);
      expect(result.failures).toEqual([]);
      expect(createOfferSpy).toHaveBeenNthCalledWith(1, 'employer-1', {
        roleId: 'role-1',
        message: 'We would like to invite you to this role.',
        expiresInDays: 14,
        candidateUserId: 'candidate-1',
      });
      expect(createOfferSpy).toHaveBeenNthCalledWith(2, 'employer-1', {
        roleId: 'role-1',
        message: 'We would like to invite you to this role.',
        expiresInDays: 14,
        candidateUserId: 'candidate-2',
      });

      createOfferSpy.mockRestore();
    });

    it('should return per-candidate failures without hiding successful sends', async () => {
      const createOfferSpy = jest
        .spyOn(service, 'createOffer')
        .mockImplementation(async (_employerUserId, dto) => {
          if (dto.candidateUserId === 'candidate-2') {
            throw new BadRequestError('Offer already sent to this candidate');
          }
          return {
            id: `offer-${dto.candidateUserId}`,
            candidate_user_id: dto.candidateUserId,
            status: OfferStatus.PENDING,
          } as Offer;
        });

      const result = await service.bulkCreateOffers('employer-1', bulkDto);

      expect(result.offers).toHaveLength(1);
      expect(result.failures).toEqual([
        {
          candidateUserId: 'candidate-2',
          message: 'Offer already sent to this candidate',
        },
      ]);

      createOfferSpy.mockRestore();
    });
  });

  describe('respondToOffer', () => {
    it('should accept a pending offer', async () => {
      const offer = {
        id: 'offer-1',
        candidate_user_id: 'candidate-1',
        employer_user_id: 'employer-1',
        role_title: 'Dev',
        status: OfferStatus.PENDING,
        expires_at: new Date(Date.now() + 86400000),
        role: null,
      };
      mockOfferRepo.findOne.mockResolvedValue(offer);
      // First update: expire check (not expired → affected=0)
      // Second update: respond (affected=1)
      mockOfferRepo.update
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValueOnce({ affected: 1 });
      mockUserRepo.findOne.mockResolvedValue({
        id: 'candidate-1',
        first_name: 'Bob',
        last_name: 'Candidate',
      });
      mockNotificationDispatch.notifyOfferAccepted.mockResolvedValue(undefined);

      const result = await service.respondToOffer(
        'candidate-1',
        'offer-1',
        'accept',
      );

      expect(result.status).toBe(OfferStatus.ACCEPTED);
      expect(mockNotificationDispatch.notifyOfferAccepted).toHaveBeenCalled();
    });

    it('should accept an interview invite without writing assessment window fields', async () => {
      const offer = {
        id: 'offer-1',
        candidate_user_id: 'candidate-1',
        employer_user_id: 'employer-1',
        role_title: 'Dev',
        status: OfferStatus.PENDING,
        expires_at: new Date(Date.now() + 86400000),
        role: { assessment_id: 'assessment-1' },
      };
      mockOfferRepo.findOne.mockResolvedValue(offer);
      mockOfferRepo.update
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValueOnce({ affected: 1 });
      mockUserRepo.findOne.mockResolvedValue({
        first_name: 'Bob',
        last_name: 'Candidate',
      });

      const result = await service.respondToOffer(
        'candidate-1',
        'offer-1',
        'accept',
      );

      expect(result.status).toBe(OfferStatus.ACCEPTED);
      const updatePayload = mockOfferRepo.update.mock.calls[1][1] as {
        status: OfferStatus;
      };
      expect(updatePayload.status).toBe(OfferStatus.ACCEPTED);
      expect(updatePayload).not.toHaveProperty('assessment_unlocked_at');
      expect(updatePayload).not.toHaveProperty('assessment_deadline');
    });

    it('should decline a pending offer', async () => {
      const offer = {
        id: 'offer-1',
        candidate_user_id: 'candidate-1',
        employer_user_id: 'employer-1',
        role_title: 'Dev',
        status: OfferStatus.PENDING,
        expires_at: new Date(Date.now() + 86400000),
      };
      mockOfferRepo.findOne.mockResolvedValue(offer);
      mockOfferRepo.update
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValueOnce({ affected: 1 });
      mockUserRepo.findOne.mockResolvedValue({
        id: 'candidate-1',
        first_name: 'Bob',
        last_name: 'Candidate',
      });
      mockNotificationDispatch.notifyOfferDeclined.mockResolvedValue(undefined);

      const result = await service.respondToOffer(
        'candidate-1',
        'offer-1',
        'decline',
      );

      expect(result.status).toBe(OfferStatus.DECLINED);
    });

    it('should throw NotFoundError if offer not found', async () => {
      mockOfferRepo.findOne.mockResolvedValue(null);

      await expect(
        service.respondToOffer('candidate-1', 'missing', 'accept'),
      ).rejects.toThrow('Offer not found');
    });

    it('should throw BadRequestError if offer is not pending', async () => {
      const offer = {
        id: 'offer-1',
        candidate_user_id: 'candidate-1',
        status: OfferStatus.ACCEPTED,
        expires_at: new Date(Date.now() + 86400000),
      };
      mockOfferRepo.findOne.mockResolvedValue(offer);

      await expect(
        service.respondToOffer('candidate-1', 'offer-1', 'accept'),
      ).rejects.toThrow('Cannot respond to an offer with status');
    });

    it('should throw BadRequestError if offer is expired', async () => {
      const offer = {
        id: 'offer-1',
        candidate_user_id: 'candidate-1',
        employer_user_id: 'employer-1',
        status: OfferStatus.PENDING,
        expires_at: new Date(Date.now() - 86400000), // expired yesterday
      };
      mockOfferRepo.findOne.mockResolvedValue(offer);
      // Expire check succeeds (affected=1 → offer was expired)
      mockOfferRepo.update.mockResolvedValue({ affected: 1 });

      await expect(
        service.respondToOffer('candidate-1', 'offer-1', 'accept'),
      ).rejects.toThrow('This offer has expired');
    });
  });

  describe('getAnalytics', () => {
    it('should return offer analytics', async () => {
      // expireStaleOffers update call
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      mockDistributionLogRepo.count.mockResolvedValue(5);
      mockOfferRepo.count
        .mockResolvedValueOnce(3) // accepted
        .mockResolvedValueOnce(1) // declined
        .mockResolvedValueOnce(2) // pending
        .mockResolvedValueOnce(0); // expired

      const result = await service.getAnalytics('employer-1');

      expect(result.offers_this_month).toBe(5);
      expect(result.accepted_count).toBe(3);
      expect(result.declined_count).toBe(1);
      expect(result.pending_count).toBe(2);
      expect(result.expired_count).toBe(0);
      expect(result.remaining).toBe(45);
    });
  });

  describe('listEmployerCandidatesOffers', () => {
    it('should return subtab rows with candidate name, role track, job title, date sent, and status', async () => {
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      const sentAt = new Date('2026-05-01T10:00:00.000Z');
      const row = {
        id: 'offer-1',
        candidate_user_id: 'candidate-1',
        role_title: 'Senior Frontend Engineer',
        status: OfferStatus.PENDING,
        created_at: sentAt,
        candidate: {
          first_name: 'Ada',
          last_name: 'Lovelace',
        },
        employer_pool_profile: { track: 'frontend_developer' },
      };
      mockOfferRepo.findAndCount.mockResolvedValue([[row], 1]);

      const result = await service.listEmployerCandidatesOffers('employer-1', {
        page: 1,
        limit: 20,
      });

      expect(result.offers).toEqual([
        {
          offer_id: 'offer-1',
          candidate_user_id: 'candidate-1',
          candidate_name: 'Ada Lovelace',
          role_track: 'frontend_developer',
          job_title: 'Senior Frontend Engineer',
          date_sent: sentAt,
          status: OfferStatus.PENDING,
        },
      ]);
      expect(result.total).toBe(1);
      expect(result.emptyStateMessage).toBeNull();
      expect(mockOfferRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employer_user_id: 'employer-1',
          }),
          relations: ['candidate', 'employer_pool_profile'],
        }),
      );
    });

    it('should default to all interview invite lifecycle statuses', async () => {
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      mockOfferRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.listEmployerCandidatesOffers('employer-1', {});

      const call = mockOfferRepo.findAndCount.mock.calls[0][0] as {
        where: { status: { _type: string; _value: OfferStatus[] } };
      };
      expect(call.where.status._type).toBe('in');
      expect(call.where.status._value).toEqual([
        OfferStatus.PENDING,
        OfferStatus.ACCEPTED,
        OfferStatus.DECLINED,
        OfferStatus.EXPIRED,
        OfferStatus.WITHDRAWN,
      ]);
    });

    it('should honour an explicit status filter', async () => {
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      mockOfferRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.listEmployerCandidatesOffers('employer-1', {
        status: 'declined',
      });

      expect(mockOfferRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            employer_user_id: 'employer-1',
            status: 'declined',
          },
        }),
      );
    });

    it('should return empty state message when employer has never sent an offer', async () => {
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      mockOfferRepo.findAndCount.mockResolvedValue([[], 0]);
      mockOfferRepo.count.mockResolvedValue(0);

      const result = await service.listEmployerCandidatesOffers(
        'employer-1',
        {},
      );

      expect(result.emptyStateMessage).toBe(
        'No offers sent yet. Discover candidates and send your first offer.',
      );
    });

    it('should not return empty state message when employer has only non-subtab offers', async () => {
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      mockOfferRepo.findAndCount.mockResolvedValue([[], 0]);
      mockOfferRepo.count.mockResolvedValue(3);

      const result = await service.listEmployerCandidatesOffers(
        'employer-1',
        {},
      );

      expect(result.emptyStateMessage).toBeNull();
    });
  });

  describe('offer status events', () => {
    it('should publish when a candidate accepts an offer', async () => {
      const events: Array<{ status: string; offerId: string }> = [];
      const unsubscribe = service.subscribeEmployerOfferStatus(
        'employer-1',
        (event) => events.push(event),
      );

      const offer = {
        id: 'offer-1',
        candidate_user_id: 'candidate-1',
        employer_user_id: 'employer-1',
        role_title: 'Dev',
        status: OfferStatus.PENDING,
        expires_at: new Date(Date.now() + 86400000),
      };
      mockOfferRepo.findOne.mockResolvedValue(offer);
      mockOfferRepo.update
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValueOnce({ affected: 1 });
      mockUserRepo.findOne.mockResolvedValue({
        id: 'candidate-1',
        first_name: 'Bob',
        last_name: 'Candidate',
      });
      mockNotificationDispatch.notifyOfferAccepted.mockResolvedValue(undefined);

      await service.respondToOffer('candidate-1', 'offer-1', 'accept');

      unsubscribe();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'offer_status_changed',
        offerId: 'offer-1',
        status: OfferStatus.ACCEPTED,
        candidateName: 'Bob Candidate',
      });
    });

    it('should publish when a candidate declines an offer', async () => {
      const events: unknown[] = [];
      const unsubscribe = service.subscribeEmployerOfferStatus(
        'employer-1',
        (event) => events.push(event),
      );

      const offer = {
        id: 'offer-2',
        candidate_user_id: 'candidate-2',
        employer_user_id: 'employer-1',
        role_title: 'Designer',
        status: OfferStatus.PENDING,
        expires_at: new Date(Date.now() + 86400000),
      };
      mockOfferRepo.findOne.mockResolvedValue(offer);
      mockOfferRepo.update
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValueOnce({ affected: 1 });
      mockUserRepo.findOne.mockResolvedValue({
        id: 'candidate-2',
        first_name: 'Sam',
        last_name: 'Lee',
      });
      mockNotificationDispatch.notifyOfferDeclined.mockResolvedValue(undefined);

      await service.respondToOffer('candidate-2', 'offer-2', 'decline');

      unsubscribe();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        offerId: 'offer-2',
        status: OfferStatus.DECLINED,
      });
    });

    it('should allow idempotent unsubscribe and drop stream when last listener leaves', () => {
      const unsubscribe = service.subscribeEmployerOfferStatus(
        'employer-1',
        jest.fn(),
      );

      unsubscribe();
      unsubscribe();

      const streams = (
        service as unknown as { offerStatusStreams: Map<string, unknown> }
      ).offerStatusStreams;
      expect(streams.has('employer-1')).toBe(false);
    });
  });

  describe('listEmployerOffers - expiry marking', () => {
    it('should bulk-expire stale PENDING offers before querying', async () => {
      // expireStaleOffers update called first
      mockOfferRepo.update.mockResolvedValue({ affected: 1 });
      // After expiry, findAndCount returns the updated state
      const activeOffer = {
        id: 'offer-2',
        employer_user_id: 'employer-1',
        status: OfferStatus.PENDING,
        expires_at: new Date(Date.now() + 86400000),
      };
      mockOfferRepo.findAndCount.mockResolvedValue([[activeOffer], 1]);

      const result = await service.listEmployerOffers('employer-1', {});

      expect(result.offers[0].status).toBe(OfferStatus.PENDING);
      expect(mockOfferRepo.update).toHaveBeenCalled();
    });

    it('should return offers as-is when no expiry needed', async () => {
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      const activeOffer = {
        id: 'offer-1',
        employer_user_id: 'employer-1',
        status: OfferStatus.PENDING,
        expires_at: new Date(Date.now() + 86400000),
      };
      mockOfferRepo.findAndCount.mockResolvedValue([[activeOffer], 1]);

      const result = await service.listEmployerOffers('employer-1', {});

      expect(result.offers[0].status).toBe(OfferStatus.PENDING);
    });

    it('should not affect already accepted/declined offers', async () => {
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      const acceptedOffer = {
        id: 'offer-1',
        employer_user_id: 'employer-1',
        status: OfferStatus.ACCEPTED,
        expires_at: new Date(Date.now() - 86400000), // old but already accepted
      };
      mockOfferRepo.findAndCount.mockResolvedValue([[acceptedOffer], 1]);

      const result = await service.listEmployerOffers('employer-1', {});

      expect(result.offers[0].status).toBe(OfferStatus.ACCEPTED);
    });
  });

  describe('markHireComplete', () => {
    it('should increment hire_count without changing accepted invite status', async () => {
      const offer = {
        id: 'offer-1',
        employer_user_id: 'employer-1',
        candidate_user_id: 'candidate-1',
        status: OfferStatus.ACCEPTED,
      };
      mockOfferRepo.findOne.mockResolvedValue(offer);

      const mockManager = {
        increment: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockOfferRepo.manager.transaction.mockImplementation(
        async (cb: (manager: unknown) => Promise<unknown>) => {
          return cb(mockManager);
        },
      );

      const result = await service.markHireComplete('employer-1', 'offer-1');

      expect(result.status).toBe(OfferStatus.ACCEPTED);
      expect(mockOfferRepo.manager.transaction).toHaveBeenCalled();
      expect(mockManager.increment).toHaveBeenCalledWith(
        EmployerProfile,
        { user_id: 'employer-1' },
        'hire_count',
        1,
      );
    });

    it('should throw NotFoundError if offer does not exist', async () => {
      mockOfferRepo.findOne.mockResolvedValue(null);

      await expect(
        service.markHireComplete('employer-1', 'offer-999'),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw BadRequestError if offer is not in ACCEPTED status', async () => {
      const offer = {
        id: 'offer-1',
        employer_user_id: 'employer-1',
        status: OfferStatus.PENDING,
      };
      mockOfferRepo.findOne.mockResolvedValue(offer);

      await expect(
        service.markHireComplete('employer-1', 'offer-1'),
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('withdrawOffer', () => {
    it('should withdraw a pending offer', async () => {
      mockOfferRepo.findOne.mockResolvedValue({
        id: 'offer-1',
        employer_user_id: 'employer-1',
        status: OfferStatus.PENDING,
      });
      mockOfferRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.withdrawOffer('employer-1', 'offer-1');

      expect(result).toEqual({
        status: 'success',
        message: 'Offer withdrawn',
      });
      expect(mockOfferRepo.update).toHaveBeenCalledWith(
        { id: 'offer-1', status: OfferStatus.PENDING },
        { status: OfferStatus.WITHDRAWN },
      );
    });

    it('should reject withdrawing a non-pending offer', async () => {
      mockOfferRepo.findOne.mockResolvedValue({
        id: 'offer-1',
        employer_user_id: 'employer-1',
        status: OfferStatus.ACCEPTED,
      });

      await expect(
        service.withdrawOffer('employer-1', 'offer-1'),
      ).rejects.toThrow('Only pending offers can be withdrawn');
    });
  });

  describe('listCandidateOffers - enrichment', () => {
    it('should include is_employer_verified in enriched offers', async () => {
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      const offers = [
        {
          id: 'offer-1',
          employer_user_id: 'employer-1',
          candidate_user_id: 'candidate-1',
          status: OfferStatus.PENDING,
          expires_at: new Date(Date.now() + 86400000),
          created_at: new Date(),
        },
      ];
      mockOfferRepo.findAndCount.mockResolvedValue([offers, 1]);
      mockEmployerProfileRepo.find.mockResolvedValue([
        { user_id: 'employer-1', is_verified: true },
      ]);

      const result = await service.listCandidateOffers('candidate-1', {});

      expect(result.offers[0].is_employer_verified).toBe(true);
      expect(result.total_pages).toBe(1);
    });

    it('should default is_employer_verified to false if no profile found', async () => {
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      const offers = [
        {
          id: 'offer-1',
          employer_user_id: 'employer-2',
          candidate_user_id: 'candidate-1',
          status: OfferStatus.PENDING,
          expires_at: new Date(Date.now() + 86400000),
          created_at: new Date(),
        },
      ];
      mockOfferRepo.findAndCount.mockResolvedValue([offers, 1]);
      mockEmployerProfileRepo.find.mockResolvedValue([]);

      const result = await service.listCandidateOffers('candidate-1', {});

      expect(result.offers[0].is_employer_verified).toBe(false);
    });
  });

  describe('getOfferForCandidate - enrichment', () => {
    it('should include is_employer_verified from employer profile', async () => {
      const offer = {
        id: 'offer-1',
        employer_user_id: 'employer-1',
        candidate_user_id: 'candidate-1',
        status: OfferStatus.ACCEPTED,
        expires_at: new Date(Date.now() + 86400000),
      };
      mockOfferRepo.findOne.mockResolvedValue(offer);
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      mockEmployerProfileRepo.findOne.mockResolvedValue({
        is_verified: true,
      });

      const result = await service.getOfferForCandidate(
        'candidate-1',
        'offer-1',
      );

      expect(result.is_employer_verified).toBe(true);
    });

    it('should default is_employer_verified to false if profile missing', async () => {
      const offer = {
        id: 'offer-1',
        employer_user_id: 'employer-1',
        candidate_user_id: 'candidate-1',
        status: OfferStatus.PENDING,
        expires_at: new Date(Date.now() + 86400000),
      };
      mockOfferRepo.findOne.mockResolvedValue(offer);
      mockOfferRepo.update.mockResolvedValue({ affected: 0 });
      mockEmployerProfileRepo.findOne.mockResolvedValue(null);

      const result = await service.getOfferForCandidate(
        'candidate-1',
        'offer-1',
      );

      expect(result.is_employer_verified).toBe(false);
    });
  });
});
