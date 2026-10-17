import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestError, ForbiddenError } from '../../shared';
import { OpenRouterService } from '../ai/openrouter.service';
import { User } from '../users/entities/user.entity';
import { EmployerAssessmentDraftService } from './employer-assessment-draft.service';

const JD = 'We need a React engineer who ships accessible, tested UI at scale.';

const mc = (n: number, correct = 'B', options = ['A', 'B', 'C', 'D']) => ({
  question_text: `Which approach is best for scenario ${n}?`,
  question_type: 'multiple_choice' as const,
  options: options.map((o) => `${o} option ${n}`),
  correct_answer: `${correct} option ${n}`,
});

describe('EmployerAssessmentDraftService', () => {
  let service: EmployerAssessmentDraftService;
  const chat = jest.fn();
  const userRepo = { findOne: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    userRepo.findOne.mockResolvedValue({ id: 'emp-1', is_verified: true });
    const module = await Test.createTestingModule({
      providers: [
        EmployerAssessmentDraftService,
        { provide: OpenRouterService, useValue: { chat } },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();
    service = module.get(EmployerAssessmentDraftService);
  });

  it('rejects unverified employers before calling the AI', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'emp-1', is_verified: false });
    await expect(
      service.draftQuestions('emp-1', { jobDescription: JD }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(chat).not.toHaveBeenCalled();
  });

  it('returns up to the requested count and keeps the correct answer in the options', async () => {
    chat.mockResolvedValue({
      questions: Array.from({ length: 10 }, (_, i) => mc(i + 1)),
    });
    const result = await service.draftQuestions('emp-1', {
      jobDescription: JD,
      count: 6,
    });
    expect(result.questions).toHaveLength(6);
    for (const q of result.questions) {
      expect(q.options).toContain(q.correctAnswer);
    }
  });

  it('does not keep the model answer order', async () => {
    chat.mockResolvedValue({
      questions: Array.from({ length: 12 }, (_, i) => mc(i + 1)),
    });
    const result = await service.draftQuestions('emp-1', {
      jobDescription: JD,
      count: 10,
    });
    const positions = new Set(
      result.questions.map((q) => q.options.indexOf(q.correctAnswer)),
    );
    // The model always put the key second; shuffling must spread it out.
    expect(positions.size).toBeGreaterThan(1);
  });

  it('drops malformed and duplicate questions', async () => {
    const good = Array.from({ length: 6 }, (_, i) => mc(i + 1));
    chat.mockResolvedValue({
      questions: [
        ...good,
        mc(1), // duplicate text
        { ...mc(20), correct_answer: 'not in options' },
        { ...mc(21), options: ['x', 'x', 'y', 'z'] },
        { ...mc(22), options: ['a', 'b', 'c'] },
        {
          question_text: 'Is the sky blue at noon?',
          question_type: 'true_false' as const,
          options: ['yes', 'no'],
          correct_answer: 'yes',
        },
      ],
    });
    const result = await service.draftQuestions('emp-1', {
      jobDescription: JD,
      count: 10,
    });
    expect(result.questions).toHaveLength(6);
    expect(result.dropped).toBe(5);
  });

  it('accepts true/false and normalises casing', async () => {
    chat.mockResolvedValue({
      questions: [
        {
          question_text: 'React state updates are always synchronous.',
          question_type: 'true_false',
          options: ['true', 'FALSE'],
          correct_answer: 'false',
        },
        ...Array.from({ length: 5 }, (_, i) => mc(i + 1)),
      ],
    });
    const result = await service.draftQuestions('emp-1', {
      jobDescription: JD,
    });
    const tf = result.questions.find((q) => q.questionType === 'true_false');
    expect(tf).toMatchObject({
      options: ['True', 'False'],
      correctAnswer: 'False',
    });
  });

  it('fails clearly when fewer than five usable questions come back', async () => {
    chat.mockResolvedValue({ questions: [mc(1), mc(2)] });
    await expect(
      service.draftQuestions('emp-1', { jobDescription: JD }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
