import { type PrismaClient } from '@prisma/client';
import { mapRecoveryCode, mapTotpRecord } from '../../db/prismaMappers.js';
import { randomToken } from '../../shared/crypto/randomToken.js';
import type { TwoFactorRepository } from './twoFactor.repository.js';
import type { RecoveryCodeRecord, TotpRecord } from './twoFactor.types.js';

export class PrismaTwoFactorRepository implements TwoFactorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertPendingTotp(userId: string, secretEncrypted: string): Promise<TotpRecord> {
    const record = await this.prisma.twoFactorTotp.upsert({
      where: { userId },
      create: {
        id: randomToken(16),
        userId,
        secretEncrypted,
        enabledAt: null,
        confirmedAt: null
      },
      update: {
        secretEncrypted,
        enabledAt: null,
        confirmedAt: null
      }
    });
    return mapTotpRecord(record);
  }

  async findTotpByUserId(userId: string): Promise<TotpRecord | null> {
    const record = await this.prisma.twoFactorTotp.findUnique({ where: { userId } });
    return record ? mapTotpRecord(record) : null;
  }

  async enableTotp(userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.twoFactorTotp.update({ where: { userId }, data: { enabledAt: now, confirmedAt: now } });
  }

  async disableTotp(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.twoFactorTotp.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.updateMany({
        where: { userId, replacedAt: null },
        data: { replacedAt: new Date() }
      })
    ]);
  }

  async replaceRecoveryCodes(userId: string, codeHashes: string[]): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.recoveryCode.updateMany({
        where: { userId, replacedAt: null },
        data: { replacedAt: now }
      }),
      ...codeHashes.map((codeHash) =>
        this.prisma.recoveryCode.create({
          data: {
            id: randomToken(16),
            userId,
            codeHash
          }
        })
      )
    ]);
  }

  async listActiveRecoveryCodes(userId: string): Promise<RecoveryCodeRecord[]> {
    const codes = await this.prisma.recoveryCode.findMany({ where: { userId, usedAt: null, replacedAt: null } });
    return codes.map(mapRecoveryCode);
  }

  async markRecoveryCodeUsed(id: string): Promise<void> {
    const code = await this.prisma.recoveryCode.findUnique({ where: { id } });
    if (!code?.usedAt) {
      await this.prisma.recoveryCode.update({ where: { id }, data: { usedAt: new Date() } });
    }
  }
}
