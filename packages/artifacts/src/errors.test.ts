import { orbitErrorSchema } from '@orbit/contracts';
import { describe, expect, it } from 'vitest';

import {
  ArtifactAlreadyExistsError,
  ArtifactIntegrityError,
  ArtifactNotFoundError,
  ArtifactReadError,
  ArtifactStorageError,
  ArtifactWriteError,
  filesystemErrorCode,
  InvalidStorageKeyError,
  isArtifactStorageError,
  StorageRootError,
  toOrbitError,
} from './errors';

const ERROR_CLASSES = [
  InvalidStorageKeyError,
  StorageRootError,
  ArtifactAlreadyExistsError,
  ArtifactNotFoundError,
  ArtifactWriteError,
  ArtifactReadError,
  ArtifactIntegrityError,
] as const;

describe('artifact storage error taxonomy', () => {
  it.each(ERROR_CLASSES)('%s extends ArtifactStorageError', (ErrorClass) => {
    expect(new ErrorClass('boom')).toBeInstanceOf(ArtifactStorageError);
  });

  it.each(ERROR_CLASSES)('%s reports the ARTIFACT_STORAGE_ERROR code', (ErrorClass) => {
    expect(new ErrorClass('boom').code).toBe('ARTIFACT_STORAGE_ERROR');
  });

  it.each(ERROR_CLASSES)('%s reports its own class name', (ErrorClass) => {
    expect(new ErrorClass('boom').name).toBe(ErrorClass.name);
  });

  it('InvalidStorageKeyError reports its concrete name', () => {
    expect(new InvalidStorageKeyError('x').name).toBe('InvalidStorageKeyError');
  });

  it.each(ERROR_CLASSES)('toOrbitError(%s) satisfies orbitErrorSchema', (ErrorClass) => {
    const error = new ErrorClass('something went wrong');

    expect(() => orbitErrorSchema.parse(toOrbitError(error))).not.toThrow();
  });

  it.each(ERROR_CLASSES)('isArtifactStorageError is true for %s', (ErrorClass) => {
    expect(isArtifactStorageError(new ErrorClass('boom'))).toBe(true);
  });

  it('isArtifactStorageError is false for a plain Error', () => {
    expect(isArtifactStorageError(new Error('boom'))).toBe(false);
  });

  it('isArtifactStorageError is false for non-error values', () => {
    expect(isArtifactStorageError('boom')).toBe(false);
    expect(isArtifactStorageError(undefined)).toBe(false);
  });
});

describe('filesystemErrorCode', () => {
  it('extracts a string code from a Node-style filesystem error', () => {
    const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

    expect(filesystemErrorCode(error)).toBe('ENOENT');
  });

  it('returns undefined for a plain Error with no code', () => {
    expect(filesystemErrorCode(new Error('boom'))).toBeUndefined();
  });

  it('returns undefined when code is not a string', () => {
    expect(filesystemErrorCode({ code: 42 })).toBeUndefined();
  });

  it('returns undefined for non-object values', () => {
    expect(filesystemErrorCode('boom')).toBeUndefined();
    expect(filesystemErrorCode(undefined)).toBeUndefined();
    expect(filesystemErrorCode(null)).toBeUndefined();
  });
});
