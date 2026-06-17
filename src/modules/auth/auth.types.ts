import type { User } from '../users/users.types.js';

export type PasswordCredential = {
  userId: string;
  passwordHash: string;
  passwordUpdatedAt: Date;
};

export type LoginResult =
  | {
      status: 'authenticated';
      user: User;
      sessionToken: string;
      sessionExpiresAt: Date;
    }
  | {
      status: 'requires_2fa';
      challengeToken: string;
      expiresAt: Date;
    };

