import { describe, expect, it } from 'vitest';

import { canonicalJson, sha256Of } from './checksum';

describe('canonical json', () => {
  it('orders keys so that key order alone never changes a checksum', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(sha256Of({ b: 1, a: 2 })).toBe(sha256Of({ a: 2, b: 1 }));
  });

  it('orders keys at every depth', () => {
    expect(canonicalJson({ outer: { z: 1, a: { y: 2, b: 3 } } })).toBe(
      '{"outer":{"a":{"b":3,"y":2},"z":1}}',
    );
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson({ steps: ['b', 'a'] })).toBe('{"steps":["b","a"]}');
    expect(sha256Of(['a', 'b'])).not.toBe(sha256Of(['b', 'a']));
  });

  it('produces a lowercase hex digest', () => {
    expect(sha256Of({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });

  it('detects any change to the document', () => {
    expect(sha256Of({ version: '0.1.0' })).not.toBe(sha256Of({ version: '0.1.1' }));
  });
});
