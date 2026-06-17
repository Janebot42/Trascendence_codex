import { badRequest, unauthorized } from '../../shared/errors/httpErrors.js';
import type { UsersService } from '../users/users.service.js';
import type { RecoveryCodesService } from './recoveryCodes.service.js';
import type { TotpService } from './totp.service.js';
import type { TwoFactorRepository } from './twoFactor.repository.js';
import type { TotpSetup } from './twoFactor.types.js';

export class TwoFactorService {
  constructor(
    private readonly twoFactorRepository: TwoFactorRepository,
    private readonly usersService: UsersService,
    private readonly totpService: TotpService,
    private readonly recoveryCodesService: RecoveryCodesService
  ) {}

  async isEnabled(userId: string): Promise<boolean> {
    const record = await this.twoFactorRepository.findTotpByUserId(userId);
    return Boolean(record?.enabledAt);
  }

  async beginTotpSetup(userId: string): Promise<TotpSetup> {
    const user = await this.usersService.findById(userId);
    if (!user) throw unauthorized();
    if (await this.isEnabled(userId)) throw badRequest('Two-factor authentication is already enabled');

    const secret = this.totpService.generateSecret();
    await this.twoFactorRepository.upsertPendingTotp(userId, this.totpService.encryptSecret(secret));

    return {
      provisioningUri: this.totpService.provisioningUri(user.username, secret)
    };
  }

  async confirmTotpSetup(userId: string, code: string): Promise<string[]> {
    const record = await this.twoFactorRepository.findTotpByUserId(userId);
    if (!record || record.enabledAt) throw badRequest('No pending TOTP setup');

    const secret = this.totpService.decryptSecret(record.secretEncrypted);
    if (!this.totpService.verify(code, secret)) throw unauthorized('Invalid TOTP code');

    await this.twoFactorRepository.enableTotp(userId);
    return this.recoveryCodesService.generateForUser(userId);
  }

  async verifyTotp(userId: string, code: string): Promise<boolean> {
    const record = await this.twoFactorRepository.findTotpByUserId(userId);
    if (!record?.enabledAt) return false;
    return this.totpService.verify(code, this.totpService.decryptSecret(record.secretEncrypted));
  }

  consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    return this.recoveryCodesService.consume(userId, code);
  }

  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    if (!(await this.isEnabled(userId))) throw badRequest('Two-factor authentication is not enabled');
    return this.recoveryCodesService.generateForUser(userId);
  }

  disableTwoFactor(userId: string): Promise<void> {
    return this.twoFactorRepository.disableTotp(userId);
  }
}
