#!/usr/bin/env node
/**
 * run-analysis.js  —  Salesforce Code Analyzer Runner
 *
 * Orchestrates the full code-quality analysis pipeline, then generates a
 * text summary. Mirrors run-analysis.sh — all passes are identical.
 *
 * Prerequisites:
 *   sf plugins install code-analyzer   (if not already installed)
 *
 * Usage (from project root):
 *   node scripts/code-analyzer/run-analysis.js [--org <alias>] [--pass1-only] [--skip-summary]
 *
 * Options:
 *   --org <alias>   Salesforce org alias (uses default org if omitted)
 *   --pass1-only    Skip SFGE pass 2 (faster, no deep path analysis)
 *   --skip-summary  Skip calling parse-results.js at the end
 *   --force-app <p> Override force-app scan root (default: ./force-app/main/default)
 *
 * Outputs (all written to reports/):
 *   code-analysis.html           — Pass 1 full report
 *   code-analysis.csv            — Pass 1 raw data
 *   code-analysis-with-sfge.html — Pass 2 report (Apex + SFGE)
 *   code-analysis-with-sfge.csv  — Pass 2 raw data
 *   code-analysis-summary.txt    — Text summary (from parse-results.js)
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs                      = require('fs');
const path                    = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const ROOT        = process.cwd();
const PASS1_ONLY  = process.argv.includes('--pass1-only');
const SKIP_SUM    = process.argv.includes('--skip-summary');

function argVal(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const ORG_FLAG       = argVal('--org',       null);
const FORCE_APP_ROOT = argVal('--force-app', 'force-app/main/default');
const REPORTS_DIR    = path.resolve(ROOT, 'reports');

const SCRIPT_DIR     = path.dirname(path.resolve(process.argv[1]));
const PARSE_SCRIPT   = path.join(SCRIPT_DIR, 'parse-results.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function header(title) {
  console.log('');
  console.log('>>> ' + title);
}

function run(cmd, label, timeoutMs = 300_000) {
  header(label);
  console.log(`    ${cmd}\n`);
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit', timeout: timeoutMs });
  if (result.status !== 0) {
    console.error(`\nERROR: Command failed (exit ${result.status})`);
    process.exit(result.status || 1);
  }
}

function sfTarget(subdir) {
  return `--target ${path.join(FORCE_APP_ROOT, subdir)}`;
}

function orgFlag() {
  return ORG_FLAG ? `--target-org ${ORG_FLAG}` : '';
}

// ─── Pre-flight checks ────────────────────────────────────────────────────────

function preflight() {
  header('Checking prerequisites...');

  // sf CLI
  try {
    const out = execSync('sf version --json', { stdio: 'pipe', timeout: 10000 }).toString();
    const ver = JSON.parse(out).cliVersion || '?';
    console.log(`    sf CLI: ${ver}`);
  } catch {
    console.error("ERROR: 'sf' CLI not found. Install from https://developer.salesforce.com/tools/salesforcecli");
    process.exit(1);
  }

  // code-analyzer plugin
  try {
    execSync('sf code-analyzer run --help', { stdio: 'pipe', timeout: 10000 });
    const plugins = execSync('sf plugins', { stdio: 'pipe', timeout: 10000 }).toString();
    const caLine  = plugins.split('\n').find((l) => l.includes('code-analyzer')) || '';
    console.log(`    code-analyzer plugin: ${caLine.trim() || 'installed'}`);
  } catch {
    console.error("ERROR: 'code-analyzer' plugin not installed.");
    console.error('       Install it with: sf plugins install code-analyzer');
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const runDate = new Date().toISOString().replace('T', ' ').slice(0, 16);

  console.log('');
  console.log('========================================================');
  console.log('  Salesforce Code Analyzer');
  console.log(`  ${runDate}`);
  console.log(`  Project: ${ROOT}`);
  console.log('========================================================');

  preflight();

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  console.log(`\n>>> Output directory: ${REPORTS_DIR}/`);

  const org  = orgFlag();
  const fa   = FORCE_APP_ROOT;

  // ── PASS 1 ────────────────────────────────────────────────────────────────
  const pass1Cmd = [
    'sf code-analyzer run',
    '--workspace .',
    sfTarget('classes'),
    sfTarget('triggers'),
    sfTarget('pages'),
    sfTarget('aura'),
    sfTarget('lwc'),
    sfTarget('flows'),
    '--rule-selector Recommended',
    `--output-file ${path.join(REPORTS_DIR, 'code-analysis.html')}`,
    `--output-file ${path.join(REPORTS_DIR, 'code-analysis.csv')}`,
    '--view table',
    org,
  ].filter(Boolean).join(' \\\n    ');

  run(pass1Cmd, 'PASS 1: Recommended rules (all components — ~25-40 s)', 120_000);
  console.log('    Reports: reports/code-analysis.html');
  console.log('             reports/code-analysis.csv');

  // ── PASS 2 ────────────────────────────────────────────────────────────────
  if (!PASS1_ONLY) {
    const pass2Cmd = [
      'sf code-analyzer run',
      '--workspace .',
      sfTarget('classes'),
      sfTarget('triggers'),
      '--rule-selector Recommended',
      '--rule-selector sfge',
      `--output-file ${path.join(REPORTS_DIR, 'code-analysis-with-sfge.html')}`,
      `--output-file ${path.join(REPORTS_DIR, 'code-analysis-with-sfge.csv')}`,
      '--view table',
      org,
    ].filter(Boolean).join(' \\\n    ');

    run(pass2Cmd, 'PASS 2: Recommended + SFGE data-flow rules (Apex & Triggers — ~60-120 s)', 240_000);
    console.log('    Reports: reports/code-analysis-with-sfge.html');
    console.log('             reports/code-analysis-with-sfge.csv');
  }

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  if (!SKIP_SUM) {
    const pass2CSV = path.join(REPORTS_DIR, 'code-analysis-with-sfge.csv');
    const sumCmd   = [
      `node "${PARSE_SCRIPT}"`,
      `--pass1 "${path.join(REPORTS_DIR, 'code-analysis.csv')}"`,
      `--pass2 "${pass2CSV}"`,
      `--out   "${path.join(REPORTS_DIR, 'code-analysis-summary.txt')}"`,
    ].join(' ');
    run(sumCmd, 'Generating text summary...');
  }

  console.log('');
  console.log('========================================================');
  console.log('  Done. Open these files to review results:');
  console.log('    reports/code-analysis.html          (Pass 1 — all components)');
  if (!PASS1_ONLY) {
    console.log('    reports/code-analysis-with-sfge.html (Pass 2 — Apex + SFGE)');
  }
  if (!SKIP_SUM) {
    console.log('    reports/code-analysis-summary.txt   (Text summary)');
  }
  console.log('========================================================');
}

main();
