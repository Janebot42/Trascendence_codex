import { securityConfig } from '../../config/security.js';
import type { PasswordHasher } from '../../shared/crypto/passwordHasher.js';
import { hashToken } from '../../shared/crypto/hashToken.js';
import { randomToken } from '../../shared/crypto/randomToken.js';
import { InMemoryRateLimiter } from '../../shared/http/rateLimit.js';
import { badRequest, unauthorized } from '../../shared/errors/httpErrors.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { TwoFactorService } from '../two_factor/twoFactor.service.js';
import type { UsersService } from '../users/users.service.js';
import type { AuthRepository } from './auth.repository.js';
import type { LoginResult } from './auth.types.js';

export class AuthService {
  private readonly passwordLimiter = new InMemoryRateLimiter(5, 15 * 60 * 1000);
  private readonly secondFactorLimiter = new InMemoryRateLimiter(5, 5 * 60 * 1000);

  constructor(
    private readonly usersService: UsersService,
    private readonly authRepository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessionsService: SessionsService,
    private readonly twoFactorService: TwoFactorService
  ) {}

  async register(input: {
    username: string;
    email?: string | null;
    password: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<LoginResult> {
    if (input.password.length < 12) throw badRequest('Password must be at least 12 characters');

    const user = await this.usersService.createUser({
      username: input.username,
      email: input.email ?? null
    });
    await this.authRepository.createPasswordCredential({
      userId: user.id,
      passwordHash: await this.passwordHasher.hash(input.password),
      passwordUpdatedAt: new Date()
    });

    const createdSession = await this.sessionsService.createSession({
      userId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });

    return {
      status: 'authenticated',
      user,
      sessionToken: createdSession.token,
      sessionExpiresAt: createdSession.session.expiresAt
    };
  }

  async login(input: {
    username: string;
    password: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<LoginResult> {
    this.passwordLimiter.assertAllowed(`${input.ipAddress ?? 'unknown'}:${input.username.toLowerCase()}`);

    const user = await this.usersService.findByUsername(input.username);
    if (!user || user.status !== 'active') throw unauthorized('Invalid credentials');

    const credential = await this.authRepository.findPasswordCredential(user.id);
    if (!credential || !(await this.passwordHasher.verify(credential.passwordHash, input.password))) {
      throw unauthorized('Invalid credentials');
    }

    return this.completeTrustedLogin({
      userId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });
  }

  async completeTrustedLogin(input: {
    userId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<LoginResult> {
    const user = await this.usersService.findById(input.userId);
    if (!user || user.status !== 'active') throw unauthorized();

    if (await this.twoFactorService.isEnabled(user.id)) {
      const challengeToken = randomToken(32);
      const challenge = await this.authRepository.createLoginChallenge({
        userId: user.id,
        tokenHash: hashToken(challengeToken),
        expiresAt: new Date(Date.now() + securityConfig.loginChallengeTtlMs),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null
      });
      return {
        status: 'requires_2fa',
        challengeToken,
        expiresAt: challenge.expiresAt
      };
    }

    const createdSession = await this.sessionsService.createSession({
      userId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });
    return {
      status: 'authenticated',
      user,
      sessionToken: createdSession.token,
      sessionExpiresAt: createdSession.session.expiresAt
    };
  }

  async completeTwoFactorLogin(input: {
    challengeToken: string;
    code: string;
    method: 'totp' | 'recovery_code';
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<LoginResult> {
    this.secondFactorLimiter.assertAllowed(`${input.ipAddress ?? 'unknown'}:${input.challengeToken}`);

    const challenge = await this.authRepository.findLoginChallengeByTokenHash(hashToken(input.challengeToken));
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) {
      throw unauthorized('Invalid or expired login challenge');
    }

    const ok =
      input.method === 'totp'
        ? await this.twoFactorService.verifyTotp(challenge.userId, input.code)
        : await this.twoFactorService.consumeRecoveryCode(challenge.userId, input.code);

    if (!ok) throw unauthorized('Invalid second factor');

    await this.authRepository.consumeLoginChallenge(challenge.id);
    const user = await this.usersService.findById(challenge.userId);
    if (!user || user.status !== 'active') throw unauthorized();

    const createdSession = await this.sessionsService.createSession({
      userId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });

    return {
      status: 'authenticated',
      user,
      sessionToken: createdSession.token,
      sessionExpiresAt: createdSession.session.expiresAt
    };
  }

  async reauthenticate(input: {
    userId: string;
    password: string;
    sessionId: string;
    secondFactorCode?: string;
    secondFactorMethod?: 'totp' | 'recovery_code';
  }): Promise<void> {
    const { userId, password, sessionId, secondFactorCode, secondFactorMethod } = input;
    const credential = await this.authRepository.findPasswordCredential(userId);
    if (!credential || !(await this.passwordHasher.verify(credential.passwordHash, password))) {
      throw unauthorized('Invalid credentials');
    }

    if (await this.twoFactorService.isEnabled(userId)) {
      if (!secondFactorCode || !secondFactorMethod) {
        throw unauthorized('Second factor required');
      }

      const secondFactorOk =
        secondFactorMethod === 'totp'
          ? await this.twoFactorService.verifyTotp(userId, secondFactorCode)
          : await this.twoFactorService.consumeRecoveryCode(userId, secondFactorCode);

      if (!secondFactorOk) throw unauthorized('Invalid second factor');
    }

    await this.sessionsService.markReauthenticated(sessionId);
  }

  async changePassword(userId: string, newPassword: string): Promise<void> {
    if (newPassword.length < 12) throw badRequest('Password must be at least 12 characters');
    await this.authRepository.updatePasswordCredential({
      userId,
      passwordHash: await this.passwordHasher.hash(newPassword),
      passwordUpdatedAt: new Date()
    });
  }
}
