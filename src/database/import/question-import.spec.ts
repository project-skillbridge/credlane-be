import {
  extractJsonObjects,
  parseQuestionBankText,
} from './extract-json-objects';
import { mapSourceQuestion } from './map-source-question';
import { sourceQuestionSchema } from './import.types';
import {
  AssessmentType,
  QuestionType,
  SlotType,
  VerifiedLevel,
} from '../../modules/assessments/entities/assessment-question.entity';

describe('question import', () => {
  it('extracts JSON objects from noisy Google Doc text', () => {
    const text = `
      Header noise
      {
        "id": "FED-JR-SKL-001",
        "role_code": "FED",
        "level": "junior",
        "assessment_stage": "skill_assessment",
        "format": "mcq",
        "competency": "React",
        "question": "Pick one",
        "options": { "A": "Yes", "B": "No", "C": "Maybe", "D": "Never" },
        "correct_answer": "A",
        "estimated_time_seconds": 30,
        "tags": ["react"]
      }
    `;

    const objects = extractJsonObjects(text);
    expect(objects).toHaveLength(1);
  });

  it('parses a JSON array file', () => {
    const parsed = parseQuestionBankText(
      JSON.stringify([
        {
          id: 'FED-JR-SKL-001',
          role_code: 'FED',
          level: 'junior',
          assessment_stage: 'skill_assessment',
          format: 'mcq',
          competency: 'React',
          question: 'Pick one',
          options: { A: 'Yes', B: 'No', C: 'Maybe', D: 'Never' },
          correct_answer: 'A',
          estimated_time_seconds: 30,
          tags: ['react'],
        },
      ]),
    );

    expect(parsed).toHaveLength(1);
  });

  it('maps skill mcq to assessment_questions row shape', () => {
    const mapped = mapSourceQuestion(
      {
        id: 'FED-JR-SKL-001',
        role_code: 'FED',
        level: 'junior',
        assessment_stage: 'skill_assessment',
        format: 'mcq',
        competency: 'React',
        question: 'Pick one',
        options: { A: 'Yes', B: 'No', C: 'Maybe', D: 'Never' },
        correct_answer: 'A',
        estimated_time_seconds: 30,
        tags: ['react'],
      },
      1,
    );

    expect(mapped.assessment_type).toBe(AssessmentType.SKILL);
    expect(mapped.track).toBe('frontend_developer');
    expect(mapped.verified_level).toBe(VerifiedLevel.JUNIOR);
    expect(mapped.slot_type).toBeNull();
    expect(mapped.correct_answer).toBe('Yes');
    expect(mapped.question_type).toBe(QuestionType.SINGLE_PICK);
  });

  it('maps a practice question to its own type with the explanation', () => {
    const source = sourceQuestionSchema.parse({
      id: 'FED-PR-JUN-001',
      role_code: 'FED',
      level: 'junior',
      assessment_stage: 'practice',
      format: 'mcq',
      competency: 'async-javascript',
      question: 'Which approach runs two independent requests together?',
      options: {
        A: 'Await each in turn',
        B: 'Promise.all',
        C: 'Nest them',
        D: 'Poll',
      },
      correct_answer: 'B',
      explanation:
        'Independent requests can start together and be awaited as one.',
    });

    const mapped = mapSourceQuestion(source, 1);

    expect(mapped.assessment_type).toBe(AssessmentType.PRACTICE);
    expect(mapped.is_live).toBe(true);
    expect(mapped.correct_answer).toBe('Promise.all');
    expect(mapped.metadata?.explanation).toBe(
      'Independent requests can start together and be awaited as one.',
    );
  });

  it('maps advanced open text with slot type and rubric metadata', () => {
    const mapped = mapSourceQuestion(
      {
        id: 'FED-SR-ADV-001',
        role_code: 'FED',
        level: 'senior',
        assessment_stage: 'advanced_assessment',
        format: 'open_ended_scenario',
        competency: 'Architecture',
        question_type: 'scenario_reasoning',
        question: 'Describe your approach under deadline pressure.',
        options: null,
        correct_answer: null,
        grading_rubric: {
          what_to_evaluate: 'Judgment under pressure',
          strong_answer_must_show: ['Diagnosis', 'Communication'],
          weak_answer_indicators: ['Generic advice'],
          score_guide: { '4': 'Strong', '3': 'Good', '2': 'Weak', '1': 'Poor' },
        },
        estimated_time_seconds: 120,
        tags: ['architecture'],
      },
      3,
    );

    expect(mapped.assessment_type).toBe(AssessmentType.ADVANCED);
    expect(mapped.slot_type).toBe(SlotType.SITUATIONAL);
    expect(mapped.metadata?.grading_rubric).toBeDefined();
    expect(mapped.metadata?.answer_block).toBe('short_text');
  });

  it('preserves slugified source competency instead of collapsing to general', () => {
    const mapped = mapSourceQuestion(
      {
        id: 'FED-SR-ADV-002',
        role_code: 'FED',
        level: 'senior',
        assessment_stage: 'advanced_assessment',
        format: 'open_ended_scenario',
        competency: 'Component Architecture',
        question_type: 'scenario_reasoning',
        question: 'How would you structure a large component library?',
        options: null,
        correct_answer: null,
        estimated_time_seconds: 120,
        tags: ['architecture'],
      },
      4,
    );

    expect(mapped.competency).toBe('component_architecture');
    expect(mapped.metadata?.source_competency).toBe('Component Architecture');
    expect(mapped.metadata?.competency).toBe('component_architecture');
  });
});
