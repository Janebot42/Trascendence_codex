import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const keyLength = 64;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = (await scrypt(password, salt, keyLength)) as Buffer;
    return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    const [scheme, saltRaw, keyRaw] = storedHash.split('$');
    if (scheme !== 'scrypt' || !saltRaw || !keyRaw) return false;

    const salt = Buffer.from(saltRaw, 'base64url');
    const expectedKey = Buffer.from(keyRaw, 'base64url');
    const actualKey = (await scrypt(password, salt, expectedKey.length)) as Buffer;

    return expectedKey.length === actualKey.length && timingSafeEqual(expectedKey, actualKey);
  }
}
