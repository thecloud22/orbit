import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_KIND_CONTENT_TYPES,
  ARTIFACT_KIND_EXTENSIONS,
  ARTIFACT_KINDS,
  defaultContentTypeForKind,
  extensionForKind,
} from './content-types';

describe('artifact kind content types', () => {
  it('has a content type for every artifact kind', () => {
    for (const kind of ARTIFACT_KINDS) {
      expect(ARTIFACT_KIND_CONTENT_TYPES[kind]).toEqual(expect.any(String));
    }
  });

  it('has an extension for every artifact kind', () => {
    for (const kind of ARTIFACT_KINDS) {
      expect(ARTIFACT_KIND_EXTENSIONS[kind]).toEqual(expect.any(String));
    }
  });

  it('defaultContentTypeForKind returns the mapped content type', () => {
    for (const kind of ARTIFACT_KINDS) {
      expect(defaultContentTypeForKind(kind)).toBe(ARTIFACT_KIND_CONTENT_TYPES[kind]);
    }
  });

  it('extensionForKind returns the mapped extension', () => {
    for (const kind of ARTIFACT_KINDS) {
      expect(extensionForKind(kind)).toBe(ARTIFACT_KIND_EXTENSIONS[kind]);
    }
  });

  it('every extension is lowercase alphanumeric and valid inside the key grammar', () => {
    for (const kind of ARTIFACT_KINDS) {
      // Matches the storage-key grammar's own final-segment extension pattern:
      // /\.[a-z0-9]{1,16}$/.
      expect(ARTIFACT_KIND_EXTENSIONS[kind]).toMatch(/^[a-z0-9]{1,16}$/);
    }
  });
});
