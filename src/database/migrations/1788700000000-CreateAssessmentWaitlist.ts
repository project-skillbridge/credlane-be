import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssessmentWaitlist1788700000000 implements MigrationInterface {
  name = 'CreateAssessmentWaitlist1788700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "assessment_waitlist" (
        "id"                UUID         NOT NULL DEFAULT uuid_generate_v4(),
        "talent_profile_id" UUID         NOT NULL,
        "assessment_type"   VARCHAR(32)  NOT NULL,
        "track"             VARCHAR(64)  NOT NULL,
        "verified_level"    VARCHAR(32)  NOT NULL,
        "notified_at"       TIMESTAMPTZ,
        "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_assessment_waitlist" PRIMARY KEY ("id"),
        CONSTRAINT "FK_assessment_waitlist_talent_profile"
          FOREIGN KEY ("talent_profile_id") REFERENCES "talent_profiles"("id") ON DELETE CASCADE
      )
    `);
    // One open (un-notified) entry per talent and assessment type.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_assessment_waitlist_open_entry"
      ON "assessment_waitlist" ("talent_profile_id", "assessment_type")
      WHERE "notified_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_assessment_waitlist_pending"
      ON "assessment_waitlist" ("assessment_type", "created_at")
      WHERE "notified_at" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "assessment_waitlist"`);
  }
}
