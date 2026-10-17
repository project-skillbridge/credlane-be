import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AssessmentQuestion,
  AssessmentType,
  VerifiedLevel,
} from '../../assessments/entities/assessment-question.entity';
import { TalentProfile } from '../entities/talent-profile.entity';
import { shuffleOptions } from './assessment-utils';

export interface PracticeQuestion {
  question_id: string;
  question_number: number;
  question_text: string;
  options: string[];
}

export interface PracticeSetResult {
  level: VerifiedLevel;
  track: string;
  questions: PracticeQuestion[];
}

export interface PracticeCheckResult {
  correct: boolean;
  correct_answer: string;
  explanation: string | null;
}

const PRACTICE_MESSAGES = {
  PROFILE_NOT_FOUND: 'Talent profile not found',
  SETUP_INCOMPLETE:
    'Complete your personal assessment first so we know which role and level to practise for',
  NOT_AVAILABLE: 'Practice questions are not available for your role yet',
  QUESTION_NOT_FOUND: 'Practice question not found',
};

/**
 * Ungraded practice before the real skill assessment. Practice questions are a
 * separate pool, so using them never consumes unseen live questions and never
 * reveals a live one. Nothing here touches attempts, history or certificates.
 */
@Injectable()
export class PracticeAssessmentService {
  constructor(
    @InjectRepository(TalentProfile)
    private readonly talentProfileRepo: Repository<TalentProfile>,
    @InjectRepository(AssessmentQuestion)
    private readonly questionRepo: Repository<AssessmentQuestion>,
  ) {}

  async getSet(userId: string): Promise<PracticeSetResult> {
    const profile = await this.findProfile(userId);
    if (!profile.track || !profile.claimed_level) {
      throw new UnprocessableEntityException(
        PRACTICE_MESSAGES.SETUP_INCOMPLETE,
      );
    }

    const rows = await this.questionRepo.find({
      where: {
        assessment_type: AssessmentType.PRACTICE,
        is_live: true,
        track: profile.track,
        verified_level: profile.claimed_level,
      },
    });
    if (rows.length === 0) {
      throw new NotFoundException(PRACTICE_MESSAGES.NOT_AVAILABLE);
    }

    const ordered = shuffleOptions(rows) ?? rows;
    return {
      level: profile.claimed_level,
      track: profile.track,
      questions: ordered.map((row, index) => ({
        question_id: row.id,
        question_number: index + 1,
        question_text: row.question_text,
        options: shuffleOptions(row.options) ?? [],
      })),
    };
  }

  async check(
    userId: string,
    questionId: string,
    answer: string,
  ): Promise<PracticeCheckResult> {
    await this.findProfile(userId);

    const question = await this.questionRepo.findOne({
      where: {
        id: questionId,
        assessment_type: AssessmentType.PRACTICE,
        is_live: true,
      },
    });
    if (!question || !question.correct_answer) {
      throw new NotFoundException(PRACTICE_MESSAGES.QUESTION_NOT_FOUND);
    }

    const explanation = question.metadata?.explanation;
    return {
      correct: answer.trim() === question.correct_answer.trim(),
      correct_answer: question.correct_answer,
      explanation: typeof explanation === 'string' ? explanation : null,
    };
  }

  private async findProfile(userId: string): Promise<TalentProfile> {
    const profile = await this.talentProfileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      throw new NotFoundException(PRACTICE_MESSAGES.PROFILE_NOT_FOUND);
    }
    return profile;
  }
}
