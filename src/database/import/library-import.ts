import type { DataSource } from 'typeorm';
import { isSupportedTalentRoleTrack } from '../../modules/talent/talent.constants';
import {
  CredlaneCatalogueAssessment,
  CredlaneCatalogueQuestion,
  EmployerAssessmentExperienceLevel,
  EmployerQuestionType,
} from '../../modules/employer-assessments/entities';

export type LibraryFile = {
  title: string;
  description?: string;
  estimatedCompletionTime: string;
  roleTrack: string;
  experienceLevel: string;
  questions: Array<{
    questionText: string;
    questionType: string;
    options?: string[];
    correctAnswer: string;
  }>;
};

const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 30;
/** Above this share, "pick the longest option" beats chance too easily. */
const MAX_LONGEST_KEY_SHARE = 0.6;
const FILLER = /\b(all of the above|none of the above|both a and b)\b/i;

/** Returns every problem found; an empty list means the file is safe to import. */
export function validateLibraryFile(file: LibraryFile): string[] {
  const errors: string[] = [];
  if (!file.title?.trim()) errors.push('title is required');
  if (!file.estimatedCompletionTime?.trim()) {
    errors.push('estimatedCompletionTime is required, e.g. "20 minutes"');
  }
  if (!isSupportedTalentRoleTrack(file.roleTrack)) {
    errors.push(`roleTrack "${file.roleTrack}" is not a supported track`);
  }
  if (
    !Object.values(EmployerAssessmentExperienceLevel).includes(
      file.experienceLevel as EmployerAssessmentExperienceLevel,
    )
  ) {
    errors.push(`experienceLevel "${file.experienceLevel}" is not valid`);
  }

  const questions = file.questions ?? [];
  if (questions.length < MIN_QUESTIONS || questions.length > MAX_QUESTIONS) {
    errors.push(
      `needs ${MIN_QUESTIONS} to ${MAX_QUESTIONS} questions, found ${questions.length}`,
    );
  }

  const seen = new Set<string>();
  let longestKeys = 0;
  let multipleChoice = 0;
  questions.forEach((q, i) => {
    const label = `question ${i + 1}`;
    const text = q.questionText?.trim() ?? '';
    if (text.length < 10) errors.push(`${label}: text is too short`);
    if (seen.has(text.toLowerCase())) errors.push(`${label}: duplicate text`);
    seen.add(text.toLowerCase());

    const options = (q.options ?? []).map((o) => o.trim());
    const distinct = new Set(options.map((o) => o.toLowerCase()));
    if (distinct.size !== options.length || options.some((o) => !o)) {
      errors.push(`${label}: options must be distinct and non-empty`);
    }
    if (!options.includes(q.correctAnswer?.trim())) {
      errors.push(`${label}: correctAnswer must exactly match one option`);
    }
    if (options.some((o) => FILLER.test(o))) {
      errors.push(`${label}: no "all/none of the above" style options`);
    }

    if (
      (q.questionType as EmployerQuestionType) ===
      EmployerQuestionType.TRUE_FALSE
    ) {
      const ok =
        options.length === 2 &&
        options.includes('True') &&
        options.includes('False');
      if (!ok)
        errors.push(`${label}: true_false options must be True and False`);
    } else if (
      (q.questionType as EmployerQuestionType) ===
      EmployerQuestionType.MULTIPLE_CHOICE
    ) {
      multipleChoice += 1;
      if (options.length !== 4) {
        errors.push(`${label}: multiple_choice needs exactly 4 options`);
      } else {
        const key = q.correctAnswer.trim();
        const longest = Math.max(...options.map((o) => o.length));
        if (key.length === longest) longestKeys += 1;
      }
    } else {
      errors.push(
        `${label}: questionType must be multiple_choice or true_false`,
      );
    }
  });

  if (
    multipleChoice >= MIN_QUESTIONS &&
    longestKeys / multipleChoice > MAX_LONGEST_KEY_SHARE
  ) {
    errors.push(
      `the correct answer is the longest option in ${longestKeys} of ${multipleChoice} multiple choice questions; rewrite so length is not a tell`,
    );
  }
  return errors;
}

/** Creates or replaces a library assessment (matched on title, track and level). */
export async function importLibraryAssessment(
  dataSource: DataSource,
  file: LibraryFile,
): Promise<{ id: string; questionCount: number; replaced: boolean }> {
  const errors = validateLibraryFile(file);
  if (errors.length > 0) {
    throw new Error(`Invalid library file:\n- ${errors.join('\n- ')}`);
  }

  return dataSource.transaction(async (manager) => {
    const level = file.experienceLevel as EmployerAssessmentExperienceLevel;
    const existing = await manager.findOne(CredlaneCatalogueAssessment, {
      where: {
        title: file.title.trim(),
        role_track: file.roleTrack,
        experience_level: level,
      },
    });
    const entry = await manager.save(CredlaneCatalogueAssessment, {
      ...(existing ?? {}),
      title: file.title.trim(),
      description: file.description?.trim() ?? null,
      estimated_completion_time: file.estimatedCompletionTime.trim(),
      role_track: file.roleTrack,
      experience_level: level,
      is_active: true,
    });
    if (existing) {
      await manager.delete(CredlaneCatalogueQuestion, {
        catalogue_assessment_id: entry.id,
      });
    }
    await manager.save(
      CredlaneCatalogueQuestion,
      file.questions.map((q, index) => ({
        catalogue_assessment_id: entry.id,
        position: index + 1,
        question_text: q.questionText.trim(),
        question_type: q.questionType as EmployerQuestionType,
        options: q.options?.map((o) => o.trim()) ?? null,
        correct_answer: q.correctAnswer.trim(),
      })),
    );
    return {
      id: entry.id,
      questionCount: file.questions.length,
      replaced: !!existing,
    };
  });
}
