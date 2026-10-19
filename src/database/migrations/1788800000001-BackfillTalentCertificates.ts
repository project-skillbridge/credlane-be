import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Talents who already passed the skill assessment before certificates existed
 * get one for their validated level. The code is random and unambiguous.
 */
export class BackfillTalentCertificates1788800000001 implements MigrationInterface {
  name = 'BackfillTalentCertificates1788800000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "talent_certificates"
        ("code", "talent_profile_id", "track", "verified_level", "issued_at", "expires_at")
      SELECT
        (SELECT string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
         FROM generate_series(1, 10) WHERE tp.id IS NOT NULL),
        tp.id,
        tp.track,
        tp.validated_level::text,
        tp.skill_assessment_completed_at,
        tp.skill_assessment_completed_at + INTERVAL '12 months'
      FROM "talent_profiles" tp
      WHERE tp.validated_level IS NOT NULL
        AND tp.track IS NOT NULL
        AND tp.skill_assessment_completed_at IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
  }

  async down(): Promise<void> {
    // Backfilled rows are indistinguishable from issued ones; nothing to undo.
  }
}
