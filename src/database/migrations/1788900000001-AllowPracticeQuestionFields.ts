import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Practice questions carry a track, level and competency like skill questions
 * and no slot type. Compared as text so this can run in the same transaction
 * that added the enum value.
 */
export class AllowPracticeQuestionFields1788900000001 implements MigrationInterface {
  name = 'AllowPracticeQuestionFields1788900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assessment_questions" DROP CONSTRAINT IF EXISTS "CHK_assessment_questions_type_fields"`,
    );
    await queryRunner.query(`
      ALTER TABLE "assessment_questions"
      ADD CONSTRAINT "CHK_assessment_questions_type_fields"
      CHECK (
        (
          assessment_type::text IN ('skill', 'practice')
          AND track IS NOT NULL
          AND verified_level IS NOT NULL
          AND competency IS NOT NULL
          AND slot_type IS NULL
        )
        OR (
          assessment_type::text = 'advanced'
          AND slot_type IS NOT NULL
          AND track IS NOT NULL
          AND verified_level IS NOT NULL
          AND competency IS NOT NULL
        )
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assessment_questions" DROP CONSTRAINT IF EXISTS "CHK_assessment_questions_type_fields"`,
    );
    await queryRunner.query(`
      ALTER TABLE "assessment_questions"
      ADD CONSTRAINT "CHK_assessment_questions_type_fields"
      CHECK (
        (
          assessment_type = 'skill'::assessment_type_enum
          AND track IS NOT NULL
          AND verified_level IS NOT NULL
          AND competency IS NOT NULL
          AND slot_type IS NULL
        )
        OR (
          assessment_type = 'advanced'::assessment_type_enum
          AND slot_type IS NOT NULL
          AND track IS NOT NULL
          AND verified_level IS NOT NULL
          AND competency IS NOT NULL
        )
      )
    `);
  }
}
