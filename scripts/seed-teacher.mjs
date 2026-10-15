/**
 * Creates a teacher account.
 *
 * Sign-up is gated on TEACHER_INVITE_CODE — a secret only the operator has —
 * rather than being disabled outright, so seeding needs no code edits. Run this
 * once per teacher, then rotate or unset the invite code.
 *
 *   pnpm seed
 *
 * Reads SEED_TEACHER_EMAIL / SEED_TEACHER_PASSWORD / TEACHER_INVITE_CODE from
 * .env.local, or pass them inline.
 */
import { readFileSync } from 'node:fs';

// Minimal .env.local reader — this runs outside Next, so nothing loads it for us.
function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch { /* no .env.local — rely on inline vars */ }
}
loadEnv();

const base = process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000';
const email = process.env.SEED_TEACHER_EMAIL;
const password = process.env.SEED_TEACHER_PASSWORD;
const inviteCode = process.env.TEACHER_INVITE_CODE;
const name = process.env.SEED_TEACHER_NAME ?? 'Teacher';

const missing = [
  !email && 'SEED_TEACHER_EMAIL',
  !password && 'SEED_TEACHER_PASSWORD',
  !inviteCode && 'TEACHER_INVITE_CODE',
].filter(Boolean);

if (missing.length) {
  console.error(`Missing: ${missing.join(', ')}`);
  console.error('\nAdd them to .env.local, e.g.:');
  console.error('  TEACHER_INVITE_CODE=' + Math.random().toString(36).slice(2, 14));
  console.error('  SEED_TEACHER_EMAIL=you@school.edu');
  console.error("  SEED_TEACHER_PASSWORD='at-least-8-characters'");
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

let res;
try {
  res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Better Auth rejects originless POSTs as CSRF (MISSING_OR_NULL_ORIGIN).
      // A browser sets this automatically; a script must send it explicitly.
      Origin: base,
    },
    body: JSON.stringify({ email, password, name, inviteCode }),
  });
} catch {
  console.error(`Could not reach ${base}. Is \`pnpm dev\` running?`);
  process.exit(1);
}

const text = await res.text();

if (res.ok) {
  console.log(`✓ Created teacher account: ${email}`);
  console.log('\nSign in at ' + base);
  console.log('Now rotate or remove TEACHER_INVITE_CODE so no one else can sign up.');
  process.exit(0);
}

if (res.status === 403 && /ORIGIN/i.test(text)) {
  console.error(`Rejected as cross-origin. BETTER_AUTH_URL (${base}) must match the URL you actually serve on.`);
} else if (res.status === 403) {
  console.error('Rejected: invite code did not match the server.');
  console.error('TEACHER_INVITE_CODE must be set on the CONVEX deployment, not just .env.local:');
  console.error('  npx convex env set TEACHER_INVITE_CODE <value>');
} else if (/already exists|USER_ALREADY_EXISTS/i.test(text)) {
  console.error(`An account for ${email} already exists. Sign in instead.`);
} else {
  console.error(`Sign-up failed (${res.status}): ${text}`);
}
process.exit(1);
