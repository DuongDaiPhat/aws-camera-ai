jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}), { virtual: true });

import { Argon2PasswordHasher } from '../src/auth/argon2-password-hasher';
import * as argon2 from 'argon2';

describe('Argon2PasswordHasher', () => {
  it('goi argon2.verify voi dung tham so', async () => {
    (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
    const hasher = new Argon2PasswordHasher();
    const result = await hasher.verify('$argon2id$mockhash', 'plainText');
    expect(result).toBe(true);
    expect(argon2.verify).toHaveBeenCalledWith('$argon2id$mockhash', 'plainText');
  });
});
