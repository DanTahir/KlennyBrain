/**
 * Branding configuration for KlennyBrain API
 *
 * This file centralizes all branding-related strings and values.
 * Used for easy rebranding and future localization/i18n support.
 */

export const branding = {
  /**
   * Application name
   */
  appName: 'KlennyBrain',

  /**
   * Email configuration
   */
  email: {
    /**
     * Email addresses
     */
    addresses: {
      from: 'noreply@klennybrain.local',
      support: 'support@klennybrain.local',
      domain: 'klennybrain.local',
    },

    /**
     * Default sender names
     */
    fromName: 'KlennyBrain',
    fromNameDev: 'KlennyBrain Dev',

    /**
     * Logo and alt text
     */
    logo: {
      altText: 'KlennyBrain Logo',
      defaultAltText: 'Organization Logo',
    },

    /**
     * Email template text
     */
    templates: {
      defaultTitle: 'KlennyBrain',
      copyright: (year: number) => `© ${year} KlennyBrain. All rights reserved.`,
      helpText: (contactEmail: string) => `Need help? Contact us at ${contactEmail}`,
    },
  },

  /**
   * Email subject lines
   */
  emailSubjects: {
    verification: 'Verify your KlennyBrain email address',
    passwordReset: 'KlennyBrain - Password Reset Request',
    otpVerification: 'Your KlennyBrain Verification Code',
    userInvitation: (organizationName: string) =>
      `You're invited to join ${organizationName} on KlennyBrain`,
    invitationAccepted: (organizationName: string) =>
      `Welcome to ${organizationName} on KlennyBrain`,
  },

  /**
   * Email body text
   */
  emailBody: {
    verification: {
      greeting: (firstName: string) => `Hi ${firstName},`,
      signupThanks: 'Thank you for signing up for KlennyBrain!',
      verifyPrompt: 'Please verify your email address by clicking the button below:',
      ignoreNotice: "If you didn't create an account, you can safely ignore this email.",
    },
    passwordReset: {
      resetPrompt:
        'We received a request to reset your password for your KlennyBrain account. If you made this request, click the button below to reset your password:',
    },
    otpVerification: {
      codePrompt: 'Your verification code for KlennyBrain is:',
    },
    userInvitation: {
      invitationText: (inviterName: string, organizationName: string, roleName: string) =>
        `${inviterName} has invited you to join ${organizationName} on KlennyBrain as a ${roleName}.`,
      welcomeText: 'Welcome to KlennyBrain!',
    },
    invitationAccepted: {
      welcomeText: (organizationName: string, roleName: string) =>
        `Congratulations! You have successfully joined ${organizationName} on KlennyBrain as a ${roleName}.`,
    },
  },

  /**
   * Service defaults
   */
  service: {
    defaultOrganizationName: 'KlennyBrain',
  },

  /**
   * Frontend URLs
   */
  urls: {
    frontend: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
} as const;

/**
 * Type-safe branding access
 */
export type Branding = typeof branding;
