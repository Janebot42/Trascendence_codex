import { type PrismaClient } from '@prisma/client';
import { mapLoginChallenge, mapPasswordCredential } from '../../db/prismaMappers.js';
import { randomToken } from '../../shared/crypto/randomToken.js';
import type { AuthRepository, LoginChallenge } from './auth.repository.js';
import type { PasswordCredential } from './auth.types.js';

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPasswordCredential(input: PasswordCredential): Promise<void> {
    await this.prisma.passwordCredential.create({
      data: {
        userId: input.userId,
        passwordHash: input.passwordHash,
        passwordUpdatedAt: input.passwordUpdatedAt
      }
    });
  }

  async findPasswordCredential(userId: string): Promise<PasswordCredential | null> {
    const credential = await this.prisma.passwordCredential.findUnique({ where: { userId } });
    return credential ? mapPasswordCredential(credential) : null;
  }

  async updatePasswordCredential(input: PasswordCredential): Promise<void> {
    await this.prisma.passwordCredential.update({
      where: { userId: input.userId },
      data: {
        passwordHash: input.passwordHash,
        passwordUpdatedAt: input.passwordUpdatedAt
      }
    });
  }

  async createLoginChallenge(input: Omit<LoginChallenge, 'id' | 'createdAt' | 'consumedAt'>): Promise<LoginChallenge> {
    const challenge = await this.prisma.loginChallenge.create({
      data: {
        id: randomToken(16),
        userId: input.userId,
        challengeTokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent
      }
    });
    return mapLoginChallenge(challenge);
  }

  async findLoginChallengeByTokenHash(tokenHash: string): Promise<LoginChallenge | null> {
    const challenge = await this.prisma.loginChallenge.findUnique({ where: { challengeTokenHash: tokenHash } });
    return challenge ? mapLoginChallenge(challenge) : null;
  }

  async consumeLoginChallenge(id: string): Promise<void> {
    await this.prisma.loginChallenge.update({ where: { id }, data: { consumedAt: new Date() } });
  }
}
