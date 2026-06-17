import { type PrismaClient } from '@prisma/client';
import {
  mapOAuthAccount,
  mapOAuthState,
  toPrismaOAuthProvider,
  toPrismaOAuthStatePurpose
} from '../../db/prismaMappers.js';
import { randomToken } from '../../shared/crypto/randomToken.js';
import type { OAuthRepository } from './oauth.repository.js';
import type { OAuthAccountRecord, OAuthProvider, OAuthStateRecord } from './oauth.types.js';

export class PrismaOAuthRepository implements OAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createState(input: Omit<OAuthStateRecord, 'id' | 'createdAt' | 'consumedAt'>): Promise<OAuthStateRecord> {
    const state = await this.prisma.oAuthState.create({
      data: {
        id: randomToken(16),
        provider: toPrismaOAuthProvider(input.provider),
        purpose: toPrismaOAuthStatePurpose(input.purpose),
        initiatingUserId: input.initiatingUserId,
        stateTokenHash: input.stateTokenHash,
        redirectTo: input.redirectTo,
        expiresAt: input.expiresAt
      }
    });
    return mapOAuthState(state);
  }

  async consumeStateByTokenHash(tokenHash: string): Promise<OAuthStateRecord | null> {
    const state = await this.prisma.oAuthState.findUnique({ where: { stateTokenHash: tokenHash } });
    if (!state || state.consumedAt) return null;

    const consumed = await this.prisma.oAuthState.update({
      where: { id: state.id },
      data: { consumedAt: new Date() }
    });
    return mapOAuthState(consumed);
  }

  async findAccountByProviderUserId(provider: OAuthProvider, providerUserId: string): Promise<OAuthAccountRecord | null> {
    const account = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerUserId: { provider: toPrismaOAuthProvider(provider), providerUserId } }
    });
    return account ? mapOAuthAccount(account) : null;
  }

  async findAccountByUserIdAndProvider(userId: string, provider: OAuthProvider): Promise<OAuthAccountRecord | null> {
    const account = await this.prisma.oAuthAccount.findFirst({
      where: { userId, provider: toPrismaOAuthProvider(provider) }
    });
    return account ? mapOAuthAccount(account) : null;
  }

  async countAccountsForUser(userId: string): Promise<number> {
    return this.prisma.oAuthAccount.count({ where: { userId } });
  }

  async createAccount(input: Omit<OAuthAccountRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<OAuthAccountRecord> {
    const account = await this.prisma.oAuthAccount.create({
      data: {
        id: randomToken(16),
        userId: input.userId,
        provider: toPrismaOAuthProvider(input.provider),
        providerUserId: input.providerUserId,
        providerLogin: input.providerLogin,
        providerEmail: input.providerEmail
      }
    });
    return mapOAuthAccount(account);
  }

  async deleteAccount(id: string): Promise<void> {
    await this.prisma.oAuthAccount.delete({ where: { id } });
  }
}
