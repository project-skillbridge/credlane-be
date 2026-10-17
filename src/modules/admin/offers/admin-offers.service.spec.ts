import { AdminOffersService } from './admin-offers.service';
import { OfferStatus } from '../../offers/entities/offer.entity';

// ─── Test helpers ─────────────────────────────────────────────────

/** Builds a chainable query-builder mock that resolves getRawMany, getRawOne, getManyAndCount, and getCount to a fixed value. */
const buildQueryBuilder = (resolvedValue: unknown) => {
  const qb: Record<string, jest.Mock> = {
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    orderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    leftJoin: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(resolvedValue),
    getRawOne: jest.fn().mockResolvedValue(resolvedValue),
    getManyAndCount: jest.fn().mockResolvedValue(resolvedValue),
    getCount: jest.fn().mockResolvedValue(resolvedValue),
  };
  for (const key of Object.keys(qb)) {
    if (
      key !== 'getRawMany' &&
      key !== 'getRawOne' &&
      key !== 'getManyAndCount' &&
      key !== 'getCount'
    ) {
      qb[key].mockReturnValue(qb);
    }
  }
  return qb;
};

describe('AdminOffersService', () => {
  // ─── getStats ───────────────────────────────────────────────────

  describe('getStats', () => {
    let service: AdminOffersService;
    let offerRepo: { createQueryBuilder: jest.Mock };

    beforeEach(() => {
      offerRepo = { createQueryBuilder: jest.fn() };
      service = new AdminOffersService(
        offerRepo as never,
        {} as never,
        {} as never,
      );
    });

    it('computes correct rates and trends with data', async () => {
      // Four calls: countsByStatus(current), countsByStatus(prior),
      //             avgHireDays(current),    avgHireDays(prior)
      const currentStatusRows = [
        { status: OfferStatus.PENDING, cnt: '5' },
        { status: OfferStatus.ACCEPTED, cnt: '3' },
      ];
      const priorStatusRows = [
        { status: OfferStatus.PENDING, cnt: '4' },
        { status: OfferStatus.ACCEPTED, cnt: '2' },
      ];

      let callIdx = 0;
      offerRepo.createQueryBuilder.mockImplementation(() => {
        const idx = callIdx++;
        if (idx === 0) return buildQueryBuilder(currentStatusRows);
        if (idx === 1) return buildQueryBuilder(priorStatusRows);
        if (idx === 2) return buildQueryBuilder({ avg_days: '7.5' });
        return buildQueryBuilder({ avg_days: '10.2' });
      });

      const stats = await service.getStats();

      // total = 5+3 = 8
      expect(stats.total_offers_sent.value).toBe(8);
      // acceptance rate = 3/8 * 100 = 38%
      expect(stats.offer_to_acceptance_rate.value).toBe(38);
      // accepted is the positive terminal invite outcome under the new lifecycle
      expect(stats.offer_to_hire_rate.value).toBe(38);
      // avg hire days = round(7.5) = 8
      expect(stats.avg_time_offer_to_hire_days.value).toBe(8);

      // Trend: total 8 vs 6 prior => up
      expect(stats.total_offers_sent.trend.direction).toBe('up');
    });

    it('returns zero values with no data', async () => {
      offerRepo.createQueryBuilder.mockImplementation(() => {
        const qb = buildQueryBuilder([]);
        qb.getRawOne.mockResolvedValue({ avg_days: null });
        return qb;
      });

      const stats = await service.getStats();

      expect(stats.total_offers_sent.value).toBe(0);
      expect(stats.offer_to_acceptance_rate.value).toBe(0);
      expect(stats.offer_to_hire_rate.value).toBe(0);
      expect(stats.avg_time_offer_to_hire_days.value).toBe(0);
      expect(stats.total_offers_sent.trend).toEqual({
        direction: null,
        change_percent: null,
      });
    });
  });

  // ─── getFunnel ──────────────────────────────────────────────────

  describe('getFunnel', () => {
    let service: AdminOffersService;
    let offerRepo: { createQueryBuilder: jest.Mock };

    beforeEach(() => {
      offerRepo = { createQueryBuilder: jest.fn() };
      service = new AdminOffersService(
        offerRepo as never,
        {} as never,
        {} as never,
      );
    });

    it('accumulates stage counts correctly and computes drop-off', async () => {
      offerRepo.createQueryBuilder.mockReturnValue(
        buildQueryBuilder([
          { status: OfferStatus.PENDING, count: '10' },
          { status: OfferStatus.ACCEPTED, count: '2' },
          { status: OfferStatus.DECLINED, count: '1' },
        ]),
      );

      const result = await service.getFunnel();

      expect(result.empty).toBe(false);
      expect(result.total).toBe(13);

      // Pending = 10+2+1 = 13 (all offers pass through pending)
      const pending = result.stages.find(
        (s) => s.stage === OfferStatus.PENDING,
      );
      expect(pending?.count).toBe(13);

      const accepted = result.stages.find(
        (s) => s.stage === OfferStatus.ACCEPTED,
      );
      expect(accepted?.count).toBe(2);
      expect(accepted?.drop_off_percent).toBe(
        Math.round(((13 - 2) / 13) * 100),
      );
    });

    it('returns empty state when no offers exist', async () => {
      offerRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([]));

      const result = await service.getFunnel();

      expect(result.empty).toBe(true);
      expect(result.total).toBe(0);
    });
  });

  // ─── findAll ────────────────────────────────────────────────────

  describe('findAll', () => {
    let service: AdminOffersService;
    let offerRepo: { createQueryBuilder: jest.Mock };
    let employerProfileRepo: { find: jest.Mock };

    beforeEach(() => {
      offerRepo = { createQueryBuilder: jest.fn() };
      employerProfileRepo = { find: jest.fn().mockResolvedValue([]) };
      service = new AdminOffersService(
        offerRepo as never,
        {} as never,
        employerProfileRepo as never,
      );
    });

    it('returns paginated offers with candidate and employer names', async () => {
      const mockOffer = {
        id: 'offer-1',
        employer_user_id: 'emp-1',
        candidate_user_id: 'cand-1',
        role_title: 'Frontend Developer',
        status: OfferStatus.PENDING,
        created_at: new Date('2026-01-15'),
        updated_at: new Date('2026-01-15'),
        responded_at: null,
        candidate: {
          first_name: 'Jane',
          last_name: 'Doe',
        },
        employer: {
          first_name: 'John',
          last_name: 'Smith',
        },
      };

      offerRepo.createQueryBuilder.mockReturnValue(
        buildQueryBuilder([[mockOffer], 1]),
      );
      employerProfileRepo.find.mockResolvedValue([
        { user_id: 'emp-1', company_name: 'Acme Inc' },
      ]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.total_pages).toBe(1);
      expect(result.offers).toHaveLength(1);
      expect(result.offers[0].candidate_name).toBe('Jane Doe');
      expect(result.offers[0].employer_name).toBe('Acme Inc');
      expect(result.offers[0].role_title).toBe('Frontend Developer');
      expect(result.offers[0].date_resolved).toBeNull(); // PENDING has no resolution
    });

    it('falls back to employer fullname when company_name is null', async () => {
      const mockOffer = {
        id: 'offer-2',
        employer_user_id: 'emp-2',
        candidate_user_id: 'cand-2',
        role_title: 'Backend Developer',
        status: OfferStatus.ACCEPTED,
        created_at: new Date('2026-02-01'),
        updated_at: new Date('2026-02-05'),
        responded_at: new Date('2026-02-05'),
        candidate: { first_name: 'Bob', last_name: 'Builder' },
        employer: { first_name: 'Alice', last_name: 'Corp' },
      };

      offerRepo.createQueryBuilder.mockReturnValue(
        buildQueryBuilder([[mockOffer], 1]),
      );
      employerProfileRepo.find.mockResolvedValue([]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.offers[0].employer_name).toBe('Alice Corp');
      expect(result.offers[0].date_resolved).toEqual(new Date('2026-02-05'));
    });

    it('returns empty result when no offers match', async () => {
      offerRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([[], 0]));

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.offers).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.total_pages).toBe(0);
    });

    it('applies filters for status, date range, and search correctly', async () => {
      const qb = buildQueryBuilder([[], 0]);
      offerRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({
        status: OfferStatus.ACCEPTED,
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        search: 'Jane',
      });

      expect(qb.andWhere).toHaveBeenCalledWith('offer.status = :status', {
        status: OfferStatus.ACCEPTED,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'offer.created_at >= :dateFrom',
        { dateFrom: expect.any(Date) },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('offer.created_at < :dateTo', {
        dateTo: expect.any(Date),
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE :search'),
        { search: '%Jane%' },
      );
    });

    it('applies correct pagination skip and take for page > 1', async () => {
      const qb = buildQueryBuilder([[], 0]);
      offerRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ page: 3, limit: 15 });

      expect(qb.skip).toHaveBeenCalledWith(30);
      expect(qb.take).toHaveBeenCalledWith(15);
    });
  });
});
