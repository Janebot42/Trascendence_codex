import { env } from '../../config/env.js';
import { securityConfig } from '../../config/security.js';
import { hashToken } from '../../shared/crypto/hashToken.js';
import { randomToken } from '../../shared/crypto/randomToken.js';
import { badRequest, conflict, unauthorized } from '../../shared/errors/httpErrors.js';
import type { AuthRepository } from '../auth/auth.repository.js';
import type { AuthService } from '../auth/auth.service.js';
import type { UsersService } from '../users/users.service.js';
import type { OAuthRepository } from './oauth.repository.js';
import type { FortyTwoProfile, OAuthCallbackResult, OAuthLinkResult, OAuthUnlinkResult } from './oauth.types.js';

export class OAuthService {
  constructor(
    private readonly oauthRepository: OAuthRepository,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly authRepository: AuthRepository
  ) {}

  async startFortyTwoLogin() {
    return this.createAuthorizationRequest({ purpose: 'login', initiatingUserId: null });
  }

  async startFortyTwoLink(input: { userId: string }) {
    return this.createAuthorizationRequest({ purpose: 'link', initiatingUserId: input.userId });
  }

  async completeFortyTwoCallback(input: {
    code?: string;
    state?: string;
    browserState?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<OAuthCallbackResult> {
    this.assertConfigured();
    const stateRecord = await this.consumeAndValidateState({
      code: input.code,
      state: input.state,
      browserState: input.browserState,
      expectedPurpose: 'login'
    });
    if (stateRecord.initiatingUserId) throw unauthorized('Invalid OAuth state');

    const accessToken = await this.exchangeCodeForAccessToken(input.code!);
    const profile = await this.fetchFortyTwoProfile(accessToken);
    const user = await this.resolveLocalUser(profile);

    return this.authService.completeTrustedLogin({
      userId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });
  }

  async completeFortyTwoLinkCallback(input: {
    code?: string;
    state?: string;
    browserState?: string | null;
    currentUserId: string;
  }): Promise<OAuthLinkResult> {
    this.assertConfigured();
    const stateRecord = await this.consumeAndValidateState({
      code: input.code,
      state: input.state,
      browserState: input.browserState,
      expectedPurpose: 'link'
    });

    if (!stateRecord.initiatingUserId || stateRecord.initiatingUserId !== input.currentUserId) {
      throw unauthorized('Invalid OAuth state');
    }

    const accessToken = await this.exchangeCodeForAccessToken(input.code!);
    const profile = await this.fetchFortyTwoProfile(accessToken);
    const providerUserId = String(profile.id);
    const existingAccount = await this.oauthRepository.findAccountByProviderUserId('42', providerUserId);

    if (existingAccount) {
      if (existingAccount.userId !== input.currentUserId) {
        throw conflict('This OAuth account already belongs to another user', 'OAUTH_ALREADY_LINKED_TO_OTHER_USER');
      }
      return { ok: true, linked: true, alreadyLinked: true };
    }

    await this.oauthRepository.createAccount({
      userId: input.currentUserId,
      provider: '42',
      providerUserId,
      providerLogin: profile.login,
      providerEmail: profile.email?.toLowerCase() ?? null
    });

    return { ok: true, linked: true, alreadyLinked: false };
  }

  async unlinkFortyTwo(input: { userId: string }): Promise<OAuthUnlinkResult> {
    const account = await this.oauthRepository.findAccountByUserIdAndProvider(input.userId, '42');
    if (!account) throw conflict('OAuth account is not linked', 'OAUTH_NOT_LINKED');

    const hasPassword = Boolean(await this.authRepository.findPasswordCredential(input.userId));
    const oauthCount = await this.oauthRepository.countAccountsForUser(input.userId);
    if (!hasPassword && oauthCount <= 1) {
      throw conflict('This account would lose all access methods', 'OAUTH_UNLINK_FORBIDDEN');
    }

    await this.oauthRepository.deleteAccount(account.id);
    return { ok: true, unlinked: true };
  }

  private async createAuthorizationRequest(input: { purpose: 'login' | 'link'; initiatingUserId: string | null }) {
    this.assertConfigured();

    const state = randomToken(24);
    await this.oauthRepository.createState({
      provider: '42',
      purpose: input.purpose,
      initiatingUserId: input.initiatingUserId,
      stateTokenHash: hashToken(state),
      redirectTo: null,
      expiresAt: new Date(Date.now() + securityConfig.oauthStateTtlMs)
    });

    const authorizeUrl = new URL(env.OAUTH_42_AUTHORIZE_URL!);
    authorizeUrl.searchParams.set('client_id', env.OAUTH_42_CLIENT_ID!);
    authorizeUrl.searchParams.set('redirect_uri', env.OAUTH_42_REDIRECT_URI!);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('state', state);
    return { authorizationUrl: authorizeUrl.toString(), state };
  }

  private async consumeAndValidateState(input: {
    code?: string;
    state?: string;
    browserState?: string | null;
    expectedPurpose: 'login' | 'link';
  }) {
    if (!input.code || !input.state) throw badRequest('Missing OAuth callback parameters');
    if (!input.browserState || input.browserState !== input.state) {
      throw unauthorized('OAuth login session mismatch');
    }

    const stateRecord = await this.oauthRepository.consumeStateByTokenHash(hashToken(input.state));
    if (!stateRecord || stateRecord.expiresAt <= new Date() || stateRecord.purpose !== input.expectedPurpose) {
      throw unauthorized('Invalid OAuth state');
    }

    return stateRecord;
  }

  private async exchangeCodeForAccessToken(code: string): Promise<string> {
    const response = await fetch(env.OAUTH_42_TOKEN_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.OAUTH_42_CLIENT_ID!,
        client_secret: env.OAUTH_42_CLIENT_SECRET!,
        code,
        redirect_uri: env.OAUTH_42_REDIRECT_URI!
      })
    });

