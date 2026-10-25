import { RoleMatchAlertService } from './role-match-alert.service';

function setup(pool: unknown, roles: unknown[]) {
  const roleRepo = { find: jest.fn().mockResolvedValue(roles) };
  const poolRepo = { findOne: jest.fn().mockResolvedValue(pool) };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const service = new RoleMatchAlertService(
    roleRepo as never,
    poolRepo as never,
    notifications as never,
  );
  return { service, notifications };
}

const role = (id: string, employer: string, level: string | null) => ({
  id,
  title: `Role ${id}`,
  employer_user_id: employer,
  level,
});

describe('RoleMatchAlertService', () => {
  it('sends one alert per employer for roles that fit track and level', async () => {
    const { service, notifications } = setup(
      { track: 'backend_developer', verified_level: 'mid' },
      [
        role('r1', 'e1', 'mid'),
        role('r2', 'e1', null),
        role('r3', 'e1', 'senior'),
        role('r4', 'e2', 'mid'),
      ],
    );
    await service.notifyForCandidate('p1', 'u1');
    expect(notifications.create).toHaveBeenCalledTimes(2);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'e1',
        data: expect.objectContaining({
          candidate_user_id: 'u1',
          role_ids: ['r1', 'r2'],
        }),
      }),
    );
  });

  it('does nothing without a pool track and never throws', async () => {
    const none = setup({ track: null, verified_level: 'mid' }, []);
    await none.service.notifyForCandidate('p1', 'u1');
    expect(none.notifications.create).not.toHaveBeenCalled();

    const broken = setup(null, []);
    broken.notifications.create.mockRejectedValue(new Error('x'));
    await expect(
      broken.service.notifyForCandidate('p1', 'u1'),
    ).resolves.toBeUndefined();
  });
});
