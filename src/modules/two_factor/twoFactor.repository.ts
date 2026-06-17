import { randomToken } from '../../shared/crypto/randomToken.js';
import type { RecoveryCodeRecord, TotpRecord } from './twoFactor.types.js';

export interface TwoFactorRepository {
  upsertPendingTotp(userId: string, secretEncrypted: string): Promise<TotpRecord>;
  findTotpByUserId(userId: string): Promise<TotpRecord | null>;
  enableTotp(userId: string): Promise<void>;
  disableTotp(userId: string): Promise<void>;
  replaceRecoveryCodes(userId: string, codeHashes: string[]): Promise<void>;
  listActiveRecoveryCodes(userId: string): Promise<RecoveryCodeRecord[]>;
  markRecoveryCodeUsed(id: string): Promise<void>;
}

export class InMemoryTwoFactorRepository implements TwoFactorRepository {
  private readonly totpRecords = new Map<string, TotpRecord>();
  private readonly recoveryCodes = new Map<string, RecoveryCodeRecord>();

  async upsertPendingTotp(userId: string, secretEncrypted: string): Promise<TotpRecord> {
    const now = new Date();
    const current = this.totpRecords.get(userId);
    const record: TotpRecord = {
      id: current?.id ?? randomToken(16),
      userId,
      secretEncrypted,
      enabledAt: null,
      confirmedAt: null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    this.totpRecords.set(userId, record);
    return record;
  }

  async findTotpByUserId(userId: string): Promise<TotpRecord | null> {
    return this.totpRecords.get(userId) ?? null;
  }

  async enableTotp(userId: string): Promise<void> {
    const record = this.totpRecords.get(userId);
    if (!record) return;
    const now = new Date();
    record.enabledAt = now;
    record.confirmedAt = now;
    record.updatedAt = now;
  }

  async disableTotp(userId: string): Promise<void> {
    this.totpRecords.delete(userId);
    const now = new Date();
    for (const code of this.recoveryCodes.values()) {
      if (code.userId === userId && !code.replacedAt) code.replacedAt = now;
    }
  }

  async replaceRecoveryCodes(userId: string, codeHashes: string[]): Promise<void> {
    const now = new Date();
    for (const code of this.recoveryCodes.values()) {
      if (code.userId === userId && !code.replacedAt) code.replacedAt = now;
    }
    for (const codeHash of codeHashes) {
      const id = randomToken(16);
      this.recoveryCodes.set(id, {
        id,
        userId,
        codeHash,
        createdAt: now,
        usedAt: null,
        replacedAt: null
      });
    }
  }

  async listActiveRecoveryCodes(userId: string): Promise<RecoveryCodeRecord[]> {
    return [...this.recoveryCodes.values()].filter(
      (code) => code.userId === userId && !code.usedAt && !code.replacedAt
    );
  }

  async markRecoveryCodeUsed(id: string): Promise<void> {
    const code = this.recoveryCodes.get(id);
    if (code && !code.usedAt) code.usedAt = new Date();
  }
}

