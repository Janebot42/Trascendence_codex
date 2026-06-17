import { type PrismaClient } from '@prisma/client';
import { mapSession } from '../../db/prismaMappers.js';
import { randomToken } from '../../shared/crypto/randomToken.js';
import type { SessionsRepository } from './sessions.repository.js';
import type { Session } from './sessions.types.js';

export class PrismaSessionsRepository implements SessionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: Omit<Session, 'id' | 'createdAt' | 'lastSeenAt' | 'revokedAt'>): Promise<Session> {
    const session = await this.prisma.session.create({
      data: {
        id: randomToken(16),
        userId: input.userId,
        sessionTokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        reauthenticatedAt: input.reauthenticatedAt
      }
    });
    return mapSession(session);
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const session = await this.prisma.session.findUnique({ where: { sessionTokenHash: tokenHash } });
    return session ? mapSession(session) : null;
  }

  async revokeByTokenHash(tokenHash: string): Promise<void> {
    const session = await this.findByTokenHash(tokenHash);
    if (!session?.revokedAt) {
      await this.prisma.session.update({ where: { sessionTokenHash: tokenHash }, data: { revokedAt: new Date() } });
    }
  }

  async revokeOtherUserSessions(userId: string, keepSessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, id: { not: keepSessionId }, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  async markReauthenticated(sessionId: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { reauthenticatedAt: new Date() } });
  }
}
