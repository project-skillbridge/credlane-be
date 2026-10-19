import { AdminPaymentsService } from './admin-payments.service';
import { EmployerSubscriptionStatus } from '../../payments/entities/employer-subscription.entity';
import { TalentSubscriptionStatus } from '../../payments/entities/talent-subscription.entity';
import {
  TransactionStatus,
  SubscriberType,
} from '../../payments/entities/transaction.entity';

const chainable = (overrides: Record<string, unknown> = {}) => {
  const qb: Record<string, jest.Mock> = {
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    innerJoinAndSelect: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    getRawMany: jest.fn(),
    getRawOne: jest.fn(),
    getCount: jest.fn(),
    getQuery: jest.fn().mockReturnValue('SELECT 1'),
    ...overrides,
  };

  for (const key of Object.keys(qb)) {
    if (!['getRawMany', 'getRawOne', 'getCount', 'getQuery'].includes(key)) {
      qb[key].mockReturnValue(qb);
    }
  }
  return qb;
};

describe('AdminPaymentsService', () => {
  let employerPackageRepo: { find: jest.Mock; createQueryBuilder: jest.Mock };
  let employerSubscriptionRepo: {
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let talentSubscriptionRepo: {
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let transactionRepo: { count: jest.Mock; createQueryBuilder: jest.Mock };
  let service: AdminPaymentsService;

  beforeEach(() => {
    employerPackageRepo = { find: jest.fn(), createQueryBuilder: jest.fn() };
    employerSubscriptionRepo = {
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    talentSubscriptionRepo = {
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    transactionRepo = { count: jest.fn(), createQueryBuilder: jest.fn() };

    service = new AdminPaymentsService(
      employerPackageRepo as never,
      employerSubscriptionRepo as never,
      talentSubscriptionRepo as never,
      transactionRepo as never,
    );
  });

  describe('getStats', () => {
    it('returns stat cards with computed values', async () => {
      transactionRepo.createQueryBuilder.mockReturnValue(
        chainable({
          getRawOne: jest.fn().mockResolvedValue({ total: '5499.99' }),
        }),
      );
      employerSubscriptionRepo.count.mockResolvedValue(12);
      talentSubscriptionRepo.count.mockResolvedValue(45);
      transactionRepo.count.mockResolvedValue(3);

      const result = await service.getStats();

      expect(result).toEqual({
        total_revenue: { value: 5499.99, currency: 'USD' },
        active_employer_subscriptions: 12,
        active_talent_subscriptions: 45,
        failed_payment_count: 3,
      });
    });

    it('returns zero revenue when no successful transactions exist', async () => {
      transactionRepo.createQueryBuilder.mockReturnValue(
        chainable({ getRawOne: jest.fn().mockResolvedValue({ total: null }) }),
      );
      employerSubscriptionRepo.count.mockResolvedValue(0);
      talentSubscriptionRepo.count.mockResolvedValue(0);
      transactionRepo.count.mockResolvedValue(0);

      const result = await service.getStats();

      expect(result).toEqual({
        total_revenue: { value: 0, currency: 'USD' },
        active_employer_subscriptions: 0,
        active_talent_subscriptions: 0,
        failed_payment_count: 0,
      });
    });

    it('counts only ACTIVE employer subscriptions', async () => {
      transactionRepo.createQueryBuilder.mockReturnValue(
        chainable({ getRawOne: jest.fn().mockResolvedValue({ total: '0' }) }),
      );
      employerSubscriptionRepo.count.mockResolvedValue(8);
      talentSubscriptionRepo.count.mockResolvedValue(20);
      transactionRepo.count.mockResolvedValue(1);

      const result = await service.getStats();

      expect(employerSubscriptionRepo.count).toHaveBeenCalledWith({
        where: { status: EmployerSubscriptionStatus.ACTIVE },
      });
      expect(result.active_employer_subscriptions).toBe(8);
    });

    it('counts only FAILED transactions', async () => {
      transactionRepo.createQueryBuilder.mockReturnValue(
        chainable({ getRawOne: jest.fn().mockResolvedValue({ total: '0' }) }),
      );
      employerSubscriptionRepo.count.mockResolvedValue(0);
      talentSubscriptionRepo.count.mockResolvedValue(0);
      transactionRepo.count.mockResolvedValue(5);

      const result = await service.getStats();

      expect(transactionRepo.count).toHaveBeenCalledWith({
        where: { status: TransactionStatus.FAILED },
      });
      expect(result.failed_payment_count).toBe(5);
    });
  });

  describe('getRevenueChart', () => {
    const makeRow = (period: string, amount: number) => ({
      period: new Date(period),
      amount: String(amount),
    });

    it('groups revenue by employer and talent with monthly default period', async () => {
      const employerRows = [
        makeRow('2026-01-01', 1200),
        makeRow('2026-02-01', 980),
      ];
      const talentRows = [makeRow('2026-01-01', 450)];

      transactionRepo.createQueryBuilder
        .mockReturnValueOnce(
          chainable({ getRawMany: jest.fn().mockResolvedValue(employerRows) }),
        )
        .mockReturnValueOnce(
          chainable({ getRawMany: jest.fn().mockResolvedValue(talentRows) }),
        );

      const result = await service.getRevenueChart({});

      expect(result.employer_revenue).toHaveLength(2);
      expect(result.employer_revenue[0]).toEqual({
        period: '2026-01-01T00:00:00.000Z',
        amount: 1200,
      });
      expect(result.talent_revenue).toHaveLength(1);
      expect(result.talent_revenue[0]).toEqual({
        period: '2026-01-01T00:00:00.000Z',
        amount: 450,
      });
    });

    it('passes the correct date_trunc parameter for each period', async () => {
      transactionRepo.createQueryBuilder.mockReturnValue(
        chainable({ getRawMany: jest.fn().mockResolvedValue([]) }),
      );

      await service.getRevenueChart({ period: 'yearly' });

      const calls = transactionRepo.createQueryBuilder.mock.results;
      const sql1 = (calls[0].value as ReturnType<typeof chainable>).select.mock
        .calls[0][0] as string;
      expect(sql1).toContain("DATE_TRUNC('year'");
    });

    it('returns empty arrays when no data exists', async () => {
      transactionRepo.createQueryBuilder.mockReturnValue(
        chainable({ getRawMany: jest.fn().mockResolvedValue([]) }),
      );

      const result = await service.getRevenueChart({ period: 'monthly' });

      expect(result).toEqual({ employer_revenue: [], talent_revenue: [] });
    });
  });

  describe('getEmployerPackages', () => {
    it('returns packages sorted by price ascending', async () => {
      employerPackageRepo.find.mockResolvedValue([
        {
          id: 'pkg-1',
          name: 'Free',
          price: '0',
          offer_limit: 2,
          features: null,
          is_free: true,
        },
        {
          id: 'pkg-2',
          name: 'Paid',
          price: '0',
          offer_limit: null,
          features: null,
          is_free: false,
        },
      ]);

      const result = await service.getEmployerPackages();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Free');
      expect(result[0].price).toBe(0);
      expect(result[0].offer_limit).toBe(2);
      expect(result[1].name).toBe('Paid');
      expect(result[1].is_free).toBe(false);
      expect(employerPackageRepo.find).toHaveBeenCalledWith({
        order: { price: 'ASC' },
      });
    });

    it('returns empty array when no packages exist', async () => {
      employerPackageRepo.find.mockResolvedValue([]);

      const result = await service.getEmployerPackages();

      expect(result).toEqual([]);
    });
  });

  describe('getSubscriptions', () => {
    it('returns merged employer + talent subscriptions when no type filter', async () => {
      // Items are sorted by start_date DESC in the service
      const earlyDate = new Date('2026-01-01');
      const laterDate = new Date('2026-03-01');

      const employerQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'es-1',
            subscriber_name: 'Acme Corp',
            type: 'employer',
            package_tier: 'Free',
            monthly_price: '0',
            status: 'active',
            start_date: earlyDate,
            next_billing_date: null,
            grace_period_ends_at: null,
          },
        ]),
        getCount: jest.fn().mockResolvedValue(1),
      });
      const talentQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'ts-1',
            subscriber_name: 'Jane Talent',
            type: 'talent',
            package_tier: null,
            monthly_price: '9.99',
            status: 'active',
            start_date: laterDate,
            next_billing_date: new Date('2026-04-01'),
            grace_period_ends_at: null,
          },
        ]),
        getCount: jest.fn().mockResolvedValue(1),
      });

      employerSubscriptionRepo.createQueryBuilder.mockReturnValue(employerQb);
      talentSubscriptionRepo.createQueryBuilder.mockReturnValue(talentQb);

      const result = await service.getSubscriptions({});

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      // Sorted by start_date DESC — talent (later date) comes first
      expect(result.items[0].subscriber_name).toBe('Jane Talent');
      expect(result.items[0].type).toBe('talent');
      expect(result.items[1].subscriber_name).toBe('Acme Corp');
      expect(result.items[1].type).toBe('employer');
    });

    it('preserves monthly_price=0 for free plans instead of coercing to null', async () => {
      const dummyQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
      });
      const employerQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'es-1',
            subscriber_name: 'Acme Corp',
            type: 'employer',
            package_tier: 'Free',
            monthly_price: '0',
            status: 'free',
            start_date: new Date(),
            next_billing_date: null,
            grace_period_ends_at: null,
          },
        ]),
        getCount: jest.fn().mockResolvedValue(1),
      });

      employerSubscriptionRepo.createQueryBuilder.mockReturnValue(employerQb);
      talentSubscriptionRepo.createQueryBuilder.mockReturnValue(dummyQb);

      const result = await service.getSubscriptions({ type: 'employer' });

      expect(result.items[0].monthly_price).toBe(0);
    });

    it('applies status + search filters cumulatively in merged mode', async () => {
      const early = new Date('2026-01-01');
      const qb1 = chainable({
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'es-1',
            subscriber_name: 'Acme Corp',
            type: 'employer',
            package_tier: 'Free',
            monthly_price: '0',
            status: 'active',
            start_date: early,
            next_billing_date: null,
            grace_period_ends_at: null,
          },
          {
            id: 'es-2',
            subscriber_name: 'Beta Inc',
            type: 'employer',
            package_tier: 'Paid',
            monthly_price: '49.99',
            status: 'cancelled',
            start_date: early,
            next_billing_date: null,
            grace_period_ends_at: null,
          },
        ]),
        getCount: jest.fn().mockResolvedValue(2),
      });
      const qb2 = chainable({
        getRawMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
      });

      employerSubscriptionRepo.createQueryBuilder.mockReturnValue(qb1);
      talentSubscriptionRepo.createQueryBuilder.mockReturnValue(qb2);

      const result = await service.getSubscriptions({
        status: 'active',
        search: 'acme',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].subscriber_name).toBe('Acme Corp');
      expect(result.items[0].status).toBe('active');
    });

    it('filters by employer type only', async () => {
      const dummyQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
      });
      const employerQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'es-1',
            subscriber_name: 'Acme Corp',
            type: 'employer',
            package_tier: 'Free',
            monthly_price: '0',
            status: 'free',
            start_date: new Date(),
            next_billing_date: null,
            grace_period_ends_at: null,
          },
        ]),
        getCount: jest.fn().mockResolvedValue(1),
      });

      employerSubscriptionRepo.createQueryBuilder.mockReturnValue(employerQb);
      talentSubscriptionRepo.createQueryBuilder.mockReturnValue(dummyQb);

      const result = await service.getSubscriptions({ type: 'employer' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].type).toBe('employer');
      expect(result.total).toBe(1);
    });

    it('filters by talent type only', async () => {
      const dummyQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
      });
      const talentQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'ts-1',
            subscriber_name: 'Jane Talent',
            type: 'talent',
            package_tier: null,
            monthly_price: null,
            status: 'free',
            start_date: new Date(),
            next_billing_date: null,
            grace_period_ends_at: null,
          },
        ]),
        getCount: jest.fn().mockResolvedValue(1),
      });

      employerSubscriptionRepo.createQueryBuilder.mockReturnValue(dummyQb);
      talentSubscriptionRepo.createQueryBuilder.mockReturnValue(talentQb);

      const result = await service.getSubscriptions({ type: 'talent' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].type).toBe('talent');
      expect(result.total).toBe(1);
    });

    it('computes days_left_in_grace for past_due employer subscriptions', async () => {
      const dummyQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
      });
      const futureGrace = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const employerQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'es-1',
            subscriber_name: 'Acme Corp',
            type: 'employer',
            package_tier: 'Paid',
            monthly_price: '49.99',
            status: 'past_due',
            start_date: new Date(),
            next_billing_date: new Date(),
            grace_period_ends_at: futureGrace,
          },
        ]),
        getCount: jest.fn().mockResolvedValue(1),
      });

      employerSubscriptionRepo.createQueryBuilder.mockReturnValue(employerQb);
      talentSubscriptionRepo.createQueryBuilder.mockReturnValue(dummyQb);

      const result = await service.getSubscriptions({ type: 'employer' });

      expect(result.items[0].days_left_in_grace).toBe(3);
      expect(result.items[0].status).toBe('past_due');
    });

    it('returns null days_left_in_grace for talent subscriptions', async () => {
      const dummyQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
      });
      const talentQb = chainable({
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'ts-1',
            subscriber_name: 'Jane Talent',
            type: 'talent',
            package_tier: null,
            monthly_price: null,
            status: 'active',
            start_date: new Date(),
            next_billing_date: null,
            grace_period_ends_at: null,
          },
        ]),
        getCount: jest.fn().mockResolvedValue(1),
      });

      employerSubscriptionRepo.createQueryBuilder.mockReturnValue(dummyQb);
      talentSubscriptionRepo.createQueryBuilder.mockReturnValue(talentQb);

      const result = await service.getSubscriptions({ type: 'talent' });

      expect(result.items[0].days_left_in_grace).toBeNull();
    });

    it('returns empty items when no subscriptions match', async () => {
      employerSubscriptionRepo.createQueryBuilder.mockReturnValue(
        chainable({
          getRawMany: jest.fn().mockResolvedValue([]),
          getCount: jest.fn().mockResolvedValue(0),
        }),
      );
      talentSubscriptionRepo.createQueryBuilder.mockReturnValue(
        chainable({
          getRawMany: jest.fn().mockResolvedValue([]),
          getCount: jest.fn().mockResolvedValue(0),
        }),
      );

      const result = await service.getSubscriptions({});

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getTransactions', () => {
    const rawTxn = (overrides: Record<string, unknown> = {}) => ({
      id: 'txn-1',
      subscriber_name: 'Acme Corp',
      type: 'employer',
      amount: '49.99',
      currency: 'USD',
      date: new Date('2026-01-15'),
      status: 'successful',
      linked_subscription_id: 'es-1',
      ...overrides,
    });

    it('returns paginated transaction rows', async () => {
      const qb = chainable({
        getRawMany: jest.fn().mockResolvedValue([rawTxn()]),
        getCount: jest.fn().mockResolvedValue(1),
      });
      transactionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getTransactions({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: 'txn-1',
        subscriber_name: 'Acme Corp',
        type: 'employer',
        amount: 49.99,
        currency: 'USD',
        date: rawTxn().date,
        status: 'successful',
        linked_subscription_id: 'es-1',
      });
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('filters by transaction status', async () => {
      const qb = chainable({
        getRawMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
      });
      transactionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getTransactions({ status: 'failed' });

      expect(qb.andWhere).toHaveBeenCalledWith('txn.status = :status', {
        status: 'failed',
      });
    });

    it('filters by date range', async () => {
      const qb = chainable({
        getRawMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
      });
      transactionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getTransactions({
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });

      expect(qb.andWhere).toHaveBeenCalledWith('txn.created_at >= :date_from', {
        date_from: '2026-01-01',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'txn.created_at < :date_to_end',
        { date_to_end: '2026-02-01' },
      );
    });

    it('returns empty array when no transactions exist', async () => {
      const qb = chainable({
        getRawMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
      });
      transactionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getTransactions({});

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getTalentSubscriptionSummary', () => {
    it('returns counts and distinct price', async () => {
      talentSubscriptionRepo.count
        .mockResolvedValueOnce(45)
        .mockResolvedValueOnce(8);
      talentSubscriptionRepo.createQueryBuilder.mockReturnValue(
        chainable({
          getRawOne: jest.fn().mockResolvedValue({ price: '9.99' }),
        }),
      );

      const result = await service.getTalentSubscriptionSummary();

      expect(result).toEqual({
        total_active: 45,
        total_cancelled: 8,
        monthly_price: 9.99,
      });
    });

    it('returns null monthly_price when no paid subscriptions exist', async () => {
      talentSubscriptionRepo.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      talentSubscriptionRepo.createQueryBuilder.mockReturnValue(
        chainable({ getRawOne: jest.fn().mockResolvedValue(null) }),
      );

      const result = await service.getTalentSubscriptionSummary();

      expect(result.monthly_price).toBeNull();
    });

    it('counts only ACTIVE talent subscriptions', async () => {
      talentSubscriptionRepo.count
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(5);
      talentSubscriptionRepo.createQueryBuilder.mockReturnValue(
        chainable({ getRawOne: jest.fn().mockResolvedValue(null) }),
      );

      await service.getTalentSubscriptionSummary();

      expect(talentSubscriptionRepo.count).toHaveBeenCalledWith({
        where: { status: TalentSubscriptionStatus.ACTIVE },
      });
    });
  });
});
