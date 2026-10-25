import {
  QuestionType,
  SlotType,
  VerifiedLevel,
} from '../assessments/entities/assessment-question.entity';

// ── Rubric scoring ────────────────────────────────────────────────────────────

export interface RubricDimensions {
  relevance: number; // 0–3 (0–4 for LT-3)
  reasoning: number; // 0–3 (0–4 for LT-3)
  specificity: number; // 0–3, always 0 for LT-3
  completeness: number; // 0–3, always 0 for LT-3
}

export interface RubricScore extends RubricDimensions {
  total: number; // sum of dimensions (max 12, or max 8 for LT-3)
  feedback: string; // one-sentence rationale
  pending?: boolean; // true when AI failed and a backfill should re-score this answer
  quality_gate?: boolean; // true when deterministic validation rejected the answer before AI scoring
}

export interface QuestionGradingRubric {
  what_to_evaluate: string;
  strong_answer_must_show: string[];
  weak_answer_indicators: string[];
  score_guide: Record<string, string>;
}

export interface TextAnswerInput {
  question_id: string;
  question_text: string;
  answer: string;
  grading_rubric?: QuestionGradingRubric | null;
  // LT-3 (reflection) is scored on Relevance + Reasoning only, 0–4 each, max 8.
  is_lt3?: boolean;
}

export interface ScoredTextAnswer {
  question_id: string;
  rubric: RubricScore;
  raw_score: number;
  max_score: number;
}

// ── Question generation ───────────────────────────────────────────────────────

export interface GenerateQuestionsInput {
  track: string;
  verified_level: VerifiedLevel;
  assessment_type: 'skill' | 'advanced';
  question_type: QuestionType;
  slot_type?: SlotType;
  competency?: string;
  industry_context?: string;
  count: number;
}

export interface GeneratedQuestion {
  question_text: string;
  question_type: QuestionType;
  slot_type: SlotType | null;
  options: string[] | null; // MCQ only
  correct_answer: string | null; // MCQ only
  competency: string | null;
  industry_context: string | null;
}

// ── LT-3 conditional generation ──────────────────────────────────────────────

export interface GenerateLt3Input {
  track: string;
  verified_level: VerifiedLevel;
  lt2_question_text: string;
  lt2_answer: string;
}

export interface GeneratedLt3Question {
  question_text: string;
}

// ── Guidance report ───────────────────────────────────────────────────────────

export interface GuidanceReportInput {
  report_type: 'emerging' | 'job_ready';
  assessment_type: 'skill' | 'advanced';
  track: string;
  claimed_level: VerifiedLevel;
  validated_level: VerifiedLevel;
  percentage: number;
  strong_competencies: string[];
  weak_competencies: string[];
}

export interface GuidanceResource {
  title: string;
  provider: string;
  url: string;
  tier: 'free' | 'paid';
  competency: string;
  reason: string;
}

export interface RatedReportItem {
  item: string;
  rating: number;
}

export interface GuidanceReportBase {
  ai_summary: string;
  growth_insight: string;
  summary: string;
  strength_ratings: RatedReportItem[];
  weak_area_ratings: RatedReportItem[];
  recommended_resources: GuidanceResource[];
  resource_page_url: '/resources';
}

export interface EmergingGuidanceReport extends GuidanceReportBase {
  report_type: 'emerging';
  retake_advice: string;
}

export interface JobReadyGuidanceReport extends GuidanceReportBase {
  report_type: 'job_ready';
  retake_advice?: never;
}

export type GuidanceReport = EmergingGuidanceReport | JobReadyGuidanceReport;

export interface GeneratedResourceBase {
  title: string;
  description: string;
  url: string;
  duration: string;
}

export interface GeneratedArticleItem extends GeneratedResourceBase {
  type: 'article' | 'course';
}

export interface GeneratedVideoItem extends GeneratedResourceBase {
  type: 'video';
}

export interface AiResourcesPayload {
  banner_title: string;
  banner_description: string;
  resources: GeneratedArticleItem[];
  videos: GeneratedVideoItem[];
}

// ── Hiring brief (employer-facing) ───────────────────────────────────────────

export interface HiringBriefCompetency {
  assessment: 'skill' | 'job_ready';
  name: string;
  score: number; // 0–100, mean across that competency's questions
  questions: number;
}

export interface HiringBriefOpenAnswer {
  assessment: 'skill' | 'job_ready';
  question: string;
  answer: string;
  rubric_total: number | null;
  rubric_max: number | null;
  feedback: string;
}

export interface HiringBriefInput {
  track: string;
  claimed_level: string;
  validated_level: string;
  skill: { percentage: number } | null;
  job_ready: { percentage: number; tier: string | null } | null;
  competencies: HiringBriefCompetency[];
  missed_questions: {
    assessment: 'skill' | 'job_ready';
    competency: string | null;
    question: string;
  }[];
  open_answers: HiringBriefOpenAnswer[];
  integrity: string | null;
}
