import { ForbiddenException } from '@nestjs/common';
import { AdminTier, UserRole } from '../../users/entities/user.entity';
import { AdminAccountService } from './admin-account.service';

describe('AdminAccountService', () => {
  let usersService: { findOne: jest.Mock };
  let service: AdminAccountService;

  beforeEach(() => {
    usersService = { findOne: jest.fn() };
    service = new AdminAccountService(usersService as never);
  });

  it.each([
    [AdminTier.SUPER_ADMIN, 'Super Admin'],
    [AdminTier.ADMIN, 'Admin'],
    [AdminTier.REVIEWER, 'Reviewer'],
  ])(
    'maps %s to the correct read-only account settings badge',
    async (tier, badge) => {
      usersService.findOne.mockResolvedValue({
        id: 'admin-1',
        fullname: 'Ava Admin',
        email: 'ava@example.com',
        role: UserRole.ADMIN,
        admin_tier: tier,
      });

      const result = await service.getMe('admin-1');

      expect(result).toEqual({
        id: 'admin-1',
        name: 'Ava Admin',
        email: 'ava@example.com',
        role: UserRole.ADMIN,
        admin_tier: tier,
        role_badge: badge,
      });
    },
  );

  it('rejects malformed non-admin account data defensively', async () => {
    usersService.findOne.mockResolvedValue({
      id: 'talent-1',
      role: UserRole.TALENT,
      admin_tier: null,
    });

    await expect(service.getMe('talent-1')).rejects.toThrow(ForbiddenException);
  });
});
