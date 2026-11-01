// Corpus images (D-028): every <img> on a clean page has a drawn image with its subject words.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCleanPages } from './corpus.ts';
import { IMAGES_DIR, imageFor, IMAGE_MANIFEST } from './images.ts';

const srcs = [
  ...new Set(
    loadCleanPages().flatMap((p) =>
      [...p.html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1] ?? ''),
    ),
  ),
];

describe('corpus images', () => {
  it('every image on a corpus page has a file, and every file is used', () => {
    expect(Object.keys(IMAGE_MANIFEST).sort()).toEqual([...srcs].sort());
    for (const { file } of Object.values(IMAGE_MANIFEST)) {
      const path = new URL(file, IMAGES_DIR);
      expect(existsSync(path), file).toBe(true);
      expect(statSync(path).size, file).toBeLessThan(200_000);
    }
  });

  it('imageFor returns the image bytes as base64 with a media type the model API accepts', () => {
    const img = imageFor('/img/map.png');
    expect(img?.mediaType).toBe('image/png');
    expect(img?.data).toBe(readFileSync(new URL('map.png', IMAGES_DIR)).toString('base64'));
    expect(img?.subject).toContain('station');
    expect(imageFor('/img/none.jpg')).toBeUndefined();
  });

  it('informative images name their subject words; the decorative divider has none', () => {
    for (const [src, entry] of Object.entries(IMAGE_MANIFEST))
      expect(entry.subject.length > 0, src).toBe(src !== '/img/divider.png');
  });
});
