import {
  BriefSource,
  MAX_MISSED,
  MAX_OPEN_ANSWERS,
  buildHiringBriefInput,
} from './hiring-brief-input';

const base: BriefSource = {
  track: 'frontend',
  claimed_level: 'senior',
  validated_level: 'senior',
  skill: { percentage: 80 },
  job_ready: { percentage: 83, tier: 'job_ready' },
  integrity: 'high',
  scores: [],
  responses: [],
};

describe('buildHiringBriefInput', () => {
  it('averages scores per competency and sorts strongest first', () => {
    const input = buildHiringBriefInput({
      ...base,
      scores: [
        { assessment: 'skill', competency: 'css', pct_score: 100 },
        { assessment: 'skill', competency: 'css', pct_score: 50 },
        { assessment: 'skill', competency: 'html', pct_score: 100 },
        { assessment: 'job_ready', competency: 'teamwork', pct_score: 20 },
        { assessment: 'skill', competency: null, pct_score: 0 },
      ],
    });
    expect(input.competencies).toEqual([
      { assessment: 'skill', name: 'html', score: 100, questions: 1 },
      { assessment: 'skill', name: 'css', score: 75, questions: 2 },
      { assessment: 'job_ready', name: 'teamwork', score: 20, questions: 1 },
    ]);
  });

  it('keeps the same competency name separate across assessments', () => {
    const input = buildHiringBriefInput({
      ...base,
      scores: [
        { assessment: 'skill', competency: 'communication', pct_score: 90 },
        { assessment: 'job_ready', competency: 'communication', pct_score: 40 },
      ],
    });
    expect(input.competencies).toHaveLength(2);
  });

  it('lists wrongly answered questions only, capped and clipped', () => {
    const responses = Array.from({ length: MAX_MISSED + 5 }, () => ({
      assessment: 'skill' as const,
      question_text: 'q'.repeat(400),
      user_answer: 'a',
      is_correct: false,
      competency: 'css',
      ai_evaluation_json: null,
    }));
    const input = buildHiringBriefInput({
      ...base,
      responses: [
        ...responses,
        {
          assessment: 'skill',
          question_text: 'right one',
          user_answer: 'a',
          is_correct: true,
          competency: 'css',
          ai_evaluation_json: null,
        },
      ],
    });
    expect(input.missed_questions).toHaveLength(MAX_MISSED);
    expect(input.missed_questions[0].question.length).toBeLessThan(200);
  });

  it('carries open-ended answers with rubric and clips long text', () => {
    const input = buildHiringBriefInput({
      ...base,
      responses: [
        {
          assessment: 'job_ready',
          question_text: 'Describe a conflict',
          user_answer: 'x'.repeat(2000),
          is_correct: null,
          competency: null,
          ai_evaluation_json: {
            relevance: 3,
            reasoning: 2,
            specificity: 2,
            completeness: 2,
            total: 9,
            feedback: 'Clear and specific.',
          },
        },
        {
          assessment: 'job_ready',
          question_text: 'Empty answer',
          user_answer: '   ',
          is_correct: null,
          competency: null,
          ai_evaluation_json: { total: 0 },
        },
      ],
    });
    expect(input.open_answers).toHaveLength(1);
    expect(input.open_answers[0]).toMatchObject({
      rubric_total: 9,
      rubric_max: 12,
      feedback: 'Clear and specific.',
    });
    expect(input.open_answers[0].answer.length).toBeLessThanOrEqual(801);
  });

  it('never exceeds the open-answer cap', () => {
    const responses = Array.from({ length: MAX_OPEN_ANSWERS + 3 }, () => ({
      assessment: 'skill' as const,
      question_text: 'q',
      user_answer: 'answer',
      is_correct: null,
      competency: null,
      ai_evaluation_json: { total: 1, reasoning: 1 },
    }));
    expect(
      buildHiringBriefInput({ ...base, responses }).open_answers,
    ).toHaveLength(MAX_OPEN_ANSWERS);
  });
});
