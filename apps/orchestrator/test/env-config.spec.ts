import { ConfigService } from '@nestjs/config';
import { readNonEmptyConfigString, readPositiveConfigNumber } from '../src/config/env-config';

describe('env-config helpers', () => {
  it('falls back on undefined, blank, non-numeric, or non-positive numbers', () => {
    const config = new ConfigService({
      EMPTY: '',
      BLANK: '   ',
      ZERO: '0',
      NEGATIVE: '-10',
      BAD: 'not-a-number',
      VALID: '524288000',
    });

    expect(readPositiveConfigNumber(config, 'MISSING', 100)).toBe(100);
    expect(readPositiveConfigNumber(config, 'EMPTY', 100)).toBe(100);
    expect(readPositiveConfigNumber(config, 'BLANK', 100)).toBe(100);
    expect(readPositiveConfigNumber(config, 'ZERO', 100)).toBe(100);
    expect(readPositiveConfigNumber(config, 'NEGATIVE', 100)).toBe(100);
    expect(readPositiveConfigNumber(config, 'BAD', 100)).toBe(100);
    expect(readPositiveConfigNumber(config, 'VALID', 100)).toBe(524288000);
  });

  it('falls back on undefined or whitespace-only strings', () => {
    const config = new ConfigService({
      EMPTY: '',
      BLANK: '   ',
      VALID: '  frigate/camerai/frames  ',
    });

    expect(readNonEmptyConfigString(config, 'MISSING', 'default')).toBe('default');
    expect(readNonEmptyConfigString(config, 'EMPTY', 'default')).toBe('default');
    expect(readNonEmptyConfigString(config, 'BLANK', 'default')).toBe('default');
    expect(readNonEmptyConfigString(config, 'VALID', 'default')).toBe('frigate/camerai/frames');
  });
});
