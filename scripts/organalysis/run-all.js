#!/usr/bin/env node
/**
 * run-all.js
 *
 * Orchestrates the full org analysis pipeline:
 *
 *   Step 0  [conditional]  Discover domains → domains.config.json
 *   Step 1                 Inventory        → inventory.json
 *   Step 2                 Analyze          → analysis.json
 *   Step 3                 Report           → capability-matrix-<timestamp>.html
 *
 * Step 0 (discovery) only runs when NO domains.config.json is found.
 * Once you have edited the config to your satisfaction, Step 0 is skipped
 * automatically on all subsequent runs.
 *
 * Usage:
 *   node scripts/organalysis/run-all.js [forceAppPath] [outputDir] [domainsConfig]
 *
 * Defaults:
 *   forceAppPath   ./force-app/main/default
 *   outputDir      ./reports/organalysis
 *   domainsConfig  <outputDir>/domains.config.json  (auto-located)
 *
 * Examples:
 *   # This org, all defaults
 *   node scripts/organalysis/run-all.js
 *
 *   # Different org, custom output directory
 *   node scripts/organalysis/run-all.js /path/to/org/force-app/main/default ./reports/my-org
 *
 *   # Different org with a shared, pre-approved domains config
 *   node scripts/organalysis/run-all.js /path/to/org/force-app/main/default ./reports/my-org ./my-domains.config.json
 */

'use strict';

const { spawnSync } = require('child_process');
const fs            = require('fs');
const path          = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const ROOT            = process.cwd();
const FORCE_APP       = process.argv[2] || 'force-app/main/default';
const OUTPUT_DIR      = process.argv[3] || 'reports/organalysis';
const EXPLICIT_CONFIG = process.argv[4] || null;

const SCRIPTS_DIR = __dirname;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(script, args, label) {
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  ${label}`);
  console.log(`${'─'.repeat(64)}`);

  const result = spawnSync(
    process.execPath,
    [path.join(SCRIPTS_DIR, script), ...args],
    { cwd: ROOT, stdio: 'inherit' }
  );

  if (result.status !== 0) {
    console.error(`\nFailed at: ${label}  (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

function resolveConfig() {
  if (EXPLICIT_CONFIG) return path.resolve(ROOT, EXPLICIT_CONFIG);

  const inOutputDir  = path.resolve(ROOT, OUTPUT_DIR, 'domains.config.json');
  if (fs.existsSync(inOutputDir)) return inOutputDir;

  const projectLevel = path.join(SCRIPTS_DIR, 'domains.config.json');
  if (fs.existsSync(projectLevel)) return projectLevel;

  return null;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

const start = Date.now();

const inventoryFile = path.join(OUTPUT_DIR, 'inventory.json');
const analysisFile  = path.join(OUTPUT_DIR, 'analysis.json');

// Always run inventory first (fast, idempotent)
run('1-inventory.js', [FORCE_APP, OUTPUT_DIR], 'Step 1 / 3  —  Inventory metadata');

// Step 0 (discover) only if no config exists yet
const configFile = resolveConfig();
if (!configFile) {
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  Step 0 / 3  —  Discover domains  [first-time setup]`);
  console.log(`${'─'.repeat(64)}`);
  console.log(`  No domains.config.json found. Running discovery...`);

  run('0-discover-domains.js', [inventoryFile, OUTPUT_DIR], 'Step 0 / 3  —  Discover domains');

  const generatedConfig = path.resolve(ROOT, OUTPUT_DIR, 'domains.config.json');
  console.log(`
${'═'.repeat(64)}
  FIRST-TIME SETUP — ACTION REQUIRED
${'═'.repeat(64)}
  A starter domains.config.json has been written to:
    ${generatedConfig}

  Before generating the report, open that file and:
    1. Rename each domain's "name" field to your business terminology
    2. Merge any domains that represent the same business area
    3. Remove or add patterns to move components to the right domain
    4. Check the "uncategorized" domain for components that need placing

  Then re-run:
    node scripts/organalysis/run-all.js ${FORCE_APP === 'force-app/main/default' ? '' : FORCE_APP + ' '}${OUTPUT_DIR === 'reports/organalysis' ? '' : OUTPUT_DIR}

${'═'.repeat(64)}
`);
  process.exit(0);
}

run('2-analyze.js', [inventoryFile, OUTPUT_DIR, configFile], 'Step 2 / 3  —  Classify into domains');
run('3-report.js',  [analysisFile,  OUTPUT_DIR],             'Step 3 / 3  —  Generate HTML report');

// ─── Summary ──────────────────────────────────────────────────────────────────

const elapsed = ((Date.now() - start) / 1000).toFixed(1);

const reports = fs.existsSync(path.resolve(ROOT, OUTPUT_DIR))
  ? fs.readdirSync(path.resolve(ROOT, OUTPUT_DIR))
      .filter((f) => f.startsWith('capability-matrix-') && f.endsWith('.html'))
      .sort()
      .reverse()
  : [];

console.log(`\n${'═'.repeat(64)}`);
console.log(`  Done in ${elapsed}s`);
if (reports.length) {
  const reportPath = path.resolve(ROOT, OUTPUT_DIR, reports[0]);
  console.log(`  Report : ${reportPath}`);
  console.log(`  Open   : open "${reportPath}"`);
}
console.log(`  Config : ${configFile}`);
console.log(`${'═'.repeat(64)}\n`);
