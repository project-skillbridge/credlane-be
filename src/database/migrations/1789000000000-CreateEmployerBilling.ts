import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmployerBilling1789000000000 implements MigrationInterface {
  name = 'CreateEmployerBilling1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "employer_wallets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "employer_user_id" uuid NOT NULL,
        "plan" character varying(20) NOT NULL DEFAULT 'free',
        "period_used" integer NOT NULL DEFAULT 0,
        "period_start" TIMESTAMP WITH TIME ZONE NOT NULL,
        "bonus_credits" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employer_wallets" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_employer_wallets_employer" ON "employer_wallets" ("employer_user_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "employer_unlocks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "employer_user_id" uuid NOT NULL,
        "candidate_user_id" uuid NOT NULL,
        "source" character varying(10) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employer_unlocks" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_employer_unlocks_pair" ON "employer_unlocks" ("employer_user_id", "candidate_user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "employer_unlocks"`);
    await queryRunner.query(`DROP TABLE "employer_wallets"`);
  }
}
