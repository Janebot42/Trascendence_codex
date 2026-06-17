import { randomToken } from '../../shared/crypto/randomToken.js';
import type { Session } from './sessions.types.js';

export interface SessionsRepository {
  create(input: Omit<Session, 'id' | 'createdAt' | 'lastSeenAt' | 'revokedAt'>): Promise<Session>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  revokeByTokenHash(tokenHash: string): Promise<void>;
  revokeOtherUserSessions(userId: string, keepSessionId: string): Promise<void>;
  markReauthenticated(sessionId: string): Promise<void>;
}

export class InMemorySessionsRepository implements SessionsRepository {
  private readonly sessions = new Map<string, Session>();

  async create(input: Omit<Session, 'id' | 'createdAt' | 'lastSeenAt' | 'revokedAt'>): Promise<Session> {
    const now = new Date();
    const session: Session = {
      ...input,
      id: randomToken(16),
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    return [...this.sessions.values()].find((session) => session.tokenHash === tokenHash) ?? null;
  }

  async revokeByTokenHash(tokenHash: string): Promise<void> {
    const session = await this.findByTokenHash(tokenHash);
    if (session && !session.revokedAt) session.revokedAt = new Date();
  }

  async revokeOtherUserSessions(userId: string, keepSessionId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.id !== keepSessionId && !session.revokedAt) {
        session.revokedAt = new Date();
      }
    }
  }

  async markReauthenticated(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) session.reauthenticatedAt = new Date();
  }
}

