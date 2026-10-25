import { shuffleOptions } from './assessment-utils';

describe('shuffleOptions', () => {
  it('keeps the same options and does not mutate the input', () => {
    const input = ['a', 'b', 'c', 'd'];
    const result = shuffleOptions(input);
    expect(result).not.toBe(input);
    expect([...(result ?? [])].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(input).toEqual(['a', 'b', 'c', 'd']);
  });

  it('produces more than one ordering across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      seen.add((shuffleOptions(['a', 'b', 'c', 'd']) ?? []).join());
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('returns null for missing options', () => {
    expect(shuffleOptions(null)).toBeNull();
    expect(shuffleOptions(undefined)).toBeNull();
  });
});
