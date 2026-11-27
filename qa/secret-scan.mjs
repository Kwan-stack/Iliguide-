import { execFileSync } from 'node:child_process';
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ['provider-key', /\b(?:sk_live|sk_test|whsk|whsec|ghp|github_pat)_[A-Za-z0-9_-]{8,}/],
  ['service-role-jwt', /(?:service[_ -]?role(?:[_ -]?key)?|SUPABASE_SERVICE_ROLE_KEY)\s*[:=]\s*["']?(eyJ[A-Za-z0-9_.-]{40,})/i],
  ['provider-secret-assignment', /(?:PAYMONGO_SECRET_KEY|PAYMONGO_WEBHOOK_SECRET|TICKET_SIGNING_SECRET)\s*[:=]\s*["']?([A-Za-z0-9_./+~-]{16,})/i],
];
const findings = [];
function inspect(text, file, area) {
  if (text.includes('\0')) return;
  for (const [category, re] of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const value = m[1] ?? m[0];
      if (/^(your-|<|placeholder|example|changeme|replace|xxxx)/i.test(value)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      findings.push(`${area},${file},${line},${category}`);
    }
  }
}
const listed = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean);
const seen = new Set();
for (const file of listed) {
  if (/(^|[\\/])node_modules([\\/]|$)|(^|[\\/])\.git([\\/]|$)/i.test(file)) continue;
  const abs = path.join(root, file);
  try {
    if (!(await lstat(abs)).isFile()) continue;
    inspect(await readFile(abs, 'utf8'), file, 'worktree');
    seen.add(file.toLowerCase());
  } catch {}
}
for (const file of ['.env', '.env.local', '.env.production', '.env.development']) {
  if (seen.has(file.toLowerCase())) continue;
  try { inspect(await readFile(path.join(root, file), 'utf8'), file, 'worktree'); seen.add(file.toLowerCase()); } catch {}
}
const commits = execFileSync('git', ['rev-list', '--all'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split(/\r?\n/).filter(Boolean);
const histRe = 'PRIVATE KEY|sk_live_|sk_test_|whsk_|whsec_|ghp_|github_pat_|SERVICE_ROLE_KEY|PAYMONGO_SECRET_KEY|PAYMONGO_WEBHOOK_SECRET|TICKET_SIGNING_SECRET';
for (const commit of commits) {
  let out = '';
  try { out = execFileSync('git', ['grep', '-n', '-I', '-E', histRe, commit, '--'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { if (e.stdout) out = String(e.stdout); }
  for (const row of out.split(/\r?\n/).filter(Boolean)) {
    const m = row.match(/^([^:]+):(.+?):(\d+):(.*)$/);
    if (!m) continue;
    inspect(m[4], `${m[2]}@${commit.slice(0, 8)}`, 'history');
  }
}
const lines = [
  `worktree_text_files_scanned=${seen.size}`,
  `history_commits_scanned=${commits.length}`,
  `redacted_matches=${findings.length}`,
  ...findings,
  'Secret values are never written to this report.'
];
await (await import('node:fs/promises')).writeFile(path.join(root, 'qa/evidence/secret-scan.log'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
