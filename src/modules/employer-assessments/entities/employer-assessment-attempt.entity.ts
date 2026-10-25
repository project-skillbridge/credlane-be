import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { EmployerAssessment } from './employer-assessment.entity';

/** When a signed-in candidate opened an assessment: the server-side clock for time limits. */
@Entity('employer_assessment_attempts')
@Index(
  'UQ_employer_assessment_attempts_candidate',
  ['assessment_id', 'candidate_user_id'],
  { unique: true },
)
export class EmployerAssessmentAttempt {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  assessment_id: string;

  @ManyToOne(() => EmployerAssessment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assessment_id' })
  assessment: EmployerAssessment;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  candidate_user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidate_user_id' })
  candidate: User;

  @ApiProperty()
  @Column({ type: 'timestamp with time zone', default: () => 'now()' })
  started_at: Date;
}
