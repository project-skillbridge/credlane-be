import {
  HiringBriefCompetency,
  HiringBriefInput,
  HiringBriefOpenAnswer,
} from '../ai/ai.types';

export type BriefAssessmentKind = 'skill' | 'job_ready';

export interface BriefScoreRow {
  assessment: BriefAssessmentKind;
  competency: string | null;
  pct_score: number;
}

export interface BriefResponseRow {
  assessment: BriefAssessmentKind;
  question_text: string | null;
  user_answer: unknown;
  is_correct: boolean | null;
  competency: string | null;
  ai_evaluation_json: Record<string, unknown> | null;
}

export interface BriefSource {
  track: string;
  claimed_level: string;
  validated_level: string;
  skill: { percentage: number } | null;
  job_ready: { percentage: number; tier: string | null } | null;
  integrity: string | null;
  scores: BriefScoreRow[];
  responses: BriefResponseRow[];
}

export const MAX_MISSED = 10;
export const MAX_OPEN_ANSWERS = 6;
const QUESTION_CHARS = 180;
const ANSWER_CHARS = 800;

const readable = (name: string): string => name.replace(/[_-]+/g, ' ').trim();

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

function answerText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function rubricMax(evaluation: Record<string, unknown>): number | null {
  if ('specificity' in evaluation) return 12;
  if ('reasoning' in evaluation) return 8;
  if ('score' in evaluation) return 4;
  return null;
}

/** Condenses a candidate's graded assessments into a small, bounded prompt input. */
export function buildHiringBriefInput(source: BriefSource): HiringBriefInput {
  const buckets = new Map<string, { sum: number; count: number }>();
  const meta = new Map<
    string,
    { assessment: BriefAssessmentKind; name: string }
  >();
  for (const row of source.scores) {
    if (!row.competency) continue;
    const key = `${row.assessment}:${row.competency}`;
    const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += row.pct_score;
    bucket.count += 1;
    buckets.set(key, bucket);
    meta.set(key, {
      assessment: row.assessment,
      name: readable(row.competency),
    });
  }
  const competencies: HiringBriefCompetency[] = [...buckets.entries()]
    .map(([key, { sum, count }]) => ({
      assessment: meta.get(key)!.assessment,
      name: meta.get(key)!.name,
      score: Math.round(sum / count),
      questions: count,
    }))
    .sort((a, b) => b.score - a.score);

  const missed_questions = source.responses
    .filter((r) => r.is_correct === false && r.question_text)
    .slice(0, MAX_MISSED)
    .map((r) => ({
      assessment: r.assessment,
      competency: r.competency ? readable(r.competency) : null,
      question: clip(r.question_text as string, QUESTION_CHARS),
    }));

  const open_answers: HiringBriefOpenAnswer[] = source.responses
    .filter((r) => r.ai_evaluation_json && answerText(r.user_answer))
    .slice(0, MAX_OPEN_ANSWERS)
    .map((r) => {
      const evaluation = r.ai_evaluation_json as Record<string, unknown>;
      const total = evaluation.total;
      const feedback = evaluation.feedback;
      return {
        assessment: r.assessment,
        question: clip(
          r.question_text ?? 'Open-ended question',
          QUESTION_CHARS,
        ),
        answer: clip(answerText(r.user_answer), ANSWER_CHARS),
        rubric_total: typeof total === 'number' ? total : null,
        rubric_max: rubricMax(evaluation),
        feedback: typeof feedback === 'string' ? clip(feedback, 240) : '',
      };
    });

  return {
    track: source.track,
    claimed_level: source.claimed_level,
    validated_level: source.validated_level,
    skill: source.skill,
    job_ready: source.job_ready,
    competencies,
    missed_questions,
    open_answers,
    integrity: source.integrity,
  };
}
