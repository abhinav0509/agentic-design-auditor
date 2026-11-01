// `pnpm corpus:images`: renders SCENES to fixtures/corpus/images and writes the manifest (D-028).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { SCENES } from './scenes.ts';

const OUT = new URL('../../../fixtures/corpus/images/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const manifest: Record<string, { file: string; mediaType: string; subject: string[] }> = {};
for (const s of SCENES) {
  await page.setContent(`<html><body style="margin:0">${s.svg}</body></html>`);
  const png = s.file.endsWith('.png');
  const bytes = await page.screenshot(png ? { type: 'png' } : { type: 'jpeg', quality: 80 });
  writeFileSync(new URL(s.file, OUT), bytes);
  manifest[s.src] = {
    file: s.file,
    mediaType: png ? 'image/png' : 'image/jpeg',
    subject: s.subject,
  };
}
writeFileSync(new URL('manifest.json', OUT), `${JSON.stringify(manifest, null, 2)}\n`);
await browser.close();
console.log(`rendered ${String(SCENES.length)} images`);
