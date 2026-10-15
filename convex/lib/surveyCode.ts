/**
 * Join codes are read aloud in a classroom, so the alphabet omits characters
 * that sound or look alike: I/1, O/0.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const CODE_PATTERN = /^[A-Z0-9]{2,6}(-[A-Z0-9]{2,6}){0,2}$/;

function block(len: number, rand: () => number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

export function generateSurveyCode(rand: () => number = Math.random): string {
  return `${block(2, rand)}-${block(4, rand)}`;
}

export function normaliseCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}
