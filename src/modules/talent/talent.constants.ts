import { VerifiedLevel } from '../assessments/entities/assessment-question.entity';

export const TALENT_GOALS = [
  'land_first_role',
  'build_technical_skills',
  'validate_current_ability',
  'become_more_employable',
] as const;

export type TalentGoal = (typeof TALENT_GOALS)[number];

export const TALENT_SUPPORTED_ROLE_TRACKS = [
  { slug: 'backend_developer', label: 'Backend Developer', roleCode: 'BED' },
  { slug: 'bi_developer', label: 'BI Developer', roleCode: 'BID' },
  { slug: 'brand_designer', label: 'Brand Designer', roleCode: 'BRD' },
  { slug: 'business_analyst', label: 'Business Analyst', roleCode: 'BIA' },
  { slug: 'cloud_devops', label: 'Cloud / DevOps', roleCode: 'DEV' },
  { slug: 'customer_success', label: 'Customer Success', roleCode: 'CSM' },
  { slug: 'data_analyst', label: 'Data Analyst', roleCode: 'DTA' },
  { slug: 'data_engineer', label: 'Data Engineer', roleCode: 'DTE' },
  { slug: 'data_scientist', label: 'Data Scientist', roleCode: 'DSC' },
  { slug: 'frontend_developer', label: 'Frontend Developer', roleCode: 'FED' },
  {
    slug: 'fullstack_developer',
    label: 'Fullstack Developer',
    roleCode: 'FSD',
  },
  { slug: 'hr_people_ops', label: 'HR / People Ops', roleCode: 'HRO' },
  { slug: 'ml_engineer', label: 'ML Engineer', roleCode: 'MLE' },
  { slug: 'mobile_developer', label: 'Mobile Developer', roleCode: 'MOB' },
  { slug: 'operations_manager', label: 'Operations Manager', roleCode: 'OPM' },
  { slug: 'product_designer', label: 'Product Designer', roleCode: 'PDG' },
  { slug: 'product_manager', label: 'Product Manager', roleCode: 'PMG' },
  { slug: 'project_manager', label: 'Project Manager', roleCode: 'PJM' },
  { slug: 'quality_assurance', label: 'Quality Assurance', roleCode: 'QAE' },
  { slug: 'ux_researcher', label: 'UX Researcher', roleCode: 'UXR' },
] as const;

export type TalentRoleTrack =
  (typeof TALENT_SUPPORTED_ROLE_TRACKS)[number]['slug'];

export const TALENT_ROLE_TRACKS: readonly TalentRoleTrack[] =
  TALENT_SUPPORTED_ROLE_TRACKS.map((entry) => entry.slug);

export type TalentSupportedRoleTrackOption = {
  slug: TalentRoleTrack;
  label: string;
  roleCode: (typeof TALENT_SUPPORTED_ROLE_TRACKS)[number]['roleCode'];
};

export function listTalentSupportedRoleTracks(): TalentSupportedRoleTrackOption[] {
  return TALENT_SUPPORTED_ROLE_TRACKS.map(({ slug, label, roleCode }) => ({
    slug,
    label,
    roleCode,
  }));
}

export function isSupportedTalentRoleTrack(
  track: string,
): track is TalentRoleTrack {
  return (TALENT_ROLE_TRACKS as readonly string[]).includes(track);
}

/** Same values as `verified_level_enum` / `ValidatedLevel` on the profile. */
export const TALENT_CLAIMED_LEVELS = [
  VerifiedLevel.JUNIOR,
  VerifiedLevel.MID,
  VerifiedLevel.SENIOR,
  VerifiedLevel.EXPERT,
] as const;

export type TalentClaimedLevel = VerifiedLevel;

export const TALENT_EDUCATION_LEVELS = [
  'high_school',
  'associate',
  'bachelor',
  'master',
  'doctorate',
  'bootcamp',
  'other',
] as const;

export type TalentEducationLevel = (typeof TALENT_EDUCATION_LEVELS)[number];

/** Maximum completed skill assessment attempts before advanced assessment is done. */
export const SKILL_ASSESSMENT_MAX_ATTEMPTS = 3;

/** How long (ms) before an incomplete skill session is considered abandoned. */
export const SKILL_ASSESSMENT_SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Integrity violations (tab switches, screenshots, copy/paste) tolerated in
 * one session. The server counts them, so the limit cannot be bypassed by
 * tampering with the client. The session is voided on reaching this count.
 */
export const INTEGRITY_VIOLATION_LIMIT = 3;

/** Time allowed for one skill assessment attempt. */
export const SKILL_ASSESSMENT_DURATION_MINUTES = 30;

/** Slack after the deadline for the client's auto-submit to reach the server. */
export const SKILL_ASSESSMENT_SUBMIT_GRACE_SECONDS = 120;

/** Minimum claimed-level score (Stage 2) required to confirm the candidate's claimed level. */
export const SKILL_ASSESSMENT_PASS_PERCENTAGE = 50;

/** Minimum overall score; below this the skill attempt is a total failure (no level outcome). */
export const SKILL_ASSESSMENT_QUALITY_MIN_PERCENTAGE = 50;

/** Minimum overall score for advanced; below this the attempt is a total failure. */
export const ADVANCED_ASSESSMENT_QUALITY_MIN_PERCENTAGE = 50;
