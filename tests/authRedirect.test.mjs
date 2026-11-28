import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/authRedirect.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { normalizeOrigin, getAuthOrigin, buildAuthRedirectUrl } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`,
);

test('normalizes valid http/https origins and rejects invalid protocols', () => {
  assert.equal(normalizeOrigin('https://iliguide.vercel.app/login?next=/bookings'), 'https://iliguide.vercel.app');
  assert.equal(normalizeOrigin('http://localhost:3000/'), 'http://localhost:3000');
  assert.equal(normalizeOrigin('javascript:alert(1)'), '');
  assert.equal(normalizeOrigin('not-a-url'), '');
  assert.equal(normalizeOrigin(''), '');
});

test('prefers browser origin and falls back to env URL when browser origin is unavailable', () => {
  assert.equal(
    getAuthOrigin('https://iliguide.vercel.app', 'https://fallback.example.com'),
    'https://iliguide.vercel.app',
  );
  assert.equal(
    getAuthOrigin('', 'https://iliguide-prod.vercel.app/'),
    'https://iliguide-prod.vercel.app',
  );
  assert.equal(getAuthOrigin(undefined, ''), '');
});

test('builds safe dynamic auth redirect URLs without hardcoded localhost', () => {
  assert.equal(
    buildAuthRedirectUrl('/login?mode=reset', 'https://iliguide.vercel.app', ''),
    'https://iliguide.vercel.app/login?mode=reset',
  );
  assert.equal(
    buildAuthRedirectUrl('/staff/login?mode=reset', undefined, 'https://iliguide.vercel.app'),
    'https://iliguide.vercel.app/staff/login?mode=reset',
  );
  // Blocks protocol-relative open redirects
  assert.equal(
    buildAuthRedirectUrl('//evil.example.com/phish', 'https://iliguide.vercel.app', ''),
    'https://iliguide.vercel.app/',
  );
});
