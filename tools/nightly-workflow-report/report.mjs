#!/usr/bin/env node
/**
 * Nightly workflow report
 * - Node ESM, built-in modules only
 * - Emits Markdown to stdout
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function printHelp(exitCode = 0) {
  const msg = `nightly-workflow-report

Usage:
  node tools/nightly-workflow-report/report.mjs [options]

Options:
  --help               Show help
  --repo <path>        Repo path (default: .)
  --since <dur>        Duration like 90m, 24h, 2d (default: 24h)
  --remote <name>      Remote name (default: mitre)
  --base <branch>      Base branch (default: main)

Examples:
  node tools/nightly-workflow-report/report.mjs --repo . --since 1h
`;
  const out = exitCode === 0 ? process.stdout : process.stderr;
  out.write(msg);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    repo: '.',
    since: '24h',
    remote: 'mitre',
    base: 'main',
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') printHelp(0);
    if (a === '--repo') args.repo = argv[++i] ?? '';
    else if (a === '--since') args.since = argv[++i] ?? '';
    else if (a === '--remote') args.remote = argv[++i] ?? '';
    else if (a === '--base') args.base = argv[++i] ?? '';
    else if (a.startsWith('--repo=')) args.repo = a.slice('--repo='.length);
    else if (a.startsWith('--since=')) args.since = a.slice('--since='.length);
    else if (a.startsWith('--remote=')) args.remote = a.slice('--remote='.length);
    else if (a.startsWith('--base=')) args.base = a.slice('--base='.length);
    else {
      process.stderr.write(`Unknown arg: ${a}\n\n`);
      printHelp(2);
    }
  }
  if (!args.repo) {
    process.stderr.write('Missing --repo\n');
    printHelp(2);
  }
  if (!args.since) {
    process.stderr.write('Missing --since\n');
    printHelp(2);
  }
  return args;
}

function parseDurationToGitSince(dur) {
  const m = String(dur).trim().match(/^([0-9]+)\s*([mhd])$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return null;

  if (unit === 'm') return `${n} minutes ago`;
  if (unit === 'h') return `${n} hours ago`;
  if (unit === 'd') return `${n} days ago`;
  return null;
}

function safeExec(repoDir, cmd, args) {
  try {
    const out = execFileSync(cmd, args, {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    return { ok: true, stdout: out, stderr: '' };
  } catch (err) {
    const e = err;
    const stdout = typeof e?.stdout === 'string' ? e.stdout : (e?.stdout ? String(e.stdout) : '');
    const stderr = typeof e?.stderr === 'string' ? e.stderr : (e?.stderr ? String(e.stderr) : '');
    return { ok: false, stdout, stderr: (stderr || '').trim() };
  }
}

function existsOnPath(bin) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const dirs = (process.env.PATH || '').split(sep);
  for (const d of dirs) {
    const full = path.join(d, bin);
    if (existsSync(full)) return true;
    if (process.platform === 'win32' && existsSync(full + '.exe')) return true;
  }
  return false;
}

function mdEscape(s) {
  return String(s ?? '').replaceAll('\r', '').trim();
}

function relTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const deltaMs = Date.now() - t;
  const mins = Math.floor(deltaMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function toRepoBasename(repoDir) {
  return path.basename(path.resolve(repoDir));
}

function main() {
  const { repo, since, remote, base } = parseArgs(process.argv.slice(2));
  const repoDir = path.resolve(process.cwd(), repo);

  const gitSince = parseDurationToGitSince(since);
  if (!gitSince) {
    process.stderr.write(`Invalid --since: ${since} (expected like 90m, 24h, 2d)\n`);
    process.exit(2);
  }

  const repoName = toRepoBasename(repoDir);
  const nowIso = new Date().toISOString();

  const lines = [];
  lines.push(`# Nightly report: ${repoName}`);
  lines.push(`_Generated: ${nowIso}_`);
  lines.push('');

  // Git summary
  lines.push('## Git');

  const branchRes = safeExec(repoDir, 'git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRes.ok ? mdEscape(branchRes.stdout) : '(unknown)';

  const headRes = safeExec(repoDir, 'git', ['log', '-1', '--pretty=%h %s']);
  const head = headRes.ok ? mdEscape(headRes.stdout) : '(unknown)';

  const dirtyRes = safeExec(repoDir, 'git', ['status', '--porcelain']);
  const dirty = dirtyRes.ok ? (dirtyRes.stdout.trim().length > 0 ? 'yes' : 'no') : '(unknown)';

  lines.push(`- Branch: ${branch}`);
  lines.push(`- HEAD: ${head}`);
  lines.push(`- Dirty: ${dirty}`);
  lines.push(`- Base: ${remote}/${base}`);
  lines.push('');

  // Commits
  lines.push(`## Commits since ${since}`);
  const logArgs = ['log', `--since=${gitSince}`, '--pretty=%h|%s|%an|%ar', '-n', '30'];
  const logRes = safeExec(repoDir, 'git', logArgs);
  if (!logRes.ok) {
    lines.push(`(skipped: git log failed)`);
  } else {
    const entries = logRes.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [sha, subj, author, rel] = l.split('|');
        return { sha, subj, author, rel };
      });

    if (entries.length === 0) {
      lines.push('- (no commits)');
    } else {
      for (const e of entries) {
        lines.push(`- ${mdEscape(e.sha)} ${mdEscape(e.subj)} (${mdEscape(e.author)}, ${mdEscape(e.rel)})`);
      }
    }
  }
  lines.push('');

  // GitHub (gh)
  const ghAvailable = existsOnPath('gh');
  let ghAuthed = false;
  if (ghAvailable) {
    const authRes = safeExec(repoDir, 'gh', ['auth', 'status']);
    ghAuthed = authRes.ok;
  }

  function renderGhList(title, cmdArgs, mapItem) {
    lines.push(`## ${title}`);
    if (!ghAvailable || !ghAuthed) {
      lines.push('(skipped: gh not available or not authenticated)');
      lines.push('');
      return;
    }
    const res = safeExec(repoDir, 'gh', cmdArgs);
    if (!res.ok) {
      lines.push(`(skipped: gh command failed)`);
      lines.push('');
      return;
    }
    let data;
    try {
      data = JSON.parse(res.stdout);
    } catch {
      lines.push('(skipped: gh returned invalid JSON)');
      lines.push('');
      return;
    }
    if (!Array.isArray(data) || data.length === 0) {
      lines.push('- (none)');
      lines.push('');
      return;
    }
    for (const item of data) lines.push(mapItem(item));
    lines.push('');
  }

  renderGhList(
    'Open PRs',
    ['pr', 'list', '--state', 'open', '--limit', '10', '--json', 'number,title,author,updatedAt,url'],
    (pr) => {
      const author = pr?.author?.login || pr?.author?.name || 'unknown';
      const when = relTime(pr?.updatedAt);
      return `- #${pr?.number} ${mdEscape(pr?.title)} (@${author}${when ? `, ${when}` : ''}) — ${pr?.url}`;
    },
  );

  renderGhList(
    'Open issues',
    ['issue', 'list', '--state', 'open', '--limit', '10', '--json', 'number,title,author,updatedAt,url'],
    (iss) => {
      const author = iss?.author?.login || iss?.author?.name || 'unknown';
      const when = relTime(iss?.updatedAt);
      return `- #${iss?.number} ${mdEscape(iss?.title)} (@${author}${when ? `, ${when}` : ''}) — ${iss?.url}`;
    },
  );

  lines.push('---');
  lines.push('Suggested checks:');
  lines.push('- `pnpm lint`');
  lines.push('- `pnpm test`');
  lines.push('');

  process.stdout.write(lines.join('\n'));
}

try {
  main();
} catch {
  // Best-effort: never print stack traces.
  process.stderr.write('nightly-workflow-report: unexpected error\n');
  process.exit(1);
}
