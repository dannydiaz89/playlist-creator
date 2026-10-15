import { describe, it, expect } from 'vitest';
import { generateSurveyCode, isValidCode, normaliseCode, CODE_PATTERN } from '@convex/lib/surveyCode';

describe('survey codes', () => {
  it('generates codes matching the documented pattern', () => {
    for (let i = 0; i < 200; i++) expect(CODE_PATTERN.test(generateSurveyCode())).toBe(true);
  });

  it('omits characters that are ambiguous when read aloud', () => {
    const codes = Array.from({ length: 500 }, () => generateSurveyCode()).join('');
    for (const ch of ['I', 'O', '0', '1']) expect(codes).not.toContain(ch);
  });

  it('produces few collisions across 500 generations', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateSurveyCode()));
    expect(set.size).toBeGreaterThan(495);
  });

  it('accepts the documented example codes', () => {
    expect(isValidCode('P4-BEATS')).toBe(true);
    expect(isValidCode('STUDY-22')).toBe(true);
  });

  it('rejects malformed codes', () => {
    expect(isValidCode('lower-case')).toBe(false);
    expect(isValidCode('WAY-TOO-LONG-INDEED-X')).toBe(false);
    expect(isValidCode('')).toBe(false);
  });

  it('normalises case and whitespace', () => {
    expect(normaliseCode('  p4-beats  ')).toBe('P4-BEATS');
  });
});
