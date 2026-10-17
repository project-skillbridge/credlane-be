export type EmployerPlanId = 'free' | 'starter' | 'growth';

export type EmployerPlan = {
  id: EmployerPlanId;
  name: string;
  /** Profile unlocks included every month. */
  monthlyUnlocks: number;
  /** Indicative prices; confirm with employers before charging. */
  priceUsd: number;
  priceNgn: number;
  highlights: string[];
};

/** Every new employer starts with this many one-off unlocks to see the value. */
export const WELCOME_UNLOCK_CREDITS = 3;

export const EMPLOYER_PLANS: readonly EmployerPlan[] = [
  {
    id: 'free',
    name: 'Free',
    monthlyUnlocks: 0,
    priceUsd: 0,
    priceNgn: 0,
    highlights: [
      'Browse verified talent with scores and strengths',
      'Shortlist talent and send interview invites',
      'Create roles and assessments',
      `${WELCOME_UNLOCK_CREDITS} welcome profile unlocks`,
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    monthlyUnlocks: 15,
    priceUsd: 49,
    priceNgn: 49000,
    highlights: [
      '15 profile unlocks every month',
      'Full name, photo, resume, portfolio and contact',
      'Top-up unlocks any time',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    monthlyUnlocks: 50,
    priceUsd: 129,
    priceNgn: 129000,
    highlights: [
      '50 profile unlocks every month',
      'Everything in Starter',
      'Priority support',
    ],
  },
] as const;

export function getEmployerPlan(id: string): EmployerPlan {
  return EMPLOYER_PLANS.find((p) => p.id === id) ?? EMPLOYER_PLANS[0];
}
