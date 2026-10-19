import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthResult, AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { UploadService } from '../upload/upload.service';
import { EmployerPoolProfile } from './entities/employer-pool-profile.entity';
import {
  NotificationPreferenceChannel,
  UserNotificationPreference,
} from '../notifications/user-notification-preference.entity';
import { NotificationType } from '../notifications/notification-type.enum';
import { CompleteTalentOnboardingDto } from './dto/complete-talent-onboarding.dto';
import { SetGoalDto } from './dto/set-goal.dto';
import { SetTracksDto } from './dto/set-tracks.dto';
import { SetProfileDto } from './dto/set-profile.dto';
import { SaveGoalDto } from './dto/save-goal.dto';
import { SaveTrackBody } from './dto/save-track.dto';
import { SaveTalentProfileDto } from './dto/save-talent-profile.dto';
import {
  TalentProfile,
  TalentAvailabilityStatus,
  TalentProfileStatus,
} from './entities/talent-profile.entity';
import {
  UpdateCommunicationPreferencesDto,
  UpdateTalentAvailabilityDto,
  UpdateTalentSettingsProfileDto,
} from './dto/settings.dto';
import {
  BadRequestError,
  ConflictError,
  ErrorMessages,
  ForbiddenError,
  SuccessMessages,
} from '../../shared';
import { AiResourcesService } from '../ai-resources/ai-resources.service';
import { listTalentSupportedRoleTracks } from './talent.constants';

export type TalentOnboardingResult = {
  message: string;
  user: AuthResult['data']['user'];
  profile: TalentProfile;
  tokens: AuthResult['tokens'];
};

export type TalentStepResult = {
  message: string;
  profile: TalentProfile;
};

@Injectable()
export class TalentService {
  private readonly logger = new Logger(TalentService.name);

  constructor(
    @InjectRepository(TalentProfile)
    private readonly talentProfileRepository: Repository<TalentProfile>,
    @InjectRepository(EmployerPoolProfile)
    private readonly employerPoolProfileRepository: Repository<EmployerPoolProfile>,
    @InjectRepository(UserNotificationPreference)
    private readonly notificationPreferenceRepository: Repository<UserNotificationPreference>,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly uploadService: UploadService,
    private readonly aiResourcesService: AiResourcesService,
  ) {}

  /** Find or create a talent profile for the given user (upsert helper). */
  private async findOrCreateProfile(userId: string): Promise<TalentProfile> {
    const existing = await this.talentProfileRepository.findOne({
      where: { user_id: userId },
    });
    if (existing) return existing;

    const created = this.talentProfileRepository.create({
      user_id: userId,
      role_track: null,
      role_tracks: null,
      goal: null,
      region: null,
      education_level: null,
      linkedin_url: null,
      onboarding_step: 0,
      status: TalentProfileStatus.NOT_STARTED,
      bio: null,
      profile_share_link: null,
      is_published: false,
      published_at: null,
    });
    return this.talentProfileRepository.save(created);
  }

