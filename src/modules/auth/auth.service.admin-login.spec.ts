import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { AdminTier, UserRole } from '../users/entities/user.entity';
import { ErrorMessages } from '../../shared';

describe('AuthService.adminLogin', () => {
  let service: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    setRefreshTokenHash: jest.Mock;
    recordLastLogin: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock };

  const baseAdmin = {
    id: 'admin-1',
    email: 'reviewer@example.com',
    role: UserRole.ADMIN,
    admin_tier: AdminTier.REVIEWER,
    is_active: true,
    is_verified: true,
    onboarding_complete: true,
    first_name: 'Annie',
    last_name: 'Reviewer',
    fullname: 'Annie Reviewer',
    avatar_url: null,
    country: 'Nigeria',
    password: '',
  };

  beforeEach(async () => {
    baseAdmin.password = await argon2.hash('correct-password');

    usersService = {
      findByEmail: jest.fn(),
      setRefreshTokenHash: jest.fn(),
      recordLastLogin: jest.fn(),
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed-token') };

    service = new AuthService(
      usersService as never,
      jwtService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('rejects with NO_ADMIN_ACCOUNT_FOUND when no account exists', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.adminLogin({ email: 'ghost@example.com', password: 'x' }),
    ).rejects.toMatchObject({
      message: ErrorMessages.AUTH.NO_ADMIN_ACCOUNT_FOUND,
    });
  });

  it('rejects non-admin users as if no account exists', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...baseAdmin,
      role: UserRole.TALENT,
    });

    await expect(
      service.adminLogin({ email: baseAdmin.email, password: 'x' }),
    ).rejects.toMatchObject({
      message: ErrorMessages.AUTH.NO_ADMIN_ACCOUNT_FOUND,
    });
  });

  it('rejects a deactivated account with a 403 and ACCOUNT_DEACTIVATED code', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...baseAdmin,
      is_active: false,
    });

    await expect(
      service.adminLogin({
        email: baseAdmin.email,
        password: 'correct-password',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'ACCOUNT_DEACTIVATED' }),
    });
  });

  it('rejects an incorrect password with INCORRECT_EMAIL_OR_PASSWORD', async () => {
    usersService.findByEmail.mockResolvedValue(baseAdmin);

    await expect(
      service.adminLogin({ email: baseAdmin.email, password: 'wrong' }),
    ).rejects.toMatchObject({
      message: ErrorMessages.AUTH.INCORRECT_EMAIL_OR_PASSWORD,
    });
  });

  it('redirects reviewer tier to /question-bank on success', async () => {
    usersService.findByEmail.mockResolvedValue(baseAdmin);

    const result = await service.adminLogin({
      email: baseAdmin.email,
      password: 'correct-password',
    });

    expect(result.data.redirect_path).toBe('/question-bank');
    expect(usersService.recordLastLogin).toHaveBeenCalledWith(baseAdmin.id);
  });

  it('redirects super_admin tier to /overview on success', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...baseAdmin,
      admin_tier: AdminTier.SUPER_ADMIN,
    });

    const result = await service.adminLogin({
      email: baseAdmin.email,
      password: 'correct-password',
    });

    expect(result.data.redirect_path).toBe('/overview');
  });

  it('signs an 8h access token for admin role', async () => {
    usersService.findByEmail.mockResolvedValue(baseAdmin);

    await service.adminLogin({
      email: baseAdmin.email,
      password: 'correct-password',
    });

    const accessTokenCall = jwtService.signAsync.mock.calls[0] as [
      unknown,
      { expiresIn: string },
    ];
    expect(accessTokenCall[1].expiresIn).toBe('8h');
  });
});
