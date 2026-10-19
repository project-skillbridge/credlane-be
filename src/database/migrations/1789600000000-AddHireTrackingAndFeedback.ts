import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHireTrackingAndFeedback1789600000000
  implements MigrationInterface
{
  name = 'AddHireTrackingAndFeedback1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "offers" ADD COLUMN "hired_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE TABLE "hire_feedback" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "offer_id" uuid NOT NULL,
         "employer_user_id" uuid NOT NULL,
         "candidate_user_id" uuid NOT NULL,
         "overall_rating" smallint NOT NULL,
         "would_hire_again" boolean NOT NULL,
         "comment" text,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_hire_feedback" PRIMARY KEY ("id"),
         CONSTRAINT "UQ_hire_feedback_offer" UNIQUE ("offer_id"),
         CONSTRAINT "CHK_hire_feedback_rating" CHECK ("overall_rating" BETWEEN 1 AND 5),
         CONSTRAINT "FK_hire_feedback_offer" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hire_feedback_candidate" ON "hire_feedback" ("candidate_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hire_feedback_employer" ON "hire_feedback" ("employer_user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "hire_feedback"`);
    await queryRunner.query(`ALTER TABLE "offers" DROP COLUMN "hired_at"`);
  }
}
