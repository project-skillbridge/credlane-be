export type EmployerPlanId = 'free' | 'starter' | 'growth';

export type EmployerPlan = {
  id: EmployerPlanId;
  name: string;
  /** Candidates the employer can assess every month. */
  monthlyInvites: number;
  /** Profile unlocks (full name, photo, contact) included every month. */
  monthlyUnlocks: number;
  /** Indicative prices; confirm with employers before charging. */
  priceUsd: number;
  priceNgn: number;
  highlights: string[];
};

export type InvitePack = {
  id: string;
  invites: number;
  priceUsd: number;
  priceNgn: number;
};

/** Every new employer starts with this many one-off unlocks to see the value. */
export const WELCOME_UNLOCK_CREDITS = 3;

/**
 * Naira prices sit a little above the dollar price at about 1,500 per dollar,
 * which covers card and transfer fees and currency swings.
 */
export const EMPLOYER_PLANS: readonly EmployerPlan[] = [
  {
    id: 'free',
    // Launch-phase offer; it becomes a time-limited trial after launch.
    name: 'Launch offer',
    monthlyInvites: 10,
    monthlyUnlocks: 0,
    priceUsd: 0,
    priceNgn: 0,
    highlights: [
      '10 candidates assessed every month',
      'SkillSift library and your own questions',
      `${WELCOME_UNLOCK_CREDITS} welcome profile unlocks`,
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    monthlyInvites: 100,
    monthlyUnlocks: 5,
    priceUsd: 10,
    priceNgn: 15000,
    highlights: [
      '100 candidates assessed every month',
      '5 profile unlocks every month',
      'Buy extra invite packs any time',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    monthlyInvites: 500,
    monthlyUnlocks: 30,
    priceUsd: 30,
    priceNgn: 45000,
    highlights: [
      '500 candidates assessed every month',
      '30 profile unlocks every month',
      'Priority support',
    ],
  },
] as const;

/** Prepaid invites that never expire. The more you buy, the less each costs. */
export const INVITE_PACKS: readonly InvitePack[] = [
  { id: 'pack_25', invites: 25, priceUsd: 6, priceNgn: 10000 },
  { id: 'pack_100', invites: 100, priceUsd: 20, priceNgn: 35000 },
  { id: 'pack_500', invites: 500, priceUsd: 90, priceNgn: 150000 },
] as const;

export function getEmployerPlan(id: string): EmployerPlan {
  return EMPLOYER_PLANS.find((p) => p.id === id) ?? EMPLOYER_PLANS[0];
}
