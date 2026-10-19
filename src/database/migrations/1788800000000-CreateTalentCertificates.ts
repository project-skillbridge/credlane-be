import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTalentCertificates1788800000000 implements MigrationInterface {
  name = 'CreateTalentCertificates1788800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "talent_certificates" (
        "id"                UUID         NOT NULL DEFAULT uuid_generate_v4(),
        "code"              VARCHAR(16)  NOT NULL,
        "talent_profile_id" UUID         NOT NULL,
        "track"             VARCHAR(64)  NOT NULL,
        "verified_level"    VARCHAR(32)  NOT NULL,
        "issued_at"         TIMESTAMPTZ  NOT NULL,
        "expires_at"        TIMESTAMPTZ  NOT NULL,
        "revoked_at"        TIMESTAMPTZ,
        "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_talent_certificates" PRIMARY KEY ("id"),
        CONSTRAINT "FK_talent_certificates_talent_profile"
          FOREIGN KEY ("talent_profile_id") REFERENCES "talent_profiles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_talent_certificates_code" ON "talent_certificates" ("code")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_talent_certificates_holder_track_level"
      ON "talent_certificates" ("talent_profile_id", "track", "verified_level")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "talent_certificates"`);
  }
}
