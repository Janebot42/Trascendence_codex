import { randomToken } from '../../shared/crypto/randomToken.js';
import type { PasswordCredential } from './auth.types.js';

export type LoginChallenge = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export interface AuthRepository {
  createPasswordCredential(input: PasswordCredential): Promise<void>;
  findPasswordCredential(userId: string): Promise<PasswordCredential | null>;
  updatePasswordCredential(input: PasswordCredential): Promise<void>;
  createLoginChallenge(input: Omit<LoginChallenge, 'id' | 'createdAt' | 'consumedAt'>): Promise<LoginChallenge>;
  findLoginChallengeByTokenHash(tokenHash: string): Promise<LoginChallenge | null>;
  consumeLoginChallenge(id: string): Promise<void>;
}

export class InMemoryAuthRepository implements AuthRepository {
  private readonly credentials = new Map<string, PasswordCredential>();
  private readonly challenges = new Map<string, LoginChallenge>();

  async createPasswordCredential(input: PasswordCredential): Promise<void> {
    this.credentials.set(input.userId, input);
  }

  async findPasswordCredential(userId: string): Promise<PasswordCredential | null> {
    return this.credentials.get(userId) ?? null;
  }

  async updatePasswordCredential(input: PasswordCredential): Promise<void> {
    this.credentials.set(input.userId, input);
  }

  async createLoginChallenge(input: Omit<LoginChallenge, 'id' | 'createdAt' | 'consumedAt'>): Promise<LoginChallenge> {
    const challenge: LoginChallenge = {
      ...input,
      id: randomToken(16),
      createdAt: new Date(),
      consumedAt: null
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  async findLoginChallengeByTokenHash(tokenHash: string): Promise<LoginChallenge | null> {
    return [...this.challenges.values()].find((challenge) => challenge.tokenHash === tokenHash) ?? null;
  }

  async consumeLoginChallenge(id: string): Promise<void> {
    const challenge = this.challenges.get(id);
    if (challenge && !challenge.consumedAt) challenge.consumedAt = new Date();
  }
}

