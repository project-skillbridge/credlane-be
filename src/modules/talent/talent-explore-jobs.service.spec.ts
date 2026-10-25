import { ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  EmployerRole,
  EmployerRoleStatus,
  EmployerRoleVisibility,
} from '../employer-roles/entities/employer-role.entity';
import { EmployerProfile } from '../employer/entities/employer-profile.entity';
import { EmployerPoolProfile } from './entities/employer-pool-profile.entity';
import { TalentProfile } from './entities/talent-profile.entity';
import { TalentRoleInterest } from './entities/talent-role-interest.entity';
import { TalentExploreJobsService } from './talent-explore-jobs.service';

describe('TalentExploreJobsService', () => {
  let service: TalentExploreJobsService;

  const mockDataSource = {
    transaction: jest.fn(),
  };
  const mockRoleRepo = {
    createQueryBuilder: jest.fn(),
  };
  const mockInterestRepo = {
    find: jest.fn(),
    query: jest.fn(),
  };
  const mockTalentProfileRepo = {
    findOne: jest.fn(),
  };
  const mockPoolProfileRepo = {
    findOne: jest.fn(),
  };
  const mockEmployerProfileRepo = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TalentExploreJobsService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: getRepositoryToken(EmployerRole), useValue: mockRoleRepo },
        {
          provide: getRepositoryToken(TalentRoleInterest),
          useValue: mockInterestRepo,
        },
        {
          provide: getRepositoryToken(TalentProfile),
          useValue: mockTalentProfileRepo,
        },
        {
          provide: getRepositoryToken(EmployerPoolProfile),
          useValue: mockPoolProfileRepo,
        },
        {
          provide: getRepositoryToken(EmployerProfile),
          useValue: mockEmployerProfileRepo,
        },
      ],
    }).compile();

    service = module.get(TalentExploreJobsService);
    jest.clearAllMocks();
  });

  it('rejects interest clicks from talent that is not Job Ready', async () => {
    mockPoolProfileRepo.findOne.mockResolvedValue(null);

    await expect(service.markInterested('talent-1', 'role-1')).rejects.toThrow(
      'Complete your job-ready assessment to express interest.',
    );
  });

  it('returns conflict when a public role has reached applicant cap', async () => {
    mockPoolProfileRepo.findOne.mockResolvedValue({ id: 'pool-1' });
    const manager = {
      query: jest.fn().mockResolvedValue([{ count: 0 }]),
      findOne: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'role-1',
          status: EmployerRoleStatus.ACTIVE,
          visibility: EmployerRoleVisibility.PUBLIC,
          applicant_cap: 2,
          interested_count: 2,
        })
        .mockResolvedValueOnce(null),
      save: jest.fn(),
      increment: jest.fn(),
    };
    mockDataSource.transaction.mockImplementation(
      async (cb: (manager: unknown) => Promise<unknown>) => cb(manager),
    );

    await expect(service.markInterested('talent-1', 'role-1')).rejects.toThrow(
      ConflictException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('returns the documented weekly cap payload when the talent has used all clicks', async () => {
    mockPoolProfileRepo.findOne.mockResolvedValue({ id: 'pool-1' });
    const manager = {
      query: jest.fn().mockResolvedValue([{ count: 10 }]),
      findOne: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'role-1',
          status: EmployerRoleStatus.ACTIVE,
          visibility: EmployerRoleVisibility.PUBLIC,
          applicant_cap: null,
          interested_count: 0,
        })
        .mockResolvedValueOnce(null),
      save: jest.fn(),
      increment: jest.fn(),
    };
    mockDataSource.transaction.mockImplementation(
      async (cb: (manager: unknown) => Promise<unknown>) => cb(manager),
    );

    await expect(
      service.markInterested('talent-1', 'role-1'),
    ).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({
        message:
          "You've reached your weekly limit of 10 expressions of interest. Try again next week.",
        data: expect.objectContaining({ weekly_remaining: 0 }),
      }),
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('returns remaining weekly clicks after saving a new interest', async () => {
    mockPoolProfileRepo.findOne.mockResolvedValue({ id: 'pool-1' });
    const clickedAt = new Date('2026-05-24T15:25:25.250Z');
    const manager = {
      query: jest.fn().mockResolvedValue([{ count: 3 }]),
      findOne: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'role-1',
          status: EmployerRoleStatus.ACTIVE,
          visibility: EmployerRoleVisibility.PUBLIC,
          applicant_cap: null,
          interested_count: 0,
        })
        .mockResolvedValueOnce(null),
      save: jest.fn().mockResolvedValue({
        role_id: 'role-1',
        created_at: clickedAt,
      }),
      increment: jest.fn(),
    };
    mockDataSource.transaction.mockImplementation(
      async (cb: (manager: unknown) => Promise<unknown>) => cb(manager),
    );

    const result = await service.markInterested('talent-1', 'role-1');

    expect(result).toEqual({
      role_id: 'role-1',
      clicked_at: clickedAt,
      weekly_remaining: 6,
    });
    expect(manager.increment).toHaveBeenCalledWith(
      EmployerRole,
      { id: 'role-1' },
      'interested_count',
      1,
    );
  });
});
