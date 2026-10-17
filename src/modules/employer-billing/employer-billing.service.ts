import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PaymentRequiredError } from '../../shared';
import {
  EMPLOYER_PLANS,
  type EmployerPlanId,
  getEmployerPlan,
  WELCOME_UNLOCK_CREDITS,
} from './employer-billing.constants';
import { EmployerUnlock } from './entities/employer-unlock.entity';
import { EmployerWallet } from './entities/employer-wallet.entity';

export type EmployerBillingSummary = {
  plan: EmployerPlanId;
  plan_name: string;
  monthly_unlocks: number;
  used_this_period: number;
  bonus_credits: number;
  /** Unlocks the employer can still spend right now. */
  unlocks_remaining: number;
  period_resets_at: string | null;
  total_unlocked: number;
  plans: typeof EMPLOYER_PLANS;
};

function addMonth(date: Date): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
}

@Injectable()
export class EmployerBillingService {
  constructor(
    @InjectRepository(EmployerWallet)
    private readonly walletRepo: Repository<EmployerWallet>,
    @InjectRepository(EmployerUnlock)
    private readonly unlockRepo: Repository<EmployerUnlock>,
  ) {}

  /** Returns the wallet, creating it (with welcome credits) and rolling the monthly period as needed. */
  private async ensureWallet(
    employerUserId: string,
    repo: Repository<EmployerWallet> = this.walletRepo,
    lock = false,
  ): Promise<EmployerWallet> {
    let wallet = await repo.findOne({
      where: { employer_user_id: employerUserId },
      ...(lock ? { lock: { mode: 'pessimistic_write' } } : {}),
    });
    if (!wallet) {
      // Concurrent first calls race on the unique index; the loser re-reads.
      try {
        wallet = await repo.save(
          repo.create({
            employer_user_id: employerUserId,
            plan: 'free',
            period_used: 0,
            period_start: new Date(),
            bonus_credits: WELCOME_UNLOCK_CREDITS,
          }),
        );
      } catch {
        const existing = await repo.findOne({
          where: { employer_user_id: employerUserId },
        });
        if (!existing) throw new Error('Unable to create employer wallet');
        wallet = existing;
      }
    }
    if (new Date() >= addMonth(wallet.period_start)) {
      wallet.period_used = 0;
      wallet.period_start = new Date();
      wallet = await repo.save(wallet);
    }
    return wallet;
  }

  async getSummary(employerUserId: string): Promise<EmployerBillingSummary> {
    const wallet = await this.ensureWallet(employerUserId);
    const plan = getEmployerPlan(wallet.plan);
    const planLeft = Math.max(plan.monthlyUnlocks - wallet.period_used, 0);
    const totalUnlocked = await this.unlockRepo.count({
      where: { employer_user_id: employerUserId },
    });
    return {
      plan: plan.id,
      plan_name: plan.name,
      monthly_unlocks: plan.monthlyUnlocks,
      used_this_period: wallet.period_used,
      bonus_credits: wallet.bonus_credits,
      unlocks_remaining: planLeft + wallet.bonus_credits,
      period_resets_at:
        plan.monthlyUnlocks > 0
          ? addMonth(wallet.period_start).toISOString()
          : null,
      total_unlocked: totalUnlocked,
      plans: EMPLOYER_PLANS,
    };
  }

  async getUnlockedIds(
    employerUserId: string,
    candidateUserIds: string[],
  ): Promise<Set<string>> {
    if (candidateUserIds.length === 0) return new Set();
    const rows = await this.unlockRepo.find({
      where: {
        employer_user_id: employerUserId,
        candidate_user_id: In(candidateUserIds),
      },
      select: ['candidate_user_id'],
    });
    return new Set(rows.map((r) => r.candidate_user_id));
  }

  async isUnlocked(
    employerUserId: string,
    candidateUserId: string,
  ): Promise<boolean> {
    return (await this.getUnlockedIds(employerUserId, [candidateUserId])).has(
      candidateUserId,
    );
  }

  /**
   * Spends one unlock on a candidate. Idempotent: unlocking the same
   * candidate twice never charges twice. Plan quota is used before credits.
   */
  async unlock(
    employerUserId: string,
    candidateUserId: string,
  ): Promise<{ already_unlocked: boolean; unlocks_remaining: number }> {
    return this.unlockRepo.manager.transaction(async (manager) => {
      const walletRepo = manager.getRepository(EmployerWallet);
      const unlockRepo = manager.getRepository(EmployerUnlock);

      const wallet = await this.ensureWallet(employerUserId, walletRepo, true);
      const plan = getEmployerPlan(wallet.plan);
      const planLeft = Math.max(plan.monthlyUnlocks - wallet.period_used, 0);

      const existing = await unlockRepo.findOne({
        where: {
          employer_user_id: employerUserId,
          candidate_user_id: candidateUserId,
        },
      });
      if (existing) {
        return {
          already_unlocked: true,
          unlocks_remaining: planLeft + wallet.bonus_credits,
        };
      }

      let source: 'plan' | 'credit';
      if (planLeft > 0) {
        wallet.period_used += 1;
        source = 'plan';
      } else if (wallet.bonus_credits > 0) {
        wallet.bonus_credits -= 1;
        source = 'credit';
      } else {
        throw new PaymentRequiredError(
          'No unlocks left. Upgrade your plan or buy more unlocks to see this profile.',
        );
      }

      await walletRepo.save(wallet);
      await unlockRepo.save(
        unlockRepo.create({
          employer_user_id: employerUserId,
          candidate_user_id: candidateUserId,
          source,
        }),
      );

      const left =
        Math.max(plan.monthlyUnlocks - wallet.period_used, 0) +
        wallet.bonus_credits;
      return { already_unlocked: false, unlocks_remaining: left };
    });
  }

  /** For payment webhooks: switch plan and start a fresh period. */
  async activatePlan(
    employerUserId: string,
    planId: EmployerPlanId,
  ): Promise<void> {
    const wallet = await this.ensureWallet(employerUserId);
    wallet.plan = planId;
    wallet.period_used = 0;
    wallet.period_start = new Date();
    await this.walletRepo.save(wallet);
  }

  /** For payment webhooks: add purchased top-up credits. */
  async addCredits(employerUserId: string, credits: number): Promise<void> {
    const wallet = await this.ensureWallet(employerUserId);
    wallet.bonus_credits += credits;
    await this.walletRepo.save(wallet);
  }
}
