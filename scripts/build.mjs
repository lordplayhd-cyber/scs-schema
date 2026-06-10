#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { glob } from 'glob';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SCHEMAS_DIR = path.join(DATA_DIR, 'schemas');
const OUT = path.join(DATA_DIR, 'manifest.json');

const REPO_USER = 'duhnunes';
const REPO_NAME = 'scs-schema';

function sha256(buf) { return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex'); }
function gitRevParseHead() { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); }
function git(cmd) { return execSync(cmd, { stdio: 'inherit' }); }

async function loadManifest() {
  try { return JSON.parse(await fs.readFile(OUT, 'utf8')); }
  catch { return { version: '', generatedAt: '', schemas: {} }; }
}

function makeKeyFromRel(rel) {
  return path.basename(rel, '.json'); 
}

async function build(ref = null, { doCommit = true } = {}) {
  if (!ref) ref = gitRevParseHead();

  const pattern = path.join(SCHEMAS_DIR, '**', '*.json');
  const files = await glob(pattern, { nodir: true });

  const manifest = await loadManifest();
  const urlBase = `https://cdn.jsdelivr.net/gh/${REPO_USER}/${REPO_NAME}@commit/${ref}`;

  for (const file of files) {
    if (path.resolve(file) === path.resolve(OUT)) continue;

    const raw = await fs.readFile(file);
    const parsed = JSON.parse(raw.toString('utf8'));
    const rel = path.relative(DATA_DIR, file).replace(/\\/g, '/'); 
    const key = makeKeyFromRel(rel);
    const computedHash = sha256(raw);
    const computedSize = raw.length;
    const idField = `schemas/${rel}`;
    const pathField = `./${rel}`;
    const nameField = path.basename(rel, '.json');
    const metaVersion = parsed.meta?.version || '';
    const description = parsed.meta?.description || '';

    // If manifest has entry, validate hash/size; if mismatch, fail or update per policy
    const existing = manifest.schemas[key];
    if (existing) {
      if (existing.hash && existing.hash !== computedHash) {
        console.error(`Hash mismatch for ${key}: manifest=${existing.hash} computed=${computedHash}`);
        // Option A: fail the build to force manual check
        throw new Error(`Hash mismatch for ${key}`);
        // Option B (commented): update manifest silently
        // existing.hash = computedHash; existing.size = computedSize;
      } else {
        // keep existing fields, but ensure id/path/name/metaVersion/description are present
        existing.id = existing.id || idField;
        existing.name = existing.name || nameField;
        existing.path = existing.path || pathField;
        existing.metaVersion = metaVersion || existing.metaVersion || '';
        existing.hash = existing.hash || computedHash;
        existing.size = existing.size || computedSize;
        existing.description = existing.description || description || '';
        existing.url = `${urlBase}/${rel}`;
        manifest.schemas[key] = existing;
      }
    } else {
      // If no entry exists (shouldn't happen if verify ran), create minimal entry
      manifest.schemas[key] = {
        id: idField,
        name: nameField,
        path: pathField,
        url: `${urlBase}/${rel}`,
        metaVersion,
        hash: computedHash,
        size: computedSize,
        description
      };
    }

    console.log('Prepared manifest entry for', key, '->', manifest.schemas[key].url);
  }

  manifest.version = ref.startsWith('v') ? ref.replace(/^v/, '') : ref;
  manifest.generatedAt = new Date().toISOString();

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('Wrote manifest with ref', ref);

  if (doCommit) {
    try {
      git(`git add ${OUT}`);
      git(`git commit -m "chore(manifest): manifest for ${ref}"`);
      git('git push origin HEAD');
      console.log('Committed and pushed manifest.json');
    } catch (err) {
      console.error('Git commit/push failed:', err);
      throw err;
    }
  }
}

// CLI parsing
const argv = process.argv.slice(2);
let refArg = null;
let doCommit = true;
for (const a of argv) {
  if (a === '--no-commit') doCommit = false;
  else if (!refArg) refArg = a;
}
build(refArg, { doCommit }).catch(e => { console.error(e); process.exit(1); });
