#!/usr/bin/env node
import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

async function updateFileVersion(filePath, newVersion) {
  const raw = await fs.readFile(filePath, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`Invalid JSON in ${filePath}: ${e.message}`); }

  if (!parsed.meta) parsed.meta = {};
  if (parsed.meta.version === newVersion) return false;
  parsed.meta.version = newVersion;
  await fs.writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  return true;
}

async function main() {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/bump.mjs <version>');
    process.exit(1);
  }

  try {
    run('git fetch --tags --no-recurse-submodules --depth=1 origin');
  } catch {
  }

  let baseRef;
  try {
    baseRef = run('git describe --tags --abbrev=0');
    console.log('Previous tag found:', baseRef);
  } catch {
    baseRef = run('git rev-list --max-parents=0 HEAD');
    console.log('No previous tag found, using root commit:', baseRef);
  }

  let changed = [];
  try {
    const out = run(`git diff --name-only ${baseRef}..HEAD -- data/schemas`);
    if (out) changed = out.split('\n').filter(Boolean);
  } catch (e) {
    console.warn('git diff failed, falling back to listing tracked and untracked files in data/schemas');
  }


  if (!changed.length) {
    try {
      const tracked = run('git ls-files data/schemas || true').split('\n').filter(Boolean);
      const untracked = run('git ls-files --others --exclude-standard data/schemas || true').split('\n').filter(Boolean);

      const set = new Set([...tracked, ...untracked]);
      changed = Array.from(set);
    } catch (e) {
      console.error('Failed to list schema files:', e);
      process.exit(1);
    }
  }

  if (!changed.length) {
    console.log('No schema files changed since', baseRef);
    process.exit(0);
  }

  console.log('Schema files to consider:', changed);

  const updated = [];
  for (const f of changed) {
    const full = path.resolve(f);
    try {
      const did = await updateFileVersion(full, version);
      if (did) updated.push(f);
    } catch (err) {
      console.error('Failed to update', f, err);
      process.exit(1);
    }
  }

  if (!updated.length) {
    console.log('No schema files needed version bump (already at', version, ')');
    process.exit(0);
  }

  // commit + push changes
  try {
    run(`git add ${updated.map(f => `"${f}"`).join(' ')}`);
    run(`git commit -m "chore(schema): bump meta.version to ${version} for ${updated.length} file(s)"`);
    run('git push origin HEAD');
    console.log('Committed and pushed bumped schema files:', updated.length);
  } catch (err) {
    console.error('Failed to commit/push bumped files:', err);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
