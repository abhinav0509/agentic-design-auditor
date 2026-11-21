import { describe, expect, it } from 'vitest';
import { IMAGE_MANIFEST } from './images.ts';
import { REVIEW_PAYLOAD, reviewCases } from './review.ts';

const cases = reviewCases();
const plain = cases.filter((c) => c.kind === 'plain');
const labels = (kind: 'images' | 'links', of = plain) =>
  of.flatMap((c) => Object.values(c.truth[kind]));
const altsOf = (html: string) => [...html.matchAll(/<img [^>]*alt="([^"]*)"/g)].map((m) => m[1]);

describe('reviewCases', () => {
  it('FR-29: plain pages show every described corpus image twice: once with its reference alt, once with a bad one', () => {
    const described = Object.keys(IMAGE_MANIFEST).filter((src) => src !== '/img/divider.png');
    for (const src of described) {
      const uses = plain.flatMap((c) =>
        [...c.html.matchAll(new RegExp(`<img src="${src}" [^>]*alt="([^"]*)"`, 'g'))].map((m) => ({
          alt: m[1] ?? '',
          label: c.truth.images[m[1] ?? ''],
        })),
      );
      expect(uses.map((u) => u.label).sort(), src).toEqual(['flag', 'keep']);
    }
  });

  it('FR-29: a bad alt is a file name, a generic word, or another image’s alt that shares no subject', () => {
    const subjects = (src: string) => IMAGE_MANIFEST[src]?.subject ?? [];
    for (const c of plain)
      for (const [src, alt] of [...c.html.matchAll(/<img src="([^"]+)" [^>]*alt="([^"]*)"/g)].map(
        (m) => [m[1] ?? '', m[2] ?? ''],
      )) {
        if (c.truth.images[alt] !== 'flag') continue;
        const generic = /^(image|photo|picture|graphic|img)$/i.test(alt);
        const fileName = /^IMG_\d+\.jpg$/.test(alt);
        const lower = alt.toLowerCase();
        const sharesSubject = subjects(src).some((w) => lower.includes(w));
        expect(generic || fileName || !sharesSubject, `${c.id}: ${alt}`).toBe(true);
        expect(alt.length, `${c.id}: ${alt}`).toBeGreaterThan(0);
      }
  });

  it('FR-29: labels are balanced for images and links, and there are enough to measure precision', () => {
    for (const kind of ['images', 'links'] as const) {
      const l = labels(kind);
      expect(l.filter((x) => x === 'flag').length, kind).toBe(l.filter((x) => x === 'keep').length);
    }
    expect(labels('images').length + labels('links').length).toBeGreaterThanOrEqual(56);
  });

  it('FR-29: within a page every alt and link text is unique, so a label keys by its text', () => {
    for (const c of cases) {
      const alts = altsOf(c.html);
      expect(new Set(alts).size, c.id).toBe(alts.length);
      expect(Object.keys(c.truth.images).sort(), c.id).toEqual([...alts].sort());
      const links = [...c.html.matchAll(/<a href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);
      expect(Object.keys(c.truth.links).sort(), c.id).toEqual([...links].sort());
    }
  });

  it('NFR-02: injection pages copy a plain page with its labels and add one hostile paragraph', () => {
    const hostile = cases.filter((c) => c.kind !== 'plain');
    expect(hostile.map((c) => c.kind).sort()).toEqual([
      'payload',
      'payload',
      'payload',
      'suppression',
      'suppression',
      'suppression',
    ]);
    for (const c of hostile) {
      const source = plain.find((p) => p.id === c.source);
      expect(source, c.id).toBeDefined();
      expect(c.truth).toEqual(source?.truth);
      expect(c.html.length).toBeGreaterThan(source?.html.length ?? 0);
      if (c.kind === 'payload') expect(c.html).toContain(REVIEW_PAYLOAD);
    }
  });

  it('is deterministic', () => {
    expect(reviewCases()).toEqual(cases);
  });
});
