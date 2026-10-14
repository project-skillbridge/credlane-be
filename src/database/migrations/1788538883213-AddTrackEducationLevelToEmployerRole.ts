import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTrackEducationLevelToEmployerRole1788538883213 implements MigrationInterface {
    name = 'AddTrackEducationLevelToEmployerRole1788538883213'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."talent_role_track_enum" AS ENUM('backend_developer', 'bi_developer', 'brand_designer', 'business_analyst', 'cloud_devops', 'customer_success', 'data_analyst', 'data_engineer', 'data_scientist', 'frontend_developer', 'fullstack_developer', 'hr_people_ops', 'ml_engineer', 'mobile_developer', 'operations_manager', 'product_designer', 'product_manager', 'project_manager', 'quality_assurance', 'ux_researcher')`);
        await queryRunner.query(`ALTER TABLE "employer_roles" ADD "track" "public"."talent_role_track_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."employer_role_level_enum" AS ENUM('junior', 'mid', 'senior', 'expert')`);
        await queryRunner.query(`ALTER TABLE "employer_roles" ADD "level" "public"."employer_role_level_enum"`);
        await queryRunner.query(`ALTER TABLE "employer_roles" DROP COLUMN "education"`);
        await queryRunner.query(`CREATE TYPE "public"."talent_education_level_enum" AS ENUM('high_school', 'associate', 'bachelor', 'master', 'doctorate', 'bootcamp', 'other')`);
        await queryRunner.query(`ALTER TABLE "employer_roles" ADD "education" "public"."talent_education_level_enum"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "employer_roles" DROP COLUMN "education"`);
        await queryRunner.query(`DROP TYPE "public"."talent_education_level_enum"`);
        await queryRunner.query(`ALTER TABLE "employer_roles" ADD "education" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "employer_roles" DROP COLUMN "level"`);
        await queryRunner.query(`DROP TYPE "public"."employer_role_level_enum"`);
        await queryRunner.query(`ALTER TABLE "employer_roles" DROP COLUMN "track"`);
        await queryRunner.query(`DROP TYPE "public"."talent_role_track_enum"`);
    }

}
