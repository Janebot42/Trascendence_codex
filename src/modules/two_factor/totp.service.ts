import { authenticator } from 'otplib';
import { securityConfig } from '../../config/security.js';
import { SecretBox } from '../../shared/crypto/encryption.js';

export class TotpService {
  constructor(private readonly secretBox: SecretBox) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  encryptSecret(secret: string): string {
    return this.secretBox.encrypt(secret);
  }

  decryptSecret(secretEncrypted: string): string {
    return this.secretBox.decrypt(secretEncrypted);
  }

  provisioningUri(username: string, secret: string): string {
    return authenticator.keyuri(username, securityConfig.totpIssuer, secret);
  }

  verify(code: string, secret: string): boolean {
    return authenticator.check(code, secret);
  }
}

