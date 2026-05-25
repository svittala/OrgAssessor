#!/usr/bin/env node
/**
 * remove-destructive-components.js
 *
 * Removes local source files for every component listed in destructiveChanges.xml.
 * Mirrors remove_destructive_components.py exactly.
 *
 * Supported metadata types:
 *   ApexPage                 → force-app/main/default/pages/<name>.page
 *                              force-app/main/default/pages/<name>.page-meta.xml
 *   ApexClass                → force-app/main/default/classes/<name>.cls
 *                              force-app/main/default/classes/<name>.cls-meta.xml
 *   LightningComponentBundle → force-app/main/default/lwc/<name>/ (entire dir)
 *
 * Usage (from project root):
 *   node scripts/code-analyzer/remove-destructive-components.js [--dry-run] [--xml <path>]
 *
 * Options:
 *   --dry-run       Print what would be deleted without actually deleting anything
 *   --xml <path>    Path to destructiveChanges.xml (default: scripts/code-analyzer/destructiveChanges.xml)
 *   --force-app <p> Path to force-app root (default: ./force-app/main/default)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const ROOT    = process.cwd();
const DRY_RUN = process.argv.includes('--dry-run');

function argVal(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const SCRIPT_DIR       = path.dirname(path.resolve(process.argv[1]));
const DESTRUCTIVE_XML  = path.resolve(ROOT, argVal('--xml', path.join(SCRIPT_DIR, 'destructiveChanges.xml')));
const SOURCE_ROOT      = path.resolve(ROOT, argVal('--force-app', 'force-app/main/default'));

const TYPE_MAP = {
  ApexPage: {
    dir:        path.join(SOURCE_ROOT, 'pages'),
    extensions: ['.page', '.page-meta.xml'],
  },
  ApexClass: {
    dir:        path.join(SOURCE_ROOT, 'classes'),
    extensions: ['.cls', '.cls-meta.xml'],
  },
  LightningComponentBundle: {
    dir:        path.join(SOURCE_ROOT, 'lwc'),
    extensions: null, // entire directory
  },
};

// ─── XML Parser ───────────────────────────────────────────────────────────────

const NS = 'http://soap.sforce.com/2006/04/metadata';

function xmlTagAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

function xmlTagFirst(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function parseDestructiveXML(xmlPath) {
  const xml      = fs.readFileSync(xmlPath, 'utf8');
  const result   = {};
  const typesAll = xmlTagAll(xml, 'types');
  typesAll.forEach((block) => {
    const typeName = xmlTagFirst(block, 'name');
    if (!typeName) return;
    const members = xmlTagAll(block, 'members').filter(Boolean);
    result[typeName] = members;
  });
  return result;
}

// ─── File removal ─────────────────────────────────────────────────────────────

function removeFiles(members, config) {
  let removed = 0;
  let missing = 0;
  const { dir, extensions } = config;

  members.forEach((member) => {
    if (extensions === null) {
      // LWC — remove the entire component directory
      const target = path.join(dir, member);
      const rel    = path.relative(ROOT, target);
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        console.log(`  [DIR]  ${rel}`);
        if (!DRY_RUN) fs.rmSync(target, { recursive: true, force: true });
        removed++;
      } else {
        console.log(`  [SKIP] ${rel}  (not found)`);
        missing++;
      }
    } else {
      extensions.forEach((ext) => {
        const target = path.join(dir, `${member}${ext}`);
        const rel    = path.relative(ROOT, target);
        if (fs.existsSync(target)) {
          console.log(`  [FILE] ${rel}`);
          if (!DRY_RUN) fs.unlinkSync(target);
          removed++;
        } else {
          console.log(`  [SKIP] ${rel}  (not found)`);
          missing++;
        }
      });
    }
  });

  return { removed, missing };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  if (DRY_RUN) {
    console.log('=== DRY RUN — no files will be deleted ===\n');
  }

  if (!fs.existsSync(DESTRUCTIVE_XML)) {
    console.error(`ERROR: destructiveChanges.xml not found at:\n  ${DESTRUCTIVE_XML}`);
    process.exit(1);
  }

  const components   = parseDestructiveXML(DESTRUCTIVE_XML);
  let totalRemoved   = 0;
  let totalMissing   = 0;

  Object.entries(components).forEach(([typeName, members]) => {
    const config = TYPE_MAP[typeName];
    if (!config) {
      console.warn(`\n[WARN] No handler for metadata type '${typeName}' — skipping ${members.length} member(s).`);
      return;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${typeName}  (${members.length} members)`);
    console.log('='.repeat(60));

    const { removed, missing } = removeFiles(members, config);
    totalRemoved += removed;
    totalMissing += missing;
  });

  console.log(`\n${'='.repeat(60)}`);
  if (DRY_RUN) {
    console.log('  DRY RUN complete.');
    console.log(`  Would delete : ${totalRemoved} file(s)/dir(s)`);
    console.log(`  Not found    : ${totalMissing} file(s)/dir(s)`);
  } else {
    console.log('  Done.');
    console.log(`  Deleted      : ${totalRemoved} file(s)/dir(s)`);
    console.log(`  Not found    : ${totalMissing} file(s)/dir(s)`);
  }
  console.log('='.repeat(60));
}

run();
