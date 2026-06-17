import type { User } from '../users/users.types.js';

export type Session = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
  reauthenticatedAt: Date | null;
};

export type CreatedSession = {
  session: Session;
  token: string;
};

export type SessionWithUser = {
  session: Session;
  user: User;
};

