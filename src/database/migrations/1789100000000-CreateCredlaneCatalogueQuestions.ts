import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Questions for the employer-facing SkillSift library. Kept apart from the
 * talent certification bank so employer use never burns certification items.
 */
export class CreateCredlaneCatalogueQuestions1789100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "credlane_catalogue_questions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "catalogue_assessment_id" uuid NOT NULL,
        "position" integer NOT NULL,
        "question_text" text NOT NULL,
        "question_type" "employer_assessment_question_type_enum" NOT NULL,
        "options" jsonb,
        "correct_answer" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credlane_catalogue_questions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_credlane_catalogue_questions_assessment"
          FOREIGN KEY ("catalogue_assessment_id")
          REFERENCES "credlane_catalogue_assessments" ("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_credlane_catalogue_questions_position"
          UNIQUE ("catalogue_assessment_id", "position")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "credlane_catalogue_questions";`);
  }
}
