import {
  CERTIFICATE_VALIDITY_MONTHS,
  CertificatesService,
  generateCertificateCode,
  resolveCertificateStatus,
} from './certificates.service';

describe('certificate codes', () => {
  it('generates unambiguous 10 character codes', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCertificateCode()).toMatch(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/,
      );
    }
  });
});

describe('resolveCertificateStatus', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  it('is valid before expiry', () => {
    expect(
      resolveCertificateStatus(
        { expires_at: new Date('2026-07-01T00:00:00Z'), revoked_at: null },
        now,
      ),
    ).toBe('valid');
  });
  it('is expired at or after expiry', () => {
    expect(
      resolveCertificateStatus({ expires_at: now, revoked_at: null }, now),
    ).toBe('expired');
  });
  it('revoked wins over valid dates', () => {
    expect(
      resolveCertificateStatus(
        {
          expires_at: new Date('2027-01-01T00:00:00Z'),
          revoked_at: new Date('2026-05-01T00:00:00Z'),
        },
        now,
      ),
    ).toBe('revoked');
  });
});

describe('CertificatesService.issueForSkillPass', () => {
  const makeRepo = (existing: unknown) => ({
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
  });

  it('issues a new certificate with an expiry', async () => {
    const repo = makeRepo(null);
    const svc = new CertificatesService(repo as never);
    const cert = await svc.issueForSkillPass(
      'p1',
      'frontend_developer',
      'senior',
    );
    expect(cert.code).toHaveLength(10);
    const months =
      (cert.expires_at.getFullYear() - cert.issued_at.getFullYear()) * 12 +
      cert.expires_at.getMonth() -
      cert.issued_at.getMonth();
    expect(months).toBe(CERTIFICATE_VALIDITY_MONTHS);
  });

  it('renews an existing certificate and keeps its code', async () => {
    const existing = {
      code: 'ABCDEFGHJK',
      issued_at: new Date('2025-01-01'),
      expires_at: new Date('2026-07-01'),
      revoked_at: null,
    };
    const repo = makeRepo(existing);
    const svc = new CertificatesService(repo as never);
    const cert = await svc.issueForSkillPass(
      'p1',
      'frontend_developer',
      'senior',
    );
    expect(cert.code).toBe('ABCDEFGHJK');
    expect(cert.expires_at.getTime()).toBeGreaterThan(
      new Date('2026-07-01').getTime(),
    );
  });

  it('does not renew a revoked certificate', async () => {
    const revoked = {
      code: 'ZZZZZZZZZZ',
      issued_at: new Date('2025-01-01'),
      expires_at: new Date('2026-07-01'),
      revoked_at: new Date('2025-06-01'),
    };
    const repo = makeRepo(revoked);
    const svc = new CertificatesService(repo as never);
    const cert = await svc.issueForSkillPass(
      'p1',
      'frontend_developer',
      'senior',
    );
    expect(cert.revoked_at).not.toBeNull();
    expect(repo.save).not.toHaveBeenCalled();
  });
});
