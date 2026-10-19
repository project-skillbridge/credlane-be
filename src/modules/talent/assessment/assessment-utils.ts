import { randomInt } from 'node:crypto';
import { VerifiedLevel } from '../../assessments/entities';

export function metadataDifficulty(
  level: VerifiedLevel,
): 'easy' | 'medium' | 'hard' {
  if (level === VerifiedLevel.JUNIOR) {
    return 'easy';
  }
  if (level === VerifiedLevel.MID) {
    return 'medium';
  }
  return 'hard';
}

export function resolveIndustryContext(
  context: Record<string, unknown>,
): string | undefined {
  const industries = context['industries'];
  if (Array.isArray(industries) && industries.length > 0) {
    return industries.map(String).join(', ');
  }

  const jobTitle = context['job_title'];
  return typeof jobTitle === 'string' && jobTitle.trim().length > 0
    ? jobTitle.trim()
    : undefined;
}

export function resolveCompetencyHint(
  context: Record<string, unknown>,
): string | undefined {
  const specialization = context['specialization'];
  if (typeof specialization === 'string' && specialization.trim().length > 0) {
    return specialization.trim();
  }

  const primaryToolDuration = context['primary_tool_duration'];
  return typeof primaryToolDuration === 'string'
    ? primaryToolDuration
    : undefined;
}

/**
 * Returns the options in a fresh random order. Applied once when a session is
 * created so the order stays stable on resume but differs between attempts and
 * accounts. Scoring compares answer text, so reordering never changes marks.
 */
export function shuffleOptions<T>(options: T[] | null | undefined): T[] | null {
  if (!Array.isArray(options)) {
    return null;
  }
  const shuffled = [...options];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
