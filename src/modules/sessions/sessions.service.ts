import { securityConfig } from '../../config/security.js';
import { hashToken } from '../../shared/crypto/hashToken.js';
import { randomToken } from '../../shared/crypto/randomToken.js';
import type { UsersService } from '../users/users.service.js';
import type { CreatedSession, SessionWithUser } from './sessions.types.js';
import type { SessionsRepository } from './sessions.repository.js';

export class SessionsService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly usersService: UsersService
  ) {}

  async createSession(input: {
    userId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<CreatedSession> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + securityConfig.sessionTtlMs);
    const session = await this.sessionsRepository.create({
      userId: input.userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      reauthenticatedAt: null
    });
    return { session, token };
  }

  async getSessionFromToken(token: string): Promise<SessionWithUser | null> {
    const session = await this.sessionsRepository.findByTokenHash(hashToken(token));
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

    const user = await this.usersService.findById(session.userId);
    if (!user || user.status !== 'active') return null;

    return { session, user };
  }

  revokeSession(token: string): Promise<void> {
    return this.sessionsRepository.revokeByTokenHash(hashToken(token));
  }

  revokeOtherUserSessions(userId: string, keepSessionId: string): Promise<void> {
    return this.sessionsRepository.revokeOtherUserSessions(userId, keepSessionId);
  }

  markReauthenticated(sessionId: string): Promise<void> {
    return this.sessionsRepository.markReauthenticated(sessionId);
  }
}

