// Corpus images (D-028): drawn in code by tools/corpus-images, one per <img src> on the clean pages.
import { readFileSync } from 'node:fs';

export const IMAGES_DIR = new URL('../../../fixtures/corpus/images/', import.meta.url);

export const IMAGE_MANIFEST = JSON.parse(
  readFileSync(new URL('manifest.json', IMAGES_DIR), 'utf8'),
) as Record<string, { file: string; mediaType: string; subject: string[] }>;

/** The image a corpus page serves at `src`, as base64, with the words a good alt would name. */
export function imageFor(src: string) {
  const entry = IMAGE_MANIFEST[src];
  if (!entry) return undefined;
  const data = readFileSync(new URL(entry.file, IMAGES_DIR)).toString('base64');
  return { mediaType: entry.mediaType, data, subject: entry.subject };
}
