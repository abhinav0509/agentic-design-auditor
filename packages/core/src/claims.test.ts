import { describe, expect, it } from 'vitest';
import { complianceClaims } from './claims.ts';

describe('complianceClaims', () => {
  it.each([
    ['Your site is now WCAG compliant.', 'compliant'],
    ['This page passes WCAG 2.2 AA.', 'passes WCAG'],
    ['Meets WCAG requirements', 'Meets WCAG'],
    ['Fully accessible after these fixes', 'Fully accessible'],
    ['100% accessible', '100% accessible'],
    ['ADA-ready and EAA ready', 'ADA-ready'],
    ['Certified by Beacon', 'Certified'],
    ['Your accessibility score: 92', 'accessibility score'],
    ['Conformance level AA reached', 'Conformance'],
    ['It is legally COMPLIANT', 'COMPLIANT'],
    ['Brings the site into compliance', 'compliance'],
  ])('FR-31: flags a claim in %j', (text, phrase) => {
    expect(complianceClaims(text)).toContain(phrase);
  });

  it.each([
    'Automated and AI checks found 12 possible issues. A human audit is still needed.',
    'Add alt text to the hero image (WCAG 1.1.1, reference only).',
    'The link has no text a screen reader can announce.',
    'Best practice, not a WCAG requirement.',
    'Accessible names help screen-reader users.',
  ])('FR-31: lets honest wording through (%j)', (text) => {
    expect(complianceClaims(text)).toEqual([]);
  });

  it.each([
    'This fixes one finding, but it doesn’t make the page fully compliant.',
    "It doesn't mean the page is fully accessible.",
    'It does not by itself make the page compliant.',
    "This doesn't confirm the page is compliant.",
    'Never a compliance claim.',
    'Beacon makes no compliance claim about the site.',
  ])('FR-31: an honest disclaimer that denies a claim is not a claim (%j)', (text) => {
    expect(complianceClaims(text)).toEqual([]);
  });

  it.each([
    ['The page is now compliant.', 'compliant'],
    ['It is not only fixed: the page is compliant.', 'compliant'],
    ['This not only fixes the alt text but also makes the whole page compliant.', 'compliant'],
    ['No more issues: fully accessible!', 'fully accessible'],
  ])('FR-31: a claim is still a claim when a negation is elsewhere (%j)', (text, phrase) => {
    expect(complianceClaims(text)).toContain(phrase);
  });
});
