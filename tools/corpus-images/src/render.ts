// `pnpm corpus:images`: renders SCENES to fixtures/corpus/images and writes the manifests (D-028, D-030).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { SCENES } from './scenes.ts';

const OUT = new URL('../../../fixtures/corpus/images/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
type Manifest = Record<string, { file: string; mediaType: string; subject: string[] }>;
const manifest: Manifest = {};
const hard: Manifest = {};
for (const s of SCENES) {
  await page.setContent(`<html><body style="margin:0">${s.svg}</body></html>`);
  const png = s.file.endsWith('.png');
  const bytes = await page.screenshot(png ? { type: 'png' } : { type: 'jpeg', quality: 80 });
  writeFileSync(new URL(s.file, OUT), bytes);
  (s.hard ? hard : manifest)[s.src] = {
    file: s.file,
    mediaType: png ? 'image/png' : 'image/jpeg',
    subject: s.subject,
  };
}
writeFileSync(new URL('manifest.json', OUT), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(new URL('hard-manifest.json', OUT), `${JSON.stringify(hard, null, 2)}\n`);
await browser.close();
console.log(`rendered ${String(SCENES.length)} images`);
