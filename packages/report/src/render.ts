import type { Report } from './build.ts';

export type RenderOptions = {
  siteUrl: string;
  scannedAt: string;
  expiresAt: string;
  cropUrl: (ref: string) => string;
};

export function renderReport(_report: Report, _options: RenderOptions): string {
  return '';
}
