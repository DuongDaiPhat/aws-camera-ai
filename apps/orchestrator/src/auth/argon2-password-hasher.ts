import { Injectable } from '@nestjs/common';
import { verify } from 'argon2';
import type { PasswordHasher } from './auth.types';

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  verify(hash: string, plainText: string): Promise<boolean> {
    return verify(hash, plainText);
  }
}
