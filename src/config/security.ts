import { env } from './env.js';

export const securityConfig = {
  cookieName: env.SESSION_COOKIE_NAME,
  oauthCookieName: 'oauth42',
  cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  cookieSameSite: 'lax' as const,
  sessionTtlMs: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  loginChallengeTtlMs: 5 * 60 * 1000,
  oauthStateTtlMs: 10 * 60 * 1000,
  sensitiveActionTtlMs: 10 * 60 * 1000,
  totpIssuer: env.TOTP_ISSUER,
  totpEncryptionKeyBase64: env.TOTP_ENCRYPTION_KEY_BASE64
};