  async getSettings(userId: string) {
    const user = await this.usersService.findOne(userId);
    const profile = await this.findOrCreateProfile(userId);
    const communication_preferences =
      await this.getCommunicationPreferences(userId);

    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: user.fullname,
        avatar_url: user.avatar_url,
        role: user.role,
      },
      profile: {
        id: profile.id,
        role_track: profile.track ?? profile.role_track,
        role_label: this.toRoleLabel(profile.track ?? profile.role_track),
        linkedin_url: profile.linkedin_url,
        bio: profile.bio,
        personal_website: profile.personal_website,
        resume_url: profile.resume_url,
        resume_filename: profile.resume_filename,
        availability_status: profile.availability_status,
        is_published: profile.is_published,
        status: profile.status,
        profile_verified: profile.profile_verified,
      },
      communication_preferences,
      account: {
        password_set: true,
        active_sessions: [
          {
            label: 'Current session',
            is_current: true,
          },
        ],
      },
    };
  }

  async updateSettingsProfile(
    userId: string,
    dto: UpdateTalentSettingsProfileDto,
  ) {
    await this.talentProfileRepository.manager.transaction(async (manager) => {
      const userPatch: Partial<User> = {};
      if (dto.firstName !== undefined) {
        const firstName = dto.firstName.trim();
        if (!firstName) {
          throw new BadRequestException('firstName must not be empty');
        }
        userPatch.first_name = firstName;
      }
      if (dto.lastName !== undefined) {
        const lastName = dto.lastName.trim();
        if (!lastName) {
          throw new BadRequestException('lastName must not be empty');
        }
        userPatch.last_name = lastName;
      }
      if (Object.keys(userPatch).length > 0) {
        await manager.update(User, { id: userId }, userPatch);
      }

      let profile = await manager.findOne(TalentProfile, {
        where: { user_id: userId },
      });
      if (!profile) {
        profile = manager.create(TalentProfile, {
          user_id: userId,
          status: TalentProfileStatus.NOT_STARTED,
          is_published: false,
        });
      }

      if (dto.roleTrack !== undefined) {
        profile.track = dto.roleTrack;
        profile.role_track = dto.roleTrack;
      }
      if (dto.linkedinUrl !== undefined) {
        profile.linkedin_url = dto.linkedinUrl.trim();
      }
      if (dto.personalWebsite !== undefined) {
        profile.personal_website = dto.personalWebsite.trim();
      }

      await manager.save(TalentProfile, profile);
    });

    return {
      status: 'success',
      message: 'Settings profile updated',
      data: await this.getSettings(userId),
    };
  }

  async updateResume(userId: string, file: Express.Multer.File) {
    const resumeUrl = await this.uploadService.uploadResume(file);
    const profile = await this.findOrCreateProfile(userId);
    profile.resume_url = resumeUrl;
    profile.resume_filename = file.originalname;
    await this.talentProfileRepository.save(profile);
    return {
      status: 'success',
      message: 'Resume uploaded',
      resume_url: resumeUrl,
      resume_filename: file.originalname,
    };
  }

  async deleteResume(userId: string) {
    const profile = await this.findOrCreateProfile(userId);
    profile.resume_url = null;
    profile.resume_filename = null;
    await this.talentProfileRepository.save(profile);
    return { status: 'success', message: 'Resume deleted' };
  }

  async updateAvailability(userId: string, dto: UpdateTalentAvailabilityDto) {
    const saved = await this.talentProfileRepository.manager.transaction(
      async (manager) => {
        let profile = await manager.findOne(TalentProfile, {
          where: { user_id: userId },
        });
        if (!profile) {
          profile = manager.create(TalentProfile, {
            user_id: userId,
            role_track: null,
            role_tracks: null,
            goal: null,
            region: null,
            education_level: null,
            linkedin_url: null,
            onboarding_step: 0,
            status: TalentProfileStatus.NOT_STARTED,
            bio: null,
            profile_share_link: null,
            is_published: false,
            published_at: null,
          });
        }

        profile.availability_status = dto.availabilityStatus;
        profile.is_published =
          dto.availabilityStatus !== TalentAvailabilityStatus.NOT_LOOKING;
        if (!profile.is_published) {
          profile.published_at = null;
        } else if (!profile.published_at) {
          profile.published_at = new Date();
        }
        const savedProfile = await manager.save(TalentProfile, profile);

        await manager.update(
          EmployerPoolProfile,
          { talent_profile_id: savedProfile.id },
          { job_search_status: dto.availabilityStatus },
        );

        return savedProfile;
      },
    );

    return {
      status: 'success',
      message: 'Availability updated',
      availability_status: saved.availability_status,
      is_published: saved.is_published,
    };
  }

  async getCommunicationPreferences(userId: string) {
    const preferences = await this.notificationPreferenceRepository.find({
      where: { user_id: userId },
    });
    const values = this.defaultCommunicationPreferences();

    for (const preference of preferences) {
      const key = this.notificationTypeToPreferenceKey(preference.type);
      if (!key) continue;
      values[this.channelToPreferenceGroupKey(preference.channel)][key] =
        preference.enabled;
    }

    return values;
  }

  async updateCommunicationPreferences(
    userId: string,
    dto: UpdateCommunicationPreferencesDto,
  ) {
    const entries: Array<{
      channel: NotificationPreferenceChannel;
      key: keyof ReturnType<TalentService['defaultPreferenceGroup']>;
      enabled: boolean;
    }> = [];

    const groups: Array<{
      channel: NotificationPreferenceChannel;
      group?: UpdateCommunicationPreferencesDto['email'];
    }> = [
      { channel: NotificationPreferenceChannel.EMAIL, group: dto.email },
      { channel: NotificationPreferenceChannel.IN_APP, group: dto.inApp },
    ];

    for (const { channel, group } of groups) {
      if (!group) continue;

      for (const key of Object.keys(group) as Array<
        keyof ReturnType<TalentService['defaultPreferenceGroup']>
      >) {
        const enabled = group[key];
        if (enabled === undefined) continue;
        entries.push({
          channel,
          key,
          enabled,
        });
      }
    }

    await this.notificationPreferenceRepository.manager.transaction(
      async (manager) => {
        for (const entry of entries) {
          const type = this.preferenceKeyToNotificationType(entry.key);
          await manager.upsert(
            UserNotificationPreference,
            {
              user_id: userId,
              channel: entry.channel,
              type,
              enabled: entry.enabled,
            },
            ['user_id', 'channel', 'type'],
          );
        }
      },
    );

    return {
      status: 'success',
      message: 'Communication preferences updated',
      communication_preferences: await this.getCommunicationPreferences(userId),
    };
  }

  async unsubscribeEmailNotifications(userId: string) {
    return this.updateCommunicationPreferences(userId, {
      email: {
        newOffers: false,
        assessmentReminders: false,
        retakeWindowOpen: false,
      },
    });
  }

  private defaultCommunicationPreferences() {
    return {
      email: this.defaultPreferenceGroup(),
      inApp: this.defaultPreferenceGroup(),
    };
  }

  private defaultPreferenceGroup() {
    return {
      newOffers: true,
      assessmentReminders: true,
      retakeWindowOpen: true,
    };
  }

  private preferenceKeyToNotificationType(
    key: keyof ReturnType<TalentService['defaultPreferenceGroup']>,
  ): NotificationType {
    const map = {
      newOffers: NotificationType.OFFER_RECEIVED,
      assessmentReminders: NotificationType.ASSESSMENT_RECEIVED,
      retakeWindowOpen: NotificationType.ADVANCED_RETAKE_AVAILABLE,
    } satisfies Record<
      keyof ReturnType<TalentService['defaultPreferenceGroup']>,
      NotificationType
    >;
    return map[key];
  }

  private notificationTypeToPreferenceKey(
    type: NotificationType,
  ): keyof ReturnType<TalentService['defaultPreferenceGroup']> | null {
    const map: Partial<
      Record<
        NotificationType,
        keyof ReturnType<TalentService['defaultPreferenceGroup']>
      >
    > = {
      [NotificationType.OFFER_RECEIVED]: 'newOffers',
      [NotificationType.ASSESSMENT_RECEIVED]: 'assessmentReminders',
      [NotificationType.ADVANCED_RETAKE_AVAILABLE]: 'retakeWindowOpen',
    };
    return map[type] ?? null;
  }

  private channelToPreferenceGroupKey(
    channel: NotificationPreferenceChannel,
  ): keyof ReturnType<TalentService['defaultCommunicationPreferences']> {
    return channel === NotificationPreferenceChannel.IN_APP ? 'inApp' : 'email';
  }

  private toRoleLabel(roleTrack: string | null): string | null {
    if (!roleTrack) return null;
    const match = listTalentSupportedRoleTracks().find(
      (track) => track.slug === roleTrack,
    );
    if (match) {
      return match.label;
    }
    return roleTrack
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  listSupportedRoleTracks(): {
    tracks: ReturnType<typeof listTalentSupportedRoleTracks>;
  } {
    return { tracks: listTalentSupportedRoleTracks() };
  }

  async updateUserAvatar(userId: string, avatarUrl: string): Promise<void> {
    await this.usersService.updateAvatar(userId, avatarUrl);
  }

  /** BE-ONB-TAL-001 — save single goal, 422 on invalid. */
  async saveGoalStep(
    userId: string,
    dto: SaveGoalDto,
  ): Promise<{ status: string; message: string }> {
    const profile = await this.findOrCreateProfile(userId);
    profile.goal = dto.goal;
    if (profile.onboarding_step < 1) profile.onboarding_step = 1;
    await this.talentProfileRepository.save(profile);
    return {
      status: 'success',
      message: SuccessMessages.ONBOARDING.GOAL_SAVED,
    };
  }

  /** BE-ONB-TAL-002 — save single track, 422 on invalid. */
  async saveTrackStep(
    userId: string,
    dto: SaveTrackBody,
  ): Promise<{ status: string; message: string }> {
    const profile = await this.findOrCreateProfile(userId);
    profile.track = dto.track;
    if (profile.onboarding_step < 2) profile.onboarding_step = 2;
    await this.talentProfileRepository.save(profile);

    // Warm resource cache in the background so resources page loads instantly
    this.aiResourcesService.warmCache(dto.track, 'general').catch((err) => {
      this.logger.error(
        `Resource cache warming failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    });

    return {
      status: 'success',
      message: SuccessMessages.ONBOARDING.TRACK_SAVED,
    };
  }

  /** BE-ONB-TAL-003 — save profile (photo optional, optional fields optional). */
  async saveTalentProfile(
    userId: string,
    photo: Express.Multer.File | undefined,
    dto: SaveTalentProfileDto,
  ): Promise<{ status: string; message: string }> {
    const avatarUrl = photo
      ? await this.uploadService.uploadAvatar(photo)
      : null;

    await this.talentProfileRepository.manager.transaction(async (manager) => {
      let user: User;
      try {
        user = await this.usersService.getUserForOnboarding(manager, userId);
      } catch (error: unknown) {
        if (error instanceof NotFoundException) {
          throw new ForbiddenError(ErrorMessages.ONBOARDING.INVALID_USER);
        }
        throw error;
      }

      if (avatarUrl) {
        await manager.update(User, { id: userId }, { avatar_url: avatarUrl });
      }

      let profile = await manager.findOne(TalentProfile, {
        where: { user_id: userId },
      });
      if (!profile) {
        profile = manager.create(TalentProfile, {
          user_id: userId,
          status: TalentProfileStatus.NOT_STARTED,
          is_published: false,
        });
      }

      profile.region = dto.region ?? null;
      profile.education_level = dto.educationLevel ?? null;
      profile.linkedin_url = dto.linkedinProfile ?? null;
      profile.onboarding_step = 3;
      profile.profile_verified =
        !!dto.region && !!dto.educationLevel && !!dto.linkedinProfile;

      await manager.save(TalentProfile, profile);

      if (!user.onboarding_complete) {
        await this.usersService.markOnboardingCompleteWithManager(
          manager,
          userId,
        );
      }
    });

    return {
      status: 'success',
      message: SuccessMessages.ONBOARDING.TALENT_PROFILE_SAVED,
    };
  }

  /** BE-ONB-TAL-004 — trigger personalisation from saved onboarding data. */
  async personalise(
    userId: string,
  ): Promise<{ status: string; message: string }> {
    const profile = await this.talentProfileRepository.findOne({
      where: { user_id: userId },
    });

    if (!profile?.track) {
      throw new UnprocessableEntityException(
        ErrorMessages.ONBOARDING.TRACK_REQUIRED_FOR_PERSONALISE,
      );
    }

    const availableDataPoints: string[] = ['track'];
    if (profile.goal) availableDataPoints.push('goal');
    if (profile.region) availableDataPoints.push('region');
    if (profile.education_level) availableDataPoints.push('educationLevel');

    const isFullyPersonalised =
      !!profile.goal && !!profile.region && !!profile.education_level;

    try {
      this.logger.log(
        JSON.stringify({
          event: 'talent_personalisation',
          userId,
          timestamp: new Date().toISOString(),
          availableDataPoints,
          assessmentsGenerated: true,
          recommendationsGenerated: isFullyPersonalised,
          incompleteFields: isFullyPersonalised
            ? []
            : ['goal', 'region', 'educationLevel'].filter(
                (f) =>
                  !profile[
                    f === 'educationLevel'
                      ? 'education_level'
                      : (f as keyof TalentProfile)
                  ],
              ),
        }),
      );

      return {
        status: 'success',
        message: SuccessMessages.ONBOARDING.DASHBOARD_PERSONALISED,
      };
    } catch {
      throw new InternalServerErrorException(
        ErrorMessages.ONBOARDING.PERSONALISATION_FAILED,
      );
    }
  }

  async getOnboardingState(userId: string): Promise<{
    profile: TalentProfile | null;
    user: {
      id: string;
      email: string;
      first_name: string;
      last_name: string;
      avatar_url: string | null;
    };
  }> {
    const user = await this.usersService.findOne(userId);
    const profile = await this.talentProfileRepository.findOne({
      where: { user_id: userId },
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        avatar_url: user.avatar_url,
      },
      profile,
    };
  }

  async saveGoal(userId: string, dto: SetGoalDto): Promise<TalentStepResult> {
    const user = await this.usersService.findOne(userId);
    if (user.onboarding_complete) {
      throw new ForbiddenError(ErrorMessages.ONBOARDING.ALREADY_COMPLETED);
    }

    const profile = await this.findOrCreateProfile(userId);
    profile.goal = dto.goal;
    if (profile.onboarding_step < 1) profile.onboarding_step = 1;

    const saved = await this.talentProfileRepository.save(profile);
    return { message: SuccessMessages.ONBOARDING.GOAL_SAVED, profile: saved };
  }

  async saveTracks(
    userId: string,
    dto: SetTracksDto,
  ): Promise<TalentStepResult> {
    const user = await this.usersService.findOne(userId);
    if (user.onboarding_complete) {
      throw new ForbiddenError(ErrorMessages.ONBOARDING.ALREADY_COMPLETED);
    }

    const profile = await this.findOrCreateProfile(userId);
    profile.role_tracks = dto.roleTracks;
    if (profile.onboarding_step < 2) profile.onboarding_step = 2;

    const saved = await this.talentProfileRepository.save(profile);
    return { message: SuccessMessages.ONBOARDING.TRACKS_SAVED, profile: saved };
  }

  async saveProfile(
    userId: string,
    dto: SetProfileDto,
  ): Promise<TalentOnboardingResult> {
    const profile = await this.talentProfileRepository.manager.transaction(
      async (manager) => {
        let user: User;
        try {
          user = await this.usersService.getUserForOnboarding(manager, userId);
        } catch (error: unknown) {
          if (error instanceof NotFoundException) {
            throw new ForbiddenError(ErrorMessages.ONBOARDING.INVALID_USER);
          }
          throw error;
        }
        if (user.onboarding_complete) {
          throw new ForbiddenError(ErrorMessages.ONBOARDING.ALREADY_COMPLETED);
        }

        let talentProfile = await manager.findOne(TalentProfile, {
          where: { user_id: userId },
        });
        if (!talentProfile) {
          talentProfile = manager.create(TalentProfile, {
            user_id: userId,
            status: TalentProfileStatus.NOT_STARTED,
            is_published: false,
          });
        }

        // No anonymous talent: employers hire people, so a photo, a resume
        // and a portfolio link are all required to finish onboarding.
        if (!dto.avatarUrl && !user.avatar_url) {
          throw new BadRequestError(
            ErrorMessages.ONBOARDING.PROFILE_PHOTO_REQUIRED,
          );
        }
        if (!talentProfile.resume_url) {
          throw new BadRequestError(ErrorMessages.ONBOARDING.RESUME_REQUIRED);
        }
        const portfolio =
          dto.portfolioUrl?.trim() || talentProfile.personal_website;
        if (!portfolio) {
          throw new BadRequestError(
            ErrorMessages.ONBOARDING.PORTFOLIO_REQUIRED,
          );
        }
        talentProfile.personal_website = portfolio;

        if (dto.region !== undefined) {
          talentProfile.region = dto.region;
        }
        if (dto.educationLevel !== undefined) {
          talentProfile.education_level = dto.educationLevel;
        }
        if (dto.linkedinUrl === null) {
          talentProfile.linkedin_url = null;
        } else if (typeof dto.linkedinUrl === 'string') {
          talentProfile.linkedin_url = dto.linkedinUrl.trim();
        }
        talentProfile.onboarding_step = 3;

        if (dto.avatarUrl) {
          await manager.update(
            User,
            { id: userId },
            { avatar_url: dto.avatarUrl },
          );
        }

        const savedProfile = await manager.save(TalentProfile, talentProfile);
        await this.usersService.markOnboardingCompleteWithManager(
          manager,
          userId,
        );

        return savedProfile;
      },
    );

    const session = await this.authService.issueSessionForUser(
      userId,
      SuccessMessages.ONBOARDING.PROFILE_SAVED,
    );

    return {
      message: session.message,
      user: session.data.user,
      profile,
      tokens: session.tokens,
    };
  }

  /** Legacy single-step onboarding — kept for backward compatibility. */
  async completeOnboarding(
    userId: string,
    dto: CompleteTalentOnboardingDto,
  ): Promise<TalentOnboardingResult> {
    const profile = await this.talentProfileRepository.manager.transaction(
      async (manager) => {
        let user: User;
        try {
          user = await this.usersService.getUserForOnboarding(manager, userId);
        } catch (error: unknown) {
          if (error instanceof NotFoundException) {
            throw new ForbiddenError(ErrorMessages.ONBOARDING.INVALID_USER);
          }
          throw error;
        }
        if (user.onboarding_complete) {
          throw new ForbiddenError(ErrorMessages.ONBOARDING.ALREADY_COMPLETED);
        }

        const existingProfile = await manager.findOne(TalentProfile, {
          where: { user_id: userId },
        });
        if (existingProfile) {
          throw new ConflictError(
            ErrorMessages.ONBOARDING.TALENT_PROFILE_EXISTS,
          );
        }

        const nextProfile = manager.create(TalentProfile, {
          user_id: userId,
          track: dto.roleTrack.trim(),
          role_track: dto.roleTrack.trim(),
          bio: dto.bio?.trim() || null,
          status: TalentProfileStatus.NOT_STARTED,
          profile_share_link: null,
          is_published: false,
          published_at: null,
        });

        const savedProfile = await manager.save(TalentProfile, nextProfile);
        await this.usersService.markOnboardingCompleteWithManager(
          manager,
          userId,
        );

        return savedProfile;
      },
    );

    const session = await this.authService.issueSessionForUser(
      userId,
      SuccessMessages.ONBOARDING.TALENT_COMPLETED,
    );

    return {
      message: session.message,
      user: session.data.user,
      profile,
      tokens: session.tokens,
    };
  }
}
