import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExternalAccessCode1789700000000 implements MigrationInterface {
  name = 'AddExternalAccessCode1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employer_assessments" ADD COLUMN "access_code" varchar(12)`,
    );
    await queryRunner.query(
      `ALTER TABLE "employer_assessment_external_applicants" ADD COLUMN "full_name" varchar(255)`,
    );
    // Existing link assessments get a code too, so none stay open to anyone.
    await queryRunner.query(
      `UPDATE "employer_assessments"
          SET "access_code" = upper(substr(md5(random()::text || id::text), 1, 6))
        WHERE "type" = 'external' AND "access_code" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employer_assessment_external_applicants" DROP COLUMN "full_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employer_assessments" DROP COLUMN "access_code"`,
    );
  }
}
