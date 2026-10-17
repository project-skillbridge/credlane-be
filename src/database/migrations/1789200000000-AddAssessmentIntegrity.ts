import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Integrity signals and server-measured timing for employer assessments.
 * Existing rows keep NULLs: "not recorded" is truer than a made-up value.
 */
export class AddAssessmentIntegrity1789200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "employer_assessment_external_applicants"
        ADD COLUMN "ip_hash" character varying(64);

      ALTER TABLE "employer_assessment_external_submissions"
        ADD COLUMN "time_taken_seconds" integer,
        ADD COLUMN "integrity" jsonb,
        ADD COLUMN "integrity_level" character varying(10);

      ALTER TABLE "employer_assessment_submissions"
        ADD COLUMN "integrity" jsonb,
        ADD COLUMN "integrity_level" character varying(10);

      CREATE TABLE "employer_assessment_attempts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "assessment_id" uuid NOT NULL,
        "candidate_user_id" uuid NOT NULL,
        "started_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employer_assessment_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_employer_assessment_attempts_candidate"
          UNIQUE ("assessment_id", "candidate_user_id"),
        CONSTRAINT "FK_employer_assessment_attempts_assessment"
          FOREIGN KEY ("assessment_id")
          REFERENCES "employer_assessments" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_employer_assessment_attempts_candidate"
          FOREIGN KEY ("candidate_user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE "employer_assessment_attempts";
      ALTER TABLE "employer_assessment_submissions"
        DROP COLUMN "integrity_level", DROP COLUMN "integrity";
      ALTER TABLE "employer_assessment_external_submissions"
        DROP COLUMN "integrity_level", DROP COLUMN "integrity",
        DROP COLUMN "time_taken_seconds";
      ALTER TABLE "employer_assessment_external_applicants"
        DROP COLUMN "ip_hash";
    `);
  }
}
