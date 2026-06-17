import type {
  LoginChallenge as PrismaLoginChallenge,
  OAuthAccount as PrismaOAuthAccount,
  OAuthProvider as PrismaOAuthProvider,
  OAuthState as PrismaOAuthState,
  OAuthStatePurpose as PrismaOAuthStatePurpose,
  PasswordCredential as PrismaPasswordCredential,
  RecoveryCode as PrismaRecoveryCode,
  Session as PrismaSession,
  TwoFactorTotp as PrismaTwoFactorTotp,
  User as PrismaUser,
  UserRole as PrismaUserRole,
  UserStatus as PrismaUserStatus
} from '@prisma/client';
import type { LoginChallenge } from '../modules/auth/auth.repository.js';
import type { PasswordCredential } from '../modules/auth/auth.types.js';
import type { OAuthAccountRecord, OAuthProvider, OAuthStatePurpose, OAuthStateRecord } from '../modules/oauth/oauth.types.js';
import type { Session } from '../modules/sessions/sessions.types.js';
import type { RecoveryCodeRecord, TotpRecord } from '../modules/two_factor/twoFactor.types.js';
import type { User, UserRole, UserStatus } from '../modules/users/users.types.js';

export function mapUser(row: PrismaUser): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
    role: mapUserRole(row.role),
    status: mapUserStatus(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function toPrismaUserRole(role: UserRole): PrismaUserRole {
  return role === 'admin' ? 'ADMIN' : 'USER';
}

export function toPrismaUserStatus(status: UserStatus): PrismaUserStatus {
  return status === 'disabled' ? 'DISABLED' : 'ACTIVE';
}

function mapUserRole(role: PrismaUserRole): UserRole {
  return role === 'ADMIN' ? 'admin' : 'user';
}

function mapUserStatus(status: PrismaUserStatus): UserStatus {
  return status === 'DISABLED' ? 'disabled' : 'active';
}

export function mapPasswordCredential(row: PrismaPasswordCredential): PasswordCredential {
  return {
    userId: row.userId,
    passwordHash: row.passwordHash,
    passwordUpdatedAt: row.passwordUpdatedAt
  };
}

export function mapSession(row: PrismaSession): Session {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.sessionTokenHash,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    reauthenticatedAt: row.reauthenticatedAt
  };
}

export function mapLoginChallenge(row: PrismaLoginChallenge): LoginChallenge {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.challengeTokenHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent
  };
}

export function mapTotpRecord(row: PrismaTwoFactorTotp): TotpRecord {
  return {
    id: row.id,
    userId: row.userId,
    secretEncrypted: row.secretEncrypted,
    enabledAt: row.enabledAt,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapRecoveryCode(row: PrismaRecoveryCode): RecoveryCodeRecord {
  return {
    id: row.id,
    userId: row.userId,
    codeHash: row.codeHash,
    createdAt: row.createdAt,
    usedAt: row.usedAt,
    replacedAt: row.replacedAt
  };
}

export function mapOAuthProvider(provider: PrismaOAuthProvider): OAuthProvider {
  if (provider !== 'FORTY_TWO') throw new Error(`Unsupported OAuth provider: ${provider}`);
  return '42';
}

export function toPrismaOAuthProvider(provider: OAuthProvider): PrismaOAuthProvider {
  if (provider !== '42') throw new Error(`Unsupported OAuth provider: ${provider}`);
  return 'FORTY_TWO';
}

export function mapOAuthStatePurpose(purpose: PrismaOAuthStatePurpose): OAuthStatePurpose {
  return purpose === 'LINK' ? 'link' : 'login';
}

export function toPrismaOAuthStatePurpose(purpose: OAuthStatePurpose): PrismaOAuthStatePurpose {
  return purpose === 'link' ? 'LINK' : 'LOGIN';
}

export function mapOAuthAccount(row: PrismaOAuthAccount): OAuthAccountRecord {
  return {
    id: row.id,
    userId: row.userId,
    provider: mapOAuthProvider(row.provider),
    providerUserId: row.providerUserId,
    providerLogin: row.providerLogin,
    providerEmail: row.providerEmail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapOAuthState(row: PrismaOAuthState): OAuthStateRecord {
  return {
    id: row.id,
    provider: mapOAuthProvider(row.provider),
    purpose: mapOAuthStatePurpose(row.purpose),
    initiatingUserId: row.initiatingUserId,
    stateTokenHash: row.stateTokenHash,
    redirectTo: row.redirectTo,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt
  };
}
