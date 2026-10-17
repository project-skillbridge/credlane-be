import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentRequiredError } from '../../shared';
import { EmployerBillingService } from './employer-billing.service';
import { EmployerUnlock } from './entities/employer-unlock.entity';
import { EmployerWallet } from './entities/employer-wallet.entity';

describe('EmployerBillingService', () => {
  let service: EmployerBillingService;
  let wallet: Partial<EmployerWallet>;
  let unlocks: Array<Record<string, unknown>>;

  const walletRepo = {
    findOne: jest.fn(),
    save: jest.fn((w: Partial<EmployerWallet>) => Promise.resolve(w)),
    create: jest.fn((w: Partial<EmployerWallet>) => w),
  };
  const unlockRepo = {
    find: jest.fn(),
    count: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((u: Record<string, unknown>) => {
      unlocks.push(u);
      return Promise.resolve(u);
    }),
    create: jest.fn((u: Record<string, unknown>) => u),
    manager: {
      transaction: jest.fn(),
      getRepository: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    unlocks = [];
    wallet = {
      employer_user_id: 'emp-1',
      plan: 'free',
      period_used: 0,
      period_start: new Date(),
      bonus_credits: 3,
    };
    walletRepo.findOne.mockImplementation(() => Promise.resolve(wallet));
    unlockRepo.findOne.mockResolvedValue(null);
    unlockRepo.manager.getRepository.mockImplementation((entity: unknown) =>
      entity === EmployerWallet ? walletRepo : unlockRepo,
    );
    unlockRepo.manager.transaction.mockImplementation(
      (cb: (m: unknown) => unknown) => cb(unlockRepo.manager),
    );

    const module = await Test.createTestingModule({
      providers: [
        EmployerBillingService,
        { provide: getRepositoryToken(EmployerWallet), useValue: walletRepo },
        { provide: getRepositoryToken(EmployerUnlock), useValue: unlockRepo },
      ],
    }).compile();
    service = module.get(EmployerBillingService);
  });

  it('spends a welcome credit on a free plan', async () => {
    const result = await service.unlock('emp-1', 'cand-1');
    expect(result).toEqual({ already_unlocked: false, unlocks_remaining: 2 });
    expect(wallet.bonus_credits).toBe(2);
    expect(unlocks[0]).toMatchObject({ source: 'credit' });
  });

  it('uses plan quota before credits', async () => {
    wallet.plan = 'starter';
    const result = await service.unlock('emp-1', 'cand-1');
    expect(wallet.period_used).toBe(1);
    expect(wallet.bonus_credits).toBe(3);
    expect(result.unlocks_remaining).toBe(14 + 3);
    expect(unlocks[0]).toMatchObject({ source: 'plan' });
  });

  it('never charges twice for the same candidate', async () => {
    unlockRepo.findOne.mockResolvedValue({ id: 'u-1' });
    const result = await service.unlock('emp-1', 'cand-1');
    expect(result.already_unlocked).toBe(true);
    expect(wallet.bonus_credits).toBe(3);
    expect(unlocks).toHaveLength(0);
  });

  it('rejects with 402 when nothing is left', async () => {
    wallet.bonus_credits = 0;
    await expect(service.unlock('emp-1', 'cand-1')).rejects.toBeInstanceOf(
      PaymentRequiredError,
    );
    expect(unlocks).toHaveLength(0);
  });

  it('resets the plan quota after a month', async () => {
    wallet.plan = 'starter';
    wallet.period_used = 15;
    wallet.bonus_credits = 0;
    wallet.period_start = new Date(Date.now() - 32 * 86_400_000);
    const result = await service.unlock('emp-1', 'cand-1');
    expect(result.already_unlocked).toBe(false);
    expect(wallet.period_used).toBe(1);
  });

  it('summarises remaining unlocks', async () => {
    wallet.plan = 'growth';
    wallet.period_used = 10;
    unlockRepo.count.mockResolvedValue(10);
    const summary = await service.getSummary('emp-1');
    expect(summary).toMatchObject({
      plan: 'growth',
      monthly_unlocks: 50,
      used_this_period: 10,
      bonus_credits: 3,
      unlocks_remaining: 43,
      total_unlocked: 10,
    });
  });
});
