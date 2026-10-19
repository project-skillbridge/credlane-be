import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Practice questions live in the same table as the graded banks but under their
 * own type, so no live-assessment query (which filters on skill or advanced)
 * can ever serve one.
 */
export class AddPracticeAssessmentType1788900000000 implements MigrationInterface {
  name = 'AddPracticeAssessmentType1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "assessment_type_enum" ADD VALUE IF NOT EXISTS 'practice'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a single enum value. Leaving it is harmless.
  }
}
