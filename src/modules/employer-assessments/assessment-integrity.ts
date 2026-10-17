export type IntegrityEvents = {
  tabSwitches: number;
  awaySeconds: number;
  pasteAttempts: number;
  copyAttempts: number;
};

export type IntegrityLevel = 'clean' | 'review' | 'flagged';

export type IntegrityReport = {
  level: IntegrityLevel;
  /** Plain-language reasons an employer can read; empty when clean. */
  reasons: string[];
  events: IntegrityEvents;
};

export const TAB_SWITCHES_REVIEW = 3;
export const TAB_SWITCHES_FLAGGED = 8;
export const AWAY_SECONDS_REVIEW = 60;
export const AWAY_SECONDS_FLAGGED = 180;
/** Reading and answering a question takes longer than this, even for experts. */
export const MIN_SECONDS_PER_QUESTION = 4;
export const OVER_TIME_GRACE_SECONDS = 30;

const clamp = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), 100_000) : 0;
};

const minutes = (seconds: number) =>
  seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`;

/**
 * Turns browser signals and server timing into a level for the employer.
 * Browser signals can be bypassed, so they only ever raise a question; the
 * timing checks are measured by the server and carry the most weight.
 */
export function evaluateIntegrity(input: {
  events?: Partial<IntegrityEvents> | null;
  elapsedSeconds: number | null;
  timeLimitSeconds: number;
  questionCount: number;
  sharedNetwork?: boolean;
}): IntegrityReport {
  const events: IntegrityEvents = {
    tabSwitches: clamp(input.events?.tabSwitches),
    awaySeconds: clamp(input.events?.awaySeconds),
    pasteAttempts: clamp(input.events?.pasteAttempts),
    copyAttempts: clamp(input.events?.copyAttempts),
  };

  // severity 1 = needs review, 2 = flagged
  const found: Array<{ severity: 1 | 2; reason: string }> = [];

  if (events.tabSwitches >= TAB_SWITCHES_FLAGGED) {
    found.push({
      severity: 2,
      reason: `Left the test tab ${events.tabSwitches} times`,
    });
  } else if (events.tabSwitches >= TAB_SWITCHES_REVIEW) {
    found.push({
      severity: 1,
      reason: `Left the test tab ${events.tabSwitches} times`,
    });
  }

  if (events.awaySeconds >= AWAY_SECONDS_FLAGGED) {
    found.push({
      severity: 2,
      reason: `Away from the test for ${minutes(events.awaySeconds)}`,
    });
  } else if (events.awaySeconds >= AWAY_SECONDS_REVIEW) {
    found.push({
      severity: 1,
      reason: `Away from the test for ${minutes(events.awaySeconds)}`,
    });
  }

  if (events.copyAttempts > 0) {
    found.push({ severity: 1, reason: 'Tried to copy the question text' });
  }
  if (events.pasteAttempts > 0) {
    found.push({ severity: 1, reason: 'Tried to paste into an answer' });
  }

  const { elapsedSeconds } = input;
  if (elapsedSeconds != null) {
    const floor = MIN_SECONDS_PER_QUESTION * input.questionCount;
    if (elapsedSeconds < floor) {
      found.push({
        severity: 2,
        reason: `Finished in ${minutes(elapsedSeconds)}, faster than the questions can be read`,
      });
    }
    const over = elapsedSeconds - input.timeLimitSeconds;
    if (over > OVER_TIME_GRACE_SECONDS) {
      found.push({
        severity: 1,
        reason: `Went ${minutes(over)} over the time limit`,
      });
    }
  }

  if (input.sharedNetwork) {
    found.push({
      severity: 1,
      reason:
        'Used the same network as another candidate (can be a shared office or café)',
    });
  }

  const top = found.reduce<number>((max, f) => Math.max(max, f.severity), 0);
  return {
    level: top === 2 ? 'flagged' : top === 1 ? 'review' : 'clean',
    reasons: found.map((f) => f.reason),
    events,
  };
}
