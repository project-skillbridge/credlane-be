import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCandidateHiringBriefs1789400000000 implements MigrationInterface {
  name = 'CreateCandidateHiringBriefs1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "candidate_hiring_briefs" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "talent_profile_id" uuid NOT NULL,
         "source_key" character varying(100) NOT NULL,
         "brief" jsonb NOT NULL,
         "stats" jsonb NOT NULL,
         "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_candidate_hiring_briefs" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_candidate_hiring_briefs_talent" ON "candidate_hiring_briefs" ("talent_profile_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_candidate_hiring_briefs_talent"`);
    await queryRunner.query(`DROP TABLE "candidate_hiring_briefs"`);
  }
}
