import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AssessmentQuestion,
  AssessmentType,
  VerifiedLevel,
} from '../../assessments/entities/assessment-question.entity';
import { PracticeAssessmentService } from './practice-assessment.service';

const question = (id: string, overrides: Partial<AssessmentQuestion> = {}) =>
  Object.assign(new AssessmentQuestion(), {
    id,
    assessment_type: AssessmentType.PRACTICE,
    question_text: `Question ${id}`,
    options: ['one', 'two', 'three', 'four'],
    correct_answer: 'two',
    metadata: { explanation: 'Because two.' },
    is_live: true,
    ...overrides,
  });

describe('PracticeAssessmentService', () => {
  let profileRepo: { findOne: jest.Mock };
  let questionRepo: { find: jest.Mock; findOne: jest.Mock };
  let service: PracticeAssessmentService;

  beforeEach(() => {
    profileRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'profile-1',
        track: 'frontend_developer',
        claimed_level: VerifiedLevel.MID,
      }),
    };
    questionRepo = { find: jest.fn(), findOne: jest.fn() };
    service = new PracticeAssessmentService(
      profileRepo as never,
      questionRepo as never,
    );
  });

  describe('getSet', () => {
    it('returns the practice questions for the talent track and level, without answers', async () => {
      questionRepo.find.mockResolvedValue([question('q1'), question('q2')]);

      const result = await service.getSet('user-1');

      expect(questionRepo.find).toHaveBeenCalledWith({
        where: {
          assessment_type: AssessmentType.PRACTICE,
          is_live: true,
          track: 'frontend_developer',
          verified_level: VerifiedLevel.MID,
        },
      });
      expect(result.level).toBe(VerifiedLevel.MID);
      expect(result.questions).toHaveLength(2);
      for (const q of result.questions) {
        expect(q).not.toHaveProperty('correct_answer');
        expect(q).not.toHaveProperty('explanation');
        expect([...q.options].sort()).toEqual(['four', 'one', 'three', 'two']);
      }
      expect(result.questions.map((q) => q.question_number)).toEqual([1, 2]);
    });

    it('asks for personal assessment setup when track or level is missing', async () => {
      profileRepo.findOne.mockResolvedValue({ id: 'p', track: null });
      await expect(service.getSet('user-1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('is not found when the role has no practice questions yet', async () => {
      questionRepo.find.mockResolvedValue([]);
      await expect(service.getSet('user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('is not found when the talent profile is missing', async () => {
      profileRepo.findOne.mockResolvedValue(null);
      await expect(service.getSet('user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('check', () => {
    it('marks the right answer correct and returns the explanation', async () => {
      questionRepo.findOne.mockResolvedValue(question('q1'));

      const result = await service.check('user-1', 'q1', 'two');

      expect(result).toEqual({
        correct: true,
        correct_answer: 'two',
        explanation: 'Because two.',
      });
    });

    it('marks a wrong answer incorrect and still reveals the right one', async () => {
      questionRepo.findOne.mockResolvedValue(question('q1'));

      const result = await service.check('user-1', 'q1', 'three');

      expect(result.correct).toBe(false);
      expect(result.correct_answer).toBe('two');
    });

    it('only looks up live practice questions, never graded ones', async () => {
      questionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.check('user-1', 'live-skill-question-id', 'two'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(questionRepo.findOne).toHaveBeenCalledWith({
        where: {
          id: 'live-skill-question-id',
          assessment_type: AssessmentType.PRACTICE,
          is_live: true,
        },
      });
    });
  });
});
