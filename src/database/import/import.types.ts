import { z } from 'zod';

export const gradingRubricSchema = z.object({
  what_to_evaluate: z.string(),
  strong_answer_must_show: z.array(z.string()),
  weak_answer_indicators: z.array(z.string()),
  score_guide: z.record(z.string(), z.string()),
});

export const sourceQuestionSchema = z.object({
  id: z.string().min(1),
  role: z.string().optional(),
  role_code: z.string().min(2),
  role_family: z.string().optional(),
  level: z.enum(['entry', 'junior', 'mid', 'senior', 'expert']),
  assessment_stage: z.enum([
    'skill_assessment',
    'advanced_assessment',
    'extension_bank',
    'practice',
  ]),
  format: z.enum(['mcq', 'long_text', 'open_ended_scenario']),
  competency: z.string().min(1),
  question_type: z.string().optional(),
  industry: z.string().optional(),
  estimated_time_seconds: z.number().int().positive().optional(),
  question: z.string().min(1),
  options: z.record(z.string(), z.string()).nullable().optional(),
  correct_answer: z.string().nullable().optional(),
  grading_rubric: gradingRubricSchema.nullable().optional(),
  difficulty_score: z.number().optional(),
  tags: z.array(z.string()).optional(),
  anti_cheat_seed: z.string().optional(),
  /** Shown after answering, for practice questions. */
  explanation: z.string().optional(),
});

export type SourceQuestion = z.infer<typeof sourceQuestionSchema>;

export type ImportSummaryRow = {
  track: string;
  level: string;
  stage: string;
  count: number;
};

export type ImportResult = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  summary: ImportSummaryRow[];
};
