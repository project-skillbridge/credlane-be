import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInviteMetering1789300000000 implements MigrationInterface {
  name = 'AddInviteMetering1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employer_wallets"
         ADD COLUMN "invite_period_used" integer NOT NULL DEFAULT 0,
         ADD COLUMN "invite_bonus_credits" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employer_wallets"
         DROP COLUMN "invite_bonus_credits",
         DROP COLUMN "invite_period_used"`,
    );
  }
}
