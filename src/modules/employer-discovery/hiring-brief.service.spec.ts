import { HiringBriefService } from './hiring-brief.service';

const brief = {
  headline: 'Strong frontend engineer worth interviewing now',
  hire_case: 'Scored well on both assessments with solid reasoning shown.',
  strengths: [],
  gaps: [],
  open_ended: [],
  interview_questions: ['Walk me through a hard bug.', 'How do you review?'],
  confidence: 'high',
  confidence_note: 'Both assessments completed.',
};

function setup(opts: { cached?: { source_key: string } | null } = {}) {
  const profileRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1' }) };
  const qb = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getOne: jest
      .fn()
      .mockResolvedValueOnce({
        id: 'r-skill',
        attempt_id: 'a1',
        percentage: 80,
      })
      .mockResolvedValueOnce({
        id: 'r-adv',
        attempt_id: 'a2',
        percentage: 83,
        tier: 'job_ready',
        integrity_confidence: 'high',
      }),
  };
  const resultRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    manager: { find: jest.fn().mockResolvedValue([]) },
  };
  const briefRepo = {
    findOne: jest.fn().mockResolvedValue(opts.cached ?? null),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const generator = { generate: jest.fn().mockResolvedValue(brief) };
  const service = new HiringBriefService(
    profileRepo as never,
    resultRepo as never,
    briefRepo as never,
    generator as never,
  );
  return { service, briefRepo, generator, resultRepo };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('HiringBriefService', () => {
  it('reports no_assessment when the candidate has no profile', async () => {
    const { service, resultRepo } = setup();
    (
      service as never as { profileRepo: { findOne: jest.Mock } }
    ).profileRepo.findOne.mockResolvedValue(null);
    await expect(service.getBrief('u1')).resolves.toEqual({
      status: 'no_assessment',
    });
    expect(resultRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('serves the cached brief without calling the AI when results are unchanged', async () => {
    const { service, generator } = setup({
      cached: { source_key: 'r-skill:r-adv', ...{ brief, stats: {} } } as never,
    });
    const res = await service.getBrief('u1');
    expect(res.status).toBe('ready');
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('starts generation once and stores the brief', async () => {
    const { service, generator, briefRepo } = setup();
    await expect(service.getBrief('u1')).resolves.toEqual({
      status: 'generating',
    });
    await flush();
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(briefRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        talent_profile_id: 'p1',
        source_key: 'r-skill:r-adv',
      }),
      ['talent_profile_id'],
    );
  });

  it('backs off after a failed generation instead of retrying immediately', async () => {
    const { service, generator } = setup();
    generator.generate.mockRejectedValueOnce(new Error('provider down'));
    await service.getBrief('u1');
    await flush();
    // second call: resolve both latest-result lookups again
    const qb = (
      service as never as {
        resultRepo: { createQueryBuilder: jest.Mock };
      }
    ).resultRepo.createQueryBuilder();
    qb.getOne
      .mockResolvedValueOnce({
        id: 'r-skill',
        attempt_id: 'a1',
        percentage: 80,
      })
      .mockResolvedValueOnce({ id: 'r-adv', attempt_id: 'a2', percentage: 83 });
    const res = await service.getBrief('u1');
    expect(res.status).toBe('unavailable');
    expect(generator.generate).toHaveBeenCalledTimes(1);
  });
});
