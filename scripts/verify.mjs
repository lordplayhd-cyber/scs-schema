#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.resolve(__dirname, '..', 'data', 'manifest.json');
const SCHEMAS_DIR = path.resolve(__dirname, '..', 'data', 'schemas');

function sha256(buf) {
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');
}

async function loadManifest() {
  try { return JSON.parse(await fs.readFile(MANIFEST, 'utf8')); }
  catch { return { version: '', generatedAt: '', schemas: {} }; }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...await walk(full));
    else if (e.isFile() && e.name.endsWith('.json')) files.push(full);
  }
  return files;
}

async function main() {
  const manifest = await loadManifest();
  const files = await walk(SCHEMAS_DIR);

  console.log('verify: found files =', files.length);

  const seenKeys = new Set();

  for (const file of files) {
    const rel = path.relative(path.resolve(__dirname, '..', 'data'), file).replace(/\\/g, '/');
    const basename = path.basename(rel, '.json');
    const key = basename

    const raw = await fs.readFile(file);
    const parsed = JSON.parse(raw.toString('utf8'));
    const metaVersion = parsed.meta?.version || '';
    const hash = sha256(raw);
    const size = raw.length;
    const idField = `${rel}`
    const pathField = `./${rel}`
    const nameField = basename;
    const description = parsed.meta?.description || '';

    seenKeys.add(key);

    if (manifest.schemas[key]) {
      // update existing entry, preserve url if present
      const preservedUrl = manifest.schemas[key].url || '';
      manifest.schemas[key] = {
        id: idField,
        name: nameField,
        path: pathField,
        url: preservedUrl,
        metaVersion,
        hash,
        size,
        description
      };
      console.log('Updated manifest entry for', key, preservedUrl ? '(kept url)' : '(no url)');
    } else {
      // create new entry with empty url (build will fill with @<sha>)
      manifest.schemas[key] = {
        id: idField,
        name: nameField,
        path: pathField,
        url: '',
        metaVersion,
        hash,
        size,
        description
      };
      console.log('Added manifest entry for', key);
    }
  }

  for (const existingKey of Object.keys(manifest.schemas)) {
    if (!seenKeys.has(existingKey)) {
      console.log('Removing stale manifest entry for', existingKey);
      delete manifest.schemas[existingKey];
    }
  }

  manifest.generatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(MANIFEST), { recursive: true });
  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('verify done — total files processed:', files.length);
}

main().catch(err => { console.error(err); process.exit(1); });