    if (!response.ok) throw unauthorized('OAuth token exchange failed');
    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) throw unauthorized('OAuth token exchange failed');
    return data.access_token;
  }

  private async fetchFortyTwoProfile(accessToken: string): Promise<FortyTwoProfile> {
    const response = await fetch(env.OAUTH_42_ME_URL!, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) throw unauthorized('OAuth profile fetch failed');
    const data = (await response.json()) as FortyTwoProfile;
    if (!data.login || typeof data.id !== 'number') throw unauthorized('OAuth profile is incomplete');
    return data;
  }

  private async resolveLocalUser(profile: FortyTwoProfile) {
    const existingAccount = await this.oauthRepository.findAccountByProviderUserId('42', String(profile.id));
    if (existingAccount) {
      const user = await this.usersService.findById(existingAccount.userId);
      if (!user) throw unauthorized('OAuth account is linked to a missing user');
      return user;
    }

    const normalizedEmail = profile.email?.toLowerCase() ?? null;
    if (normalizedEmail) {
      const existingEmailUser = await this.usersService.findByEmail(normalizedEmail);
      if (existingEmailUser) {
        throw conflict('An existing local account already uses this email', 'OAUTH_ACCOUNT_LINK_REQUIRED');
      }
    }

    const username = await this.generateAvailableUsername(profile.login);
    const user = await this.usersService.createUser({
      username,
      email: normalizedEmail,
      displayName: profile.displayname ?? null
    });

    await this.oauthRepository.createAccount({
      userId: user.id,
      provider: '42',
      providerUserId: String(profile.id),
      providerLogin: profile.login,
      providerEmail: normalizedEmail
    });

    return user;
  }

  private async generateAvailableUsername(baseLogin: string): Promise<string> {
    const normalizedBase = baseLogin.trim().toLowerCase();
    if (!(await this.usersService.findByUsername(normalizedBase))) return normalizedBase;

    for (let suffix = 1; suffix <= 1000; suffix += 1) {
      const candidate = `${normalizedBase}-${suffix}`;
      if (!(await this.usersService.findByUsername(candidate))) return candidate;
    }

    throw conflict('Could not allocate a username for this OAuth account', 'OAUTH_USERNAME_CONFLICT');
  }

  private assertConfigured(): void {
    if (
      !env.OAUTH_42_CLIENT_ID ||
      !env.OAUTH_42_CLIENT_SECRET ||
      !env.OAUTH_42_REDIRECT_URI ||
      !env.OAUTH_42_AUTHORIZE_URL ||
      !env.OAUTH_42_TOKEN_URL ||
      !env.OAUTH_42_ME_URL
    ) {
      throw new Error('OAuth 42 is not configured');
    }
  }
}
