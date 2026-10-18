import { z } from 'zod';

const score = () => z.number().int().min(0).max(3);
const lt3Score = () => z.number().int().min(0).max(4);

export const rubricFullSchema = z.object({
  relevance: score(),
  reasoning: score(),
  specificity: score(),
  completeness: score(),
  total: z.number().int().min(0).max(12),
  feedback: z.string(),
});

// LT-3 reflection: 2 dimensions only, 0-4 per dimension, max 8.
export const rubricLt3Schema = z.object({
  relevance: lt3Score(),
  reasoning: lt3Score(),
  total: z.number().int().min(0).max(8),
  feedback: z.string(),
});

export const rubricGuideScoreSchema = z.object({
  score: z.number().int().min(0).max(4),
  total: z.number().int().min(0).max(4),
  feedback: z.string(),
});

export const generatedQuestionSchema = z.object({
  question_text: z.string(),
  options: z.array(z.string()).nullable(),
  correct_answer: z.string().nullable(),
  competency: z.string().nullable(),
  industry_context: z.string().nullable(),
});

export const questionGenerationSchema = z.object({
  questions: z.array(generatedQuestionSchema),
});

export const personalAssessmentGeneratedQuestionSchema = z.object({
  source_key: z.string(),
  prompt: z.string(),
  helper_text: z.string().nullable(),
});

export const personalAssessmentGenerationSchema = z.object({
  questions: z.array(personalAssessmentGeneratedQuestionSchema).min(15).max(20),
});

export const lt3Schema = z.object({
  question_text: z.string(),
});

const guidanceResourceSchema = z.object({
  title: z.string(),
  provider: z.string(),
  url: z.string().url(),
  tier: z.enum(['free', 'paid']),
  competency: z.string(),
  reason: z.string(),
});

const guidanceReportBaseSchema = z.object({
  ai_summary: z.string().min(20),
  growth_insight: z.string().min(20),
  summary: z.string().min(20),
  strength_ratings: z
    .array(
      z.object({
        item: z.string().min(1).max(90),
        rating: z.number().int().min(1).max(3),
      }),
    )
    .max(5),
  weak_area_ratings: z
    .array(
      z.object({
        item: z.string().min(1).max(90),
        rating: z.number().int().min(1).max(3),
      }),
    )
    .max(5),
  recommended_resources: z.array(guidanceResourceSchema),
  resource_page_url: z.literal('/resources'),
});

const emergingGuidanceReportSchema = guidanceReportBaseSchema
  .extend({
    report_type: z.literal('emerging'),
    retake_advice: z.string(),
  })
  .strict();

const jobReadyGuidanceReportSchema = guidanceReportBaseSchema
  .extend({
    report_type: z.literal('job_ready'),
  })
  .strict();

export const guidanceReportSchema = z.discriminatedUnion('report_type', [
  emergingGuidanceReportSchema,
  jobReadyGuidanceReportSchema,
]);

const generatedResourceBaseSchema = z.object({
  title: z.string(),
  description: z.string(),
  url: z.string(),
  duration: z.string(),
});

export const generatedArticleItemSchema = generatedResourceBaseSchema.extend({
  type: z.enum(['article', 'course']),
});

export const generatedVideoItemSchema = generatedResourceBaseSchema.extend({
  type: z.literal('video'),
});

export const aiResourcesPayloadSchema = z.object({
  banner_title: z.string(),
  banner_description: z.string(),
  resources: z.array(generatedArticleItemSchema).min(3).max(20),
  videos: z.array(generatedVideoItemSchema).min(3).max(20),
});

const briefSource = z.enum(['skills', 'job_ready', 'open_ended']);

export const hiringBriefSchema = z.object({
  headline: z.string().min(1),
  hire_case: z.string().min(1),
  strengths: z.array(
    z.object({
      title: z.string().min(1),
      evidence: z.string().min(1),
      source: briefSource,
    }),
  ),
  gaps: z.array(
    z.object({
      title: z.string().min(1),
      evidence: z.string().min(1),
      source: briefSource,
      severity: z.enum(['minor', 'moderate', 'significant']),
    }),
  ),
  open_ended: z.array(
    z.object({
      topic: z.string().min(1),
      quality: z.enum(['strong', 'solid', 'basic', 'weak']),
      takeaway: z.string().min(1),
    }),
  ),
  interview_questions: z.array(z.string().min(1)).min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  confidence_note: z.string().min(1),
});

export type HiringBrief = z.infer<typeof hiringBriefSchema>;
