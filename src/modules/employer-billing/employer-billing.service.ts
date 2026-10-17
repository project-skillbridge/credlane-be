import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PaymentRequiredError } from '../../shared';
import {
  EMPLOYER_PLANS,
  type EmployerPlanId,
  INVITE_PACKS,
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
  monthly_invites: number;
  invites_used_this_period: number;
  invite_bonus_credits: number;
  /** Candidates the employer can still invite or admit right now. */
  invites_remaining: number;
  invite_packs: typeof INVITE_PACKS;
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
      wallet.invite_period_used = 0;
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
      monthly_invites: plan.monthlyInvites,
      invites_used_this_period: wallet.invite_period_used,
      invite_bonus_credits: wallet.invite_bonus_credits,
      invites_remaining:
        Math.max(plan.monthlyInvites - wallet.invite_period_used, 0) +
        wallet.invite_bonus_credits,
      invite_packs: INVITE_PACKS,
      unlocks_remaining: planLeft + wallet.bonus_credits,
      period_resets_at:
        plan.monthlyUnlocks > 0 || plan.monthlyInvites > 0
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

  /**
   * Spends invites for candidates the employer is assessing. All or nothing:
   * if the employer can't cover the whole batch, nothing is spent. The monthly
   * allowance goes first, then purchased packs.
   */
  async spendInvites(
    employerUserId: string,
    count: number,
  ): Promise<{ invites_remaining: number }> {
    if (count <= 0) {
      return { invites_remaining: await this.invitesRemaining(employerUserId) };
    }
    return this.walletRepo.manager.transaction(async (manager) => {
      const walletRepo = manager.getRepository(EmployerWallet);
      const wallet = await this.ensureWallet(employerUserId, walletRepo, true);
      const plan = getEmployerPlan(wallet.plan);
      const planLeft = Math.max(
        plan.monthlyInvites - wallet.invite_period_used,
        0,
      );
      const available = planLeft + wallet.invite_bonus_credits;
      if (available < count) {
        throw new PaymentRequiredError(
          `You need ${count} invite${count === 1 ? '' : 's'} but have ${available} left. Upgrade your plan or buy an invite pack to continue.`,
        );
      }
      const fromPlan = Math.min(planLeft, count);
      wallet.invite_period_used += fromPlan;
      wallet.invite_bonus_credits -= count - fromPlan;
      await walletRepo.save(wallet);
      return { invites_remaining: available - count };
    });
  }

  /** Gives back invites that were spent but never delivered (for example a bounced email). */
  async refundInvites(employerUserId: string, count: number): Promise<void> {
    if (count <= 0) return;
    const wallet = await this.ensureWallet(employerUserId);
    const fromPeriod = Math.min(count, wallet.invite_period_used);
    wallet.invite_period_used -= fromPeriod;
    wallet.invite_bonus_credits += count - fromPeriod;
    await this.walletRepo.save(wallet);
  }

  async invitesRemaining(employerUserId: string): Promise<number> {
    const wallet = await this.ensureWallet(employerUserId);
    const plan = getEmployerPlan(wallet.plan);
    return (
      Math.max(plan.monthlyInvites - wallet.invite_period_used, 0) +
      wallet.invite_bonus_credits
    );
  }

  /** For payment webhooks: add purchased invite pack credits. */
  async addInviteCredits(
    employerUserId: string,
    invites: number,
  ): Promise<void> {
    const wallet = await this.ensureWallet(employerUserId);
    wallet.invite_bonus_credits += invites;
    await this.walletRepo.save(wallet);
  }

  /** For payment webhooks: switch plan and start a fresh period. */
  async activatePlan(
    employerUserId: string,
    planId: EmployerPlanId,
  ): Promise<void> {
    const wallet = await this.ensureWallet(employerUserId);
    wallet.plan = planId;
    wallet.period_used = 0;
    wallet.invite_period_used = 0;
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
