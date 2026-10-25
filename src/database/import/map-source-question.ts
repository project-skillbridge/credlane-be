import {
  AssessmentQuestion,
  AssessmentType,
  QuestionType,
  SlotType,
  VerifiedLevel,
} from '../../modules/assessments/entities/assessment-question.entity';
import {
  FALLBACK_COMPETENCY,
  slugifyCompetency,
} from '../../modules/talent/assessment/competency-taxonomy';
import { resolveTrackFromRoleCode } from './role-code-map';
import type { SourceQuestion } from './import.types';

type Difficulty = 'easy' | 'medium' | 'hard';

function mapDifficulty(
  score: number | undefined,
  isAdvanced: boolean,
): Difficulty {
  if (score === undefined || Number.isNaN(score)) {
    return 'medium';
  }
  if (isAdvanced) {
    if (score <= 7) return 'easy';
    if (score <= 8) return 'medium';
    return 'hard';
  }
  if (score <= 5) return 'easy';
  if (score <= 7) return 'medium';
  return 'hard';
}

function inferSlotType(
  format: SourceQuestion['format'],
  questionType: string | undefined,
): SlotType {
  const normalized = (questionType ?? '').toLowerCase();
  if (format === 'open_ended_scenario') {
    return SlotType.SITUATIONAL;
  }
  if (
    normalized.includes('incident') ||
    normalized.includes('scenario') ||
    normalized.includes('stakeholder')
  ) {
    return SlotType.SITUATIONAL;
  }
  if (format === 'mcq') {
    return SlotType.WORK_TASK;
  }
  return SlotType.WORK_TASK;
}

function resolveOptions(
  options: Record<string, string> | null | undefined,
): string[] | null {
  if (!options) {
    return null;
  }
  return ['A', 'B', 'C', 'D']
    .map((key) => options[key])
    .filter((value): value is string => Boolean(value));
}

function resolveCorrectAnswer(
  options: Record<string, string> | null | undefined,
  letter: string | null | undefined,
): string | null {
  if (!letter || !options) {
    return letter ?? null;
  }
  const resolved = options[letter.toUpperCase()];
  return resolved ?? letter;
}

function mapAssessmentType(stage: SourceQuestion['assessment_stage']): {
  assessmentType: AssessmentType;
  isLive: boolean;
} {
  if (stage === 'skill_assessment') {
    return { assessmentType: AssessmentType.SKILL, isLive: true };
  }
  if (stage === 'advanced_assessment') {
    return { assessmentType: AssessmentType.ADVANCED, isLive: true };
  }
  if (stage === 'practice') {
    return { assessmentType: AssessmentType.PRACTICE, isLive: true };
  }
  return { assessmentType: AssessmentType.ADVANCED, isLive: false };
}

function mapQuestionType(format: SourceQuestion['format']): QuestionType {
  if (format === 'mcq') {
    return QuestionType.SINGLE_PICK;
  }
  if (format === 'long_text') {
    return QuestionType.OPTIONAL_TEXT;
  }
  return QuestionType.REQUIRED_TEXT;
}

export function mapSourceQuestion(
  source: SourceQuestion,
  questionNumber: number,
): Partial<AssessmentQuestion> {
  const track = resolveTrackFromRoleCode(source.role_code);
  const verifiedLevel = source.level as VerifiedLevel;
  // Keep the CredLane source competency slug as-is. Do not run through
  // normaliseCompetency — role tracks (frontend_developer) do not match the
  // narrower taxonomy keys (software_eng) and would collapse to `general`.
  const competency =
    slugifyCompetency(source.competency) ?? FALLBACK_COMPETENCY;
  const { assessmentType, isLive } = mapAssessmentType(source.assessment_stage);
  const isAdvanced = assessmentType === AssessmentType.ADVANCED;
  const questionType = mapQuestionType(source.format);
  const options = resolveOptions(source.options ?? null);
  const correctAnswer = resolveCorrectAnswer(
    source.options ?? null,
    source.correct_answer,
  );

  const answerBlock =
    source.format === 'mcq'
      ? null
      : source.format === 'open_ended_scenario'
        ? 'short_text'
        : 'long_text';

  const estimatedTime =
    source.estimated_time_seconds ??
    (source.format === 'mcq'
      ? isAdvanced
        ? 45
        : 30
      : source.format === 'long_text'
        ? 90
        : isAdvanced
          ? 120
          : 150);

  return {
    assessment_type: assessmentType,
    question_type: questionType,
    question_text: source.question,
    question_number: questionNumber,
    options,
    correct_answer: correctAnswer,
    track,
    verified_level: verifiedLevel,
    competency,
    slot_type: isAdvanced
      ? inferSlotType(source.format, source.question_type)
      : null,
    metadata: {
      difficulty: mapDifficulty(source.difficulty_score, isAdvanced),
      estimated_time_seconds: estimatedTime,
      tags: source.tags ?? [],
      source_id: source.id,
      source_competency: source.competency,
      competency,
      role_code: source.role_code.toUpperCase(),
      role: source.role ?? null,
      role_family: source.role_family ?? null,
      question_type: source.question_type ?? null,
      industry: source.industry ?? null,
      anti_cheat_seed: source.anti_cheat_seed ?? null,
      assessment_stage: source.assessment_stage,
      ...(source.explanation ? { explanation: source.explanation } : {}),
      ...(answerBlock ? { answer_block: answerBlock } : {}),
      ...(source.grading_rubric
        ? { grading_rubric: source.grading_rubric }
        : {}),
    },
    is_live: isLive,
  };
}
