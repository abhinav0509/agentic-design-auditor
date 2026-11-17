import { describe, expect, it } from 'vitest';
import { DomainError, ERROR_CODES } from './errors.ts';
import { blobRef, parseBlobRef } from './blob.ts';
import { catchError } from './test-helpers.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('blob refs', () => {
  it('FR-29: a ref is content-addressed, so storing the same crop twice gives one ref', () => {
    const ref = blobRef(PNG, 'image/png');

    expect(ref).toMatch(/^blob:\/\/sha256\/[0-9a-f]{64}\.png$/);
    expect(blobRef(new Uint8Array(PNG), 'image/png')).toBe(ref);
    expect(blobRef(new Uint8Array([9]), 'image/png')).not.toBe(ref);
  });

  it('FR-29: a ref parses back to its storage key', () => {
    const ref = blobRef(PNG, 'image/png');

    expect(parseBlobRef(ref)).toBe(ref.slice('blob://'.length));
  });

  it('has a stable error code for a bad ref', () => {
    expect(ERROR_CODES).toContain('INVALID_BLOB_REF');
  });

  it.each([
    'blob://sha256/../../etc/passwd',
    'blob://sha256/%2e%2e/x.png',
    `blob://sha256/${'a'.repeat(64)}.png/..`,
    `blob://sha256/${'A'.repeat(64)}.png`,
    `blob://sha256/${'a'.repeat(63)}.png`,
    `blob://sha256/${'a'.repeat(64)}.svg`,
    `file:///sha256/${'a'.repeat(64)}.png`,
    '',
  ])('refuses a ref that is not exactly blob://sha256/<64 hex>.png (%j)', (ref) => {
    const e = catchError(() => parseBlobRef(ref));

    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe('INVALID_BLOB_REF');
  });

  it('refuses a content type it cannot name safely', () => {
    const e = catchError(() => blobRef(PNG, 'image/svg+xml'));

    expect((e as DomainError).code).toBe('INVALID_BLOB_REF');
  });
});
