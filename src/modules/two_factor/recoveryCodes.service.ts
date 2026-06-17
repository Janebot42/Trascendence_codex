import { timingSafeEqual } from 'node:crypto';
import { hashToken } from '../../shared/crypto/hashToken.js';
import { randomToken } from '../../shared/crypto/randomToken.js';
import type { TwoFactorRepository } from './twoFactor.repository.js';

export class RecoveryCodesService {
  constructor(private readonly twoFactorRepository: TwoFactorRepository) {}

  async generateForUser(userId: string): Promise<string[]> {
    const codes = Array.from({ length: 10 }, () => randomToken(9));
    await this.twoFactorRepository.replaceRecoveryCodes(userId, codes.map(hashToken));
    return codes;
  }

  async consume(userId: string, code: string): Promise<boolean> {
    const codeHash = hashToken(code.trim());
    const activeCodes = await this.twoFactorRepository.listActiveRecoveryCodes(userId);
    for (const record of activeCodes) {
      const left = Buffer.from(record.codeHash);
      const right = Buffer.from(codeHash);
      if (left.length === right.length && timingSafeEqual(left, right)) {
        await this.twoFactorRepository.markRecoveryCodeUsed(record.id);
        return true;
      }
    }
    return false;
  }
}

