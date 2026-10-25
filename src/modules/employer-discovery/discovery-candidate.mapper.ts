import { OfferStatus } from '../offers/entities/offer.entity';
import { TALENT_SUPPORTED_ROLE_TRACKS } from '../talent/talent.constants';
import {
  compactStrings,
  formatSlugLabel,
  readPersonalAnswers,
  resolveAvailabilityLabel,
  resolveExperienceLabel,
  resolveJobSearchStatusLabel,
  resolveSeniorityBadge,
  resolveSkills,
  resolveTierLabel,
  resolveWorkArrangementLabels,
} from '../verified-profile/verified-profile.utils';

export type DiscoveryCandidateRawRow = {
  userId: string;
  roleTrack: string | null;
  tier: string;
  availability: string | null;
  verifiedAt: Date;
  score: number;
  strongCompetencies: string[] | null;
  shareToken: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  country: string | null;
  verifiedLevel: string | null;
  location: string | null;
  jobSearchStatus: string | null;
  specialization: string | null;
  personalAssessmentAnswers: Record<string, unknown> | null;
};

export type DiscoveryCandidateCard = {
  user_id: string;
  candidate_id: string;
  first_name: string;
  last_name_initial: string;
  full_name: string;
  avatar_url: string | null;
  role: string;
  role_track: string | null;
  seniority_badge: string | null;
  validated_level: string | null;
  tier: string;
  score: number;
  skills: string[];
  top_skills: string[];
  about_tags: string[];
  availability: string | null;
  availability_status: string | null;
  availability_label: string | null;
  verified_at: Date;
  strong_competencies: string[] | null;
  share_token: string | null;
  region: string | null;
  date_added: string | null;
  is_saved: boolean;
  offer_sent: boolean;
  offer_status: OfferStatus | null;
  /** False until the employer spends an unlock; hides name, photo and links. */
  is_unlocked: boolean;
};

function resolveRoleTrackLabel(track: string | null): string {
  if (!track) {
    return 'Talent';
  }

  const entry = TALENT_SUPPORTED_ROLE_TRACKS.find(
    (item) => item.slug === track,
  );
  return entry?.label ?? formatSlugLabel(track);
}

function buildAboutTags(input: {
  personalAnswers: Record<string, unknown>;
  seniorityBadge: string | undefined;
  hasValidatedLevel: boolean;
  tierLabel: string | undefined;
  availability: string | null;
  jobSearchStatus: string | null;
}): string[] {
  const jobSearchStatus =
    input.jobSearchStatus ?? input.personalAnswers.job_search_status;

  return compactStrings([
    input.seniorityBadge,
    input.tierLabel,
    resolveJobSearchStatusLabel(jobSearchStatus),
    ...resolveWorkArrangementLabels(
      input.personalAnswers.work_arrangement_preference,
    ),
    input.hasValidatedLevel
      ? undefined
      : resolveExperienceLabel(input.personalAnswers.years_experience),
    jobSearchStatus !== 'not_looking'
      ? resolveAvailabilityLabel(
          input.availability ?? input.personalAnswers.availability,
        )
      : undefined,
  ]);
}

export function mapDiscoveryCandidateCard(
  row: DiscoveryCandidateRawRow,
  context: {
    is_saved: boolean;
    offer_sent: boolean;
    offer_status: OfferStatus | null;
    date_added?: string | null;
    is_unlocked?: boolean;
  },
): DiscoveryCandidateCard {
  const personalAnswers = readPersonalAnswers(row.personalAssessmentAnswers);
  const hasValidatedLevel = Boolean(row.verifiedLevel);
  const seniorityBadge = resolveSeniorityBadge(row.verifiedLevel);
  const tierLabel = resolveTierLabel(row.tier);
  const skills = resolveSkills(personalAnswers) ?? [];
  const firstName = row.firstName ?? '';
  const lastName = row.lastName ?? '';
  const isUnlocked = context.is_unlocked ?? false;
  const lastNameInitial = lastName
    ? `${lastName.charAt(0).toUpperCase()}.`
    : '';

  return {
    user_id: row.userId,
    candidate_id: row.userId,
    first_name: firstName,
    last_name_initial: lastNameInitial,
    // Locked profiles only show first name + last initial, and no photo.
    full_name: isUnlocked
      ? `${firstName} ${lastName}`.trim()
      : `${firstName} ${lastNameInitial}`.trim(),
    avatar_url: isUnlocked ? row.avatarUrl : null,
    role: resolveRoleTrackLabel(row.roleTrack),
    role_track: row.roleTrack,
    seniority_badge: seniorityBadge ?? null,
    validated_level: seniorityBadge ?? null,
    tier: row.tier,
    score: row.score,
    skills,
    top_skills: skills.slice(0, 2),
    about_tags: buildAboutTags({
      personalAnswers,
      seniorityBadge,
      hasValidatedLevel,
      tierLabel,
      availability: row.availability,
      jobSearchStatus: row.jobSearchStatus,
    }),
    availability: row.availability,
    availability_status: row.availability,
    availability_label: resolveAvailabilityLabel(row.availability) ?? null,
    verified_at: row.verifiedAt,
    strong_competencies: row.strongCompetencies,
    share_token: isUnlocked ? row.shareToken : null,
    region: row.location ?? row.country ?? null,
    date_added: context.date_added ?? null,
    is_saved: context.is_saved,
    offer_sent: context.offer_sent,
    offer_status: context.offer_status,
    is_unlocked: isUnlocked,
  };
}
