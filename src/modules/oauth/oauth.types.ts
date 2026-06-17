import type { LoginResult } from '../auth/auth.types.js';

export type OAuthProvider = '42';
export type OAuthStatePurpose = 'login' | 'link';

export type OAuthStateRecord = {
  id: string;
  provider: OAuthProvider;
  purpose: OAuthStatePurpose;
  initiatingUserId: string | null;
  stateTokenHash: string;
  redirectTo: string | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type OAuthAccountRecord = {
  id: string;
  userId: string;
  provider: OAuthProvider;
  providerUserId: string;
  providerLogin: string | null;
  providerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FortyTwoProfile = {
  id: number;
  login: string;
  email?: string | null;
  displayname?: string | null;
};

export type OAuthCallbackResult = LoginResult;

export type OAuthLinkResult = {
  ok: true;
  linked: true;
  alreadyLinked: boolean;
};

export type OAuthUnlinkResult = {
  ok: true;
  unlinked: true;
};
