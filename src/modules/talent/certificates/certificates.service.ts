import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { Repository } from 'typeorm';
import { TalentCertificate } from '../../assessments/entities';

export const CERTIFICATE_VALIDITY_MONTHS = 12;

// No 0/O/1/I so a code read aloud or typed from a screenshot stays unambiguous.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

export type CertificateStatus = 'valid' | 'expired' | 'revoked';

export interface CertificateView {
  code: string;
  holder_name: string;
  track: string;
  track_label: string;
  level: string;
  level_label: string;
  issued_at: Date;
  expires_at: Date;
  status: CertificateStatus;
}

const titleCase = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const generateCertificateCode = (): string =>
  Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('');

export const resolveCertificateStatus = (
  cert: Pick<TalentCertificate, 'expires_at' | 'revoked_at'>,
  now = new Date(),
): CertificateStatus => {
  if (cert.revoked_at) return 'revoked';
  return cert.expires_at.getTime() <= now.getTime() ? 'expired' : 'valid';
};

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    @InjectRepository(TalentCertificate)
    private readonly certRepo: Repository<TalentCertificate>,
  ) {}

  /**
   * Issues a certificate for a passed skill assessment. A repeat pass at the
   * same track and level renews the existing certificate and keeps its code,
   * so links already shared stay valid.
   */
  async issueForSkillPass(
    talentProfileId: string,
    track: string,
    level: string,
  ): Promise<TalentCertificate> {
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt);
    expiresAt.setMonth(expiresAt.getMonth() + CERTIFICATE_VALIDITY_MONTHS);

    const existing = await this.certRepo.findOne({
      where: {
        talent_profile_id: talentProfileId,
        track,
        verified_level: level,
      },
    });
    if (existing) {
      if (existing.revoked_at) return existing;
      existing.issued_at = issuedAt;
      existing.expires_at = expiresAt;
      return this.certRepo.save(existing);
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.certRepo.save(
          this.certRepo.create({
            code: generateCertificateCode(),
            talent_profile_id: talentProfileId,
            track,
            verified_level: level,
            issued_at: issuedAt,
            expires_at: expiresAt,
            revoked_at: null,
          }),
        );
      } catch (err) {
        // A code collision or a concurrent first pass: look again, else retry.
        const raced = await this.certRepo.findOne({
          where: {
            talent_profile_id: talentProfileId,
            track,
            verified_level: level,
          },
        });
        if (raced) return raced;
        this.logger.warn(
          `Certificate code collision (attempt ${attempt + 1}): ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }
    throw new Error('Could not allocate a certificate code');
  }

  async listForTalentProfile(
    talentProfileId: string,
  ): Promise<CertificateView[]> {
    const certs = await this.certRepo.find({
      where: { talent_profile_id: talentProfileId },
      relations: { talent_profile: { user: true } },
      order: { issued_at: 'DESC' },
    });
    return certs.map((c) => this.toView(c));
  }

  async getPublic(code: string): Promise<CertificateView> {
    const cert = await this.certRepo.findOne({
      where: { code: code.trim().toUpperCase() },
      relations: { talent_profile: { user: true } },
    });
    if (!cert) throw new NotFoundException('Certificate not found');
    return this.toView(cert);
  }

  private toView(cert: TalentCertificate): CertificateView {
    return {
      code: cert.code,
      holder_name: cert.talent_profile?.user?.fullname ?? '',
      track: cert.track,
      track_label: titleCase(cert.track),
      level: cert.verified_level,
      level_label: titleCase(cert.verified_level),
      issued_at: cert.issued_at,
      expires_at: cert.expires_at,
      status: resolveCertificateStatus(cert),
    };
  }
}
