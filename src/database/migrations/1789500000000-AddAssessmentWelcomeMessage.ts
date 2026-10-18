import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssessmentWelcomeMessage1789500000000 implements MigrationInterface {
  name = 'AddAssessmentWelcomeMessage1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employer_assessments" ADD COLUMN "welcome_message" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employer_assessments" DROP COLUMN "welcome_message"`,
    );
  }
}
