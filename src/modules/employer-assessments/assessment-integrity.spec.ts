import { evaluateIntegrity } from './assessment-integrity';

const base = {
  elapsedSeconds: 600,
  timeLimitSeconds: 1800,
  questionCount: 10,
};

describe('evaluateIntegrity', () => {
  it('is clean with no signals and a normal pace', () => {
    expect(evaluateIntegrity({ ...base, events: {} })).toMatchObject({
      level: 'clean',
      reasons: [],
    });
  });

  it('asks for review after a few tab switches and flags many', () => {
    expect(
      evaluateIntegrity({ ...base, events: { tabSwitches: 3 } }).level,
    ).toBe('review');
    const flagged = evaluateIntegrity({ ...base, events: { tabSwitches: 8 } });
    expect(flagged.level).toBe('flagged');
    expect(flagged.reasons[0]).toContain('8 times');
  });

  it('reviews or flags long time away', () => {
    expect(
      evaluateIntegrity({ ...base, events: { awaySeconds: 75 } }).level,
    ).toBe('review');
    const flagged = evaluateIntegrity({
      ...base,
      events: { awaySeconds: 240 },
    });
    expect(flagged.level).toBe('flagged');
    expect(flagged.reasons[0]).toContain('4 minutes');
  });

  it('reviews copy and paste attempts', () => {
    expect(
      evaluateIntegrity({ ...base, events: { copyAttempts: 1 } }).reasons,
    ).toContain('Tried to copy the question text');
    expect(
      evaluateIntegrity({ ...base, events: { pasteAttempts: 2 } }).level,
    ).toBe('review');
  });

  it('flags a finish faster than a person can read', () => {
    const report = evaluateIntegrity({ ...base, elapsedSeconds: 20 });
    expect(report.level).toBe('flagged');
    expect(report.reasons[0]).toContain(
      'faster than the questions can be read',
    );
  });

  it('reviews going over the time limit but allows a small grace', () => {
    expect(
      evaluateIntegrity({ ...base, elapsedSeconds: 1800 + 20 }).level,
    ).toBe('clean');
    expect(
      evaluateIntegrity({ ...base, elapsedSeconds: 1800 + 120 }).level,
    ).toBe('review');
  });

  it('only reviews a shared network, with a caveat', () => {
    const report = evaluateIntegrity({ ...base, sharedNetwork: true });
    expect(report.level).toBe('review');
    expect(report.reasons[0]).toContain('shared office');
  });

  it('takes the most severe level and lists every reason', () => {
    const report = evaluateIntegrity({
      ...base,
      elapsedSeconds: 10,
      events: { tabSwitches: 4, copyAttempts: 1 },
    });
    expect(report.level).toBe('flagged');
    expect(report.reasons).toHaveLength(3);
  });

  it('does not judge speed or time when elapsed is unknown', () => {
    expect(evaluateIntegrity({ ...base, elapsedSeconds: null }).level).toBe(
      'clean',
    );
  });

  it('clamps garbage input from the browser', () => {
    const report = evaluateIntegrity({
      ...base,
      events: { tabSwitches: -5, awaySeconds: Number.NaN, copyAttempts: 1e12 },
    });
    expect(report.events.tabSwitches).toBe(0);
    expect(report.events.awaySeconds).toBe(0);
    expect(report.events.copyAttempts).toBe(100000);
  });
});
