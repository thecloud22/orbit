import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { fingerprintOf, resolveAddress } from '@orbit/screen-mapping';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attributesFrom } from './screen-parser';
import { createX3270ExecutorFactory, renderScreen } from './x3270-executor';

/**
 * Driven against the real `b3270`, not a double.
 *
 * The host on the other end is the byte emitter from TASK-P3-000: it encodes one
 * 3270 data stream and interprets nothing. That asymmetry is the point. If Orbit
 * and the emitter were both Orbit's code, a misreading of the data stream would
 * leave them agreeing with each other and both wrong, and the suite would be
 * green either way. Here the decoding is done by the reference implementation,
 * so what is being checked is Orbit's understanding against x3270's.
 *
 * Skipped when `b3270` is not installed, rather than failed: it is a real
 * dependency of this surface and a machine without it should say so once, not
 * fail a suite it was never going to be able to run.
 */
const HAS_B3270 = spawnSync('b3270', ['--version'], { stdio: 'ignore' }).status !== null;
const HOST = fileURLToPath(new URL('./testing/fake-host.py', import.meta.url));

describe.skipIf(!HAS_B3270)('x3270 executor against a real emulator', () => {
  let host: ChildProcess | undefined;

  beforeAll(async () => {
    host = spawn('python3', [HOST], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 700));
  });

  afterAll(() => {
    host?.kill();
  });

  it('reads the host screen as fields with their attributes', async () => {
    const executor = await createX3270ExecutorFactory({ model: '3279-2' }).open();

    try {
      await executor.connect({ host: '127.0.0.1:3271', timeoutMs: 5_000 });
      const screen = await executor.screen();

      // The caption and its input are separate fields, and the input is the one
      // that is not protected.
      const label = resolveAddress(screen, { strategy: 'field_after_label', label: 'USERID' });
      expect(label.resolved).toBe(true);
      expect(label.resolved && label.field.attributes.protected).toBe(false);

      // The property the whole surface leans on: the host declares that the
      // password field is not to be displayed. Orbit does not infer it.
      const password = resolveAddress(screen, {
        strategy: 'field_after_label',
        label: 'PASSWORD',
      });
      expect(password.resolved && password.field.attributes.nonDisplay).toBe(true);

      expect(fingerprintOf(screen).anchors.map((one) => one.text)).toContain('ORBIT TEST HOST');
    } finally {
      await executor.close();
    }
  });

  it('types into a field and leaves the credential out of the evidence', async () => {
    const executor = await createX3270ExecutorFactory({ model: '3279-2' }).open();

    try {
      await executor.connect({ host: '127.0.0.1:3271', timeoutMs: 5_000 });
      const screen = await executor.screen();
      const password = resolveAddress(screen, {
        strategy: 'field_after_label',
        label: 'PASSWORD',
      });

      if (!password.resolved) throw new Error('the fixture screen has a password field');

      await executor.typeAt({
        position: password.field.start,
        value: 'SECRET99',
        timeoutMs: 5_000,
      });

      const evidence = await executor.finishEvidence();
      const text = evidence.map((one) => new TextDecoder().decode(one.bytes)).join('');
      expect(text).not.toContain('SECRET99');
    } finally {
      await executor.close();
    }
  });
});

describe('field attribute decoding', () => {
  it('reads the 3270 attribute bits the emulator reports', () => {
    // The values observed from a real b3270 session in TASK-P3-000.
    expect(attributesFrom(0xe0)).toMatchObject({ protected: true, nonDisplay: false });
    expect(attributesFrom(0xc0)).toMatchObject({ protected: false, nonDisplay: false });
    expect(attributesFrom(0xcc)).toMatchObject({ protected: false, nonDisplay: true });
    expect(attributesFrom(0xf8)).toMatchObject({ protected: true, intensified: true });
  });
});

describe('screen rendering', () => {
  it('masks a non-display field from its attribute', () => {
    const text = renderScreen({
      rows: 24,
      columns: 80,
      cursor: null,
      fields: [
        {
          start: { row: 5, column: 18 },
          length: 8,
          text: 'SECRET99',
          attributes: { protected: false, numeric: false, nonDisplay: true, intensified: false },
        },
      ],
    });

    expect(text).not.toContain('SECRET99');
    expect(text).toContain('[redacted]');
  });
});
