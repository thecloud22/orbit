import { describe, expect, it } from 'vitest';

import { MAX_SOURCE_CHARACTERS, REDACTED_MARKER, redactForModel, truncateForModel } from './redact';

/**
 * What redaction does, and — as important — what it does not claim.
 *
 * These tests pin a reduction in risk, not a guarantee. The last block says so
 * out loud, because a test suite that only demonstrated successes would read as
 * a promise this pass cannot keep.
 */

describe('shapes that must never reach a model or an artifact', () => {
  it('removes a bearer token', () => {
    const { text, removed } = redactForModel('Authorization: Bearer abcdefghijklmnop123456');
    expect(text).not.toContain('abcdefghijklmnop');
    expect(text).toContain(REDACTED_MARKER);
    expect(removed).toContain('bearer token');
  });

  it('removes an API key', () => {
    const { text } = redactForModel('key is sk_live_abcdefghijklmnopqrst');
    expect(text).not.toContain('abcdefghijklmnopqrst');
  });

  it('removes an AWS access key id', () => {
    const { text } = redactForModel('AKIAIOSFODNN7EXAMPLE is the key');
    expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('removes a JWT', () => {
    const { text } = redactForModel(
      'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    );
    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('removes an email address', () => {
    const { text } = redactForModel('Assigned to alice.smith@example.com today');
    expect(text).not.toContain('alice.smith@example.com');
  });

  it('removes something shaped like a card number', () => {
    const { text } = redactForModel('Card 4111 1111 1111 1111 on file');
    expect(text).not.toContain('4111');
  });

  it('removes a private key block whole, not line by line', () => {
    const { text } = redactForModel(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nAAAA\n-----END RSA PRIVATE KEY-----',
    );
    expect(text).not.toContain('MIIEow');
  });

  it('applies every rule that matches, not just the first', () => {
    const { removed } = redactForModel('mail bob@example.com and use Bearer abcdefghijklmnop1234');
    expect(removed).toContain('email address');
    expect(removed).toContain('bearer token');
  });

  it('reports which rules fired without ever reporting what they removed', () => {
    const { removed } = redactForModel('bob@example.com');
    expect(removed).toEqual(['email address']);
    expect(removed.join(' ')).not.toContain('bob');
  });
});

describe('ordinary page text is left alone', () => {
  it('passes through the text a judged decision actually exists to read', () => {
    const status = 'Available — 2 copies on the shelf at Central Branch';
    expect(redactForModel(status).text).toBe(status);
  });

  it('reports no redactions when none applied', () => {
    expect(redactForModel('In Progress').removed).toEqual([]);
  });
});

describe('truncation', () => {
  it('caps how much page text one decision can send', () => {
    const long = 'a'.repeat(MAX_SOURCE_CHARACTERS + 500);
    const truncated = truncateForModel(long);

    expect(truncated.length).toBeLessThan(long.length);
    // Marked rather than silent: a person reading the evidence can see it was cut.
    expect(truncated).toContain('[truncated]');
  });

  it('leaves text within the cap untouched', () => {
    expect(truncateForModel('short')).toBe('short');
  });
});

describe('what this pass does not claim', () => {
  it('cannot recognise a secret that looks like prose', () => {
    // Stated as a test so the limitation is visible in the suite rather than
    // only in the ADR. The containment that does the real work is that a judged
    // decision reads only the regions its Agent Version declares.
    const prose = 'The door code is four seven two nine.';
    expect(redactForModel(prose).text).toBe(prose);
  });

  it('may redact a harmless string that merely looks like a key', () => {
    const harmless = 'Order reference 4532015112830366 shipped';
    expect(redactForModel(harmless).text).toContain(REDACTED_MARKER);
  });
});
