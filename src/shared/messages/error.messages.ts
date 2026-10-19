export const ErrorMessages = {
  AUTH: {
    INVALID_OR_EXPIRED_OTP: 'Invalid or expired otp',
    ACCOUNT_NOT_FOUND: 'Account not found',
    ACCOUNT_ALREADY_VERIFIED: 'Account is already verified',
    TOO_MANY_REQUESTS: 'Too many requests. Please wait before trying again.',
    INVALID_CREDENTIALS: 'Invalid credentials',
    EMAIL_NOT_VERIFIED: 'Please verify your email to continue',
    INVALID_OR_EXPIRED_TOKEN: 'Invalid or expired token',
    TOKEN_ALREADY_USED: 'Token already used',
    INVALID_REFRESH_TOKEN: 'Invalid refresh token',
    REFRESH_TOKEN_REVOKED: 'Refresh token has been revoked',
    INVALID_ACCESS_TOKEN: 'Invalid access token',
    GOOGLE_AUTH_FAILED: 'Google authentication failed',
    INVALID_OAUTH_SIGNUP_ROLE: 'Invalid OAuth signup role',
    OAUTH_SIGNUP_ROLE_REQUIRED: 'OAuth signup role required',
    WRONG_CURRENT_PASSWORD: 'Current password is incorrect',
    SAME_PASSWORD: 'New password must differ from the current password',
    OAUTH_ACCOUNT_NO_PASSWORD:
      'This account uses social login and has no password to change',
    ACCOUNT_DEACTIVATED:
      'This account has been deactivated. Contact a Super Admin for access.',
    INCORRECT_EMAIL_OR_PASSWORD: 'Incorrect email or password.',
    NO_ADMIN_ACCOUNT_FOUND: 'No account found with this email.',
  },
  USER: {
    EMAIL_ALREADY_REGISTERED: 'Email already registered',
    NOT_FOUND: (id: string) => `User ${id} not found`,
    UPDATE_FAILED: 'Failed to update user',
  },
  INQUIRIES: {
    EMAIL_ALREADY_ON_WAITLIST: 'Email already on waitlist',
  },
  ASSESSMENT: {
    INVALID_SECTION: 'Section must be an integer between 1 and 7',
    ALREADY_COMPLETED: 'Personal assessment is already completed',
  },
  SKILL_ASSESSMENT: {
    PROFILE_NOT_FOUND: 'Talent profile not found',
    PERSONAL_ASSESSMENT_INCOMPLETE:
      'Complete your personal assessment before starting a skill assessment',
    CLAIMED_LEVEL_MISSING:
      'claimed_level is required to start a skill assessment; please complete personal assessment first',
    TRACK_MISSING:
      'track is required to start a skill assessment; please complete onboarding track step first',
    NO_QUESTIONS_AVAILABLE:
      'Your next attempt is not open yet. We will notify you when you can retake it.',
    ATTEMPT_NOT_FOUND: 'Assessment attempt not found',
    ATTEMPT_ALREADY_SUBMITTED:
      'This assessment attempt has already been submitted',
    TIME_EXPIRED:
      'The time limit for this skill assessment ran out before it was submitted. This attempt has been used.',
    ATTEMPT_CORRUPT:
      'Assessment attempt has no questions; please start a new session',
    PASS_REQUIRED:
      'Complete the skill assessment with an overall score of at least 50% and a validated level before starting the advanced assessment',
    QUALITY_REQUIRED:
      'You need an overall score of at least 50% on a completed skill assessment before starting the advanced assessment',
    MAX_ATTEMPTS_REACHED:
      'You have used all three skill assessment attempts. Complete the advanced assessment to unlock further skill retakes.',
    ACTIVE_SESSION_EXISTS: 'Active skill assessment session already exists',
    SESSION_VOIDED:
      'Skill assessment session has been voided due to integrity violations.',
  },
  ADVANCED_ASSESSMENT: {
    PROFILE_NOT_FOUND: 'Talent profile not found',
    PERSONAL_ASSESSMENT_INCOMPLETE:
      'Complete your personal assessment before starting the advanced assessment',
    SKILL_GATE_REQUIRED:
      'Complete the skill assessment before starting the advanced assessment',
    LEVEL_NOT_VERIFIED: 'LEVEL_NOT_VERIFIED',
    BANK_EXHAUSTED:
      'Your next attempt is not open yet. We will notify you when you can retake it.',
    ACTIVE_SESSION_EXISTS: 'Active advanced assessment session already exists',
    SESSION_NOT_FOUND: 'Advanced assessment session not found',
    SESSION_CORRUPT: 'Advanced assessment session has no questions',
    ATTEMPT_NOT_FOUND: 'Assessment session not found',
    ATTEMPT_ALREADY_SUBMITTED:
      'This assessment session has already been submitted',
    SUBMIT_PROCESSING:
      'Your previous advanced assessment submission is still being processed. Please wait for results before starting again.',
    SESSION_EXPIRED: 'Assessment session has expired',
    RETAKE_LOCKED: (unlocksAt: string) =>
      `Advanced assessment is locked until ${unlocksAt}. Retakes are available after a 14-day gate.`,
    SKILL_QUALITY_REQUIRED:
      'Complete the skill assessment with an overall score of at least 50% before starting the advanced assessment',
    SESSION_VOIDED:
      'Assessment session has been voided due to integrity violations. A 14-day retake gate has started.',
    LT2_NOT_SUBMITTED: 'Complete the previous question to continue.',
    LT2_QUESTION_MISMATCH:
      'The question_id provided does not match the LT-2 (work task) question for this session.',
    LT3_GENERATION_FAILED:
      'We could not generate your reflection question. Please retry in a moment.',
    SUBMIT_QUEUE_UNAVAILABLE:
      'Advanced assessment submission is temporarily unavailable. Please retry.',
  },
  ONBOARDING: {
    INVALID_USER: 'Invalid user',
    ALREADY_COMPLETED: 'Onboarding already completed',
    TALENT_PROFILE_EXISTS: 'Talent profile already exists',
    EMPLOYER_PROFILE_EXISTS: 'Employer profile already exists',
    CANDIDATE_PROFILE_EXISTS: 'Candidate profile already exists',
    NO_FILE: 'No file provided',
    PHOTO_REQUIRED: 'Photo is required',
    INVALID_FILE_TYPE: 'Only image files are allowed (jpeg, png, webp)',
    INVALID_PHOTO_TYPE: 'Invalid file type, please upload a valid image',
    FILE_TOO_LARGE: 'File must be smaller than 5 MB',
    PHOTO_TOO_LARGE: 'File size too large, please upload a smaller image',
    TRACK_REQUIRED_FOR_PERSONALISE: 'Track is required to generate assessments',
    PERSONALISATION_FAILED: 'Personalisation failed, please try again',
  },
  VERIFIED_PROFILE: {
    NOT_AVAILABLE:
      'Verified profile is only available for job-ready talents who have completed the advanced assessment',
    NOT_FOUND: 'Verified profile not found',
    INVALID_TOKEN: 'Invalid share link token',
    TIMESTAMP_UNAVAILABLE:
      'Verified profile verification timestamp is not available',
  },
  COMMON: {
    INSUFFICIENT_PERMISSIONS: 'Insufficient permissions',
    INTERNAL_SERVER_ERROR: 'Internal server error',
  },
  AI_RESOURCES: {
    NO_ASSESSMENT_SCORES:
      'Please complete at least one assessment to view personalized resources.',
    PROFILE_NOT_FOUND: 'Talent profile not found',
  },
  EMPLOYER_DISCOVERY: {
    CANDIDATE_NOT_FOUND: 'Candidate not found',
    NOT_JOB_READY: 'Only Job Ready candidates are accessible to employers',
    ALREADY_SAVED: 'Candidate already saved',
    SAVED_NOT_FOUND: 'Saved candidate not found',
    CONTACT_NOT_JOB_READY: 'Only Job Ready candidates can be contacted',
  },
  OFFERS: {
    CANDIDATE_NOT_FOUND: 'Candidate not found',
    NOT_JOB_READY: 'Offers can only be sent to Job Ready candidates',
    MONTHLY_CAP_REACHED: 'Monthly offer limit reached. Try again next month.',
    OFFER_NOT_FOUND: 'Offer not found',
    CANNOT_RESPOND: 'Cannot respond to an offer that is not pending',
    OFFER_EXPIRED: 'This offer has expired',
  },
  EMPLOYER_VERIFICATION: {
    NOT_VERIFIED:
      'Your employer account is pending verification. You will be notified once approved.',
    WEBSITE_NOT_RESOLVABLE:
      'Company website could not be reached. Please check the URL.',
  },
  EMPLOYER_PROFILE: {
    FIELD_LOCKED: (lastChangedAt: string, unlocksAt: string) =>
      `This field was last updated on ${lastChangedAt} and can next be changed on ${unlocksAt}.`,
  },
  ADMIN_MANAGEMENT: {
    ADMIN_NOT_FOUND: (id: string) => `Admin account ${id} not found`,
    EMAIL_UNCHANGED: 'New email must differ from the current email',
    ROLE_UNCHANGED: 'Role is already set to the requested tier',
    SUPER_ADMIN_DOWNGRADE_CONFIRMATION_REQUIRED:
      'Confirm downgrade before changing a Super Admin to a lower tier',
    CANNOT_SELF_DEACTIVATE: 'You cannot deactivate your own account',
    ALREADY_DEACTIVATED: 'Account is already deactivated',
    ALREADY_ACTIVE: 'Account is already active',
    LAST_SUPER_ADMIN_PROTECTED:
      'At least one active Super Admin must remain on the platform',
  },
} as const;
