import { AssessmentWaitlistNotifier } from './assessment-waitlist.notifier';

describe('AssessmentWaitlistNotifier', () => {
  const entry = (id: string, userId: string) => ({
    id,
    talent_profile: { id: `profile-${id}`, user_id: userId },
  });

  let waitlist: { findPending: jest.Mock; markNotified: jest.Mock };
  let skill: { hasFreshCapacity: jest.Mock };
  let notifications: { notifySkillAssessmentReady: jest.Mock };
  let notifier: AssessmentWaitlistNotifier;

  beforeEach(() => {
    waitlist = {
      findPending: jest
        .fn()
        .mockResolvedValue([entry('w1', 'user-1'), entry('w2', 'user-2')]),
      markNotified: jest.fn().mockResolvedValue(undefined),
    };
    skill = { hasFreshCapacity: jest.fn() };
    notifications = {
      notifySkillAssessmentReady: jest.fn().mockResolvedValue(undefined),
    };
    notifier = new AssessmentWaitlistNotifier(
      waitlist as never,
      skill as never,
      notifications as never,
    );
  });

  it('notifies only talents who now have fresh questions, and marks them done', async () => {
    skill.hasFreshCapacity
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(notifier.processWaitlist()).resolves.toBe(1);

    expect(notifications.notifySkillAssessmentReady).toHaveBeenCalledTimes(1);
    expect(notifications.notifySkillAssessmentReady).toHaveBeenCalledWith(
      'user-1',
    );
    expect(waitlist.markNotified).toHaveBeenCalledWith('w1');
    expect(waitlist.markNotified).not.toHaveBeenCalledWith('w2');
  });

  it('leaves an entry open when notifying fails so it is retried next cycle', async () => {
    skill.hasFreshCapacity.mockResolvedValue(true);
    notifications.notifySkillAssessmentReady
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValueOnce(undefined);

    await expect(notifier.processWaitlist()).resolves.toBe(1);

    expect(waitlist.markNotified).not.toHaveBeenCalledWith('w1');
    expect(waitlist.markNotified).toHaveBeenCalledWith('w2');
  });

  it('does nothing when a previous run is still in progress', async () => {
    let release: () => void = () => undefined;
    waitlist.findPending.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );
    const first = notifier.processWaitlist();
    await expect(notifier.processWaitlist()).resolves.toBe(0);
    release();
    await first;
    expect(waitlist.findPending).toHaveBeenCalledTimes(1);
  });
});
