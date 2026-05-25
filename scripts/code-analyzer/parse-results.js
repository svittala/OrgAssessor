#!/usr/bin/env node
/**
 * parse-results.js  —  Code Analyzer Results Parser
 *
 * Reads the two CSV output files from run-analysis.js (or run-analysis.sh)
 * and prints a structured violation summary to the terminal and optionally
 * to a text file.
 *
 * Usage:
 *   node scripts/code-analyzer/parse-results.js \
 *     --pass1 reports/code-analysis.csv \
 *     --pass2 reports/code-analysis-with-sfge.csv \
 *     --out   reports/code-analysis-summary.txt
 *
 * Defaults:
 *   --pass1  reports/code-analysis.csv
 *   --pass2  reports/code-analysis-with-sfge.csv
 *   --out    reports/code-analysis-summary.txt
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

function arg(name, def) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : def;
}

const PASS1_FILE = path.resolve(ROOT, arg('--pass1', 'reports/code-analysis.csv'));
const PASS2_FILE = path.resolve(ROOT, arg('--pass2', 'reports/code-analysis-with-sfge.csv'));
const OUT_FILE   = arg('--out', null) ? path.resolve(ROOT, arg('--out', null)) : null;

// ─── CSV Parser ───────────────────────────────────────────────────────────────

function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const text  = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const headers = splitCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCSVLine(line);
    const row = {};
    headers.forEach((h, j) => { row[h.trim()] = (values[j] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEV_LABEL = { '1': 'Critical', '2': 'High', '3': 'Moderate', '4': 'Low', '5': 'Info' };
const SEV_ORDER = ['Critical', 'High', 'Moderate', 'Low', 'Info'];

const SCOPE_MAP = {
  pmd:         'Apex, VF Pages',
  regex:       'All file types',
  flow:        'Flows',
  eslint:      'LWC, Aura JS',
  cpd:         'Apex (copy-paste)',
  'retire-js': 'JS (security)',
  sfge:        'Apex (path analysis)',
};

function componentType(filePath) {
  if (filePath.includes('/classes/'))  return 'Apex Classes';
  if (filePath.includes('/triggers/')) return 'Triggers';
  if (filePath.includes('/pages/'))    return 'Visualforce Pages';
  if (filePath.includes('/aura/'))     return 'Aura';
  if (filePath.includes('/lwc/'))      return 'LWC';
  if (filePath.includes('/flows/'))    return 'Flows';
  return 'Other';
}

function bar(n, total, width = 30) {
  const filled = total ? Math.round(n / total * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function section(title, lines) {
  const border = '─'.repeat(60);
  return ['', border, `  ${title}`, border, ...lines];
}

function counter(rows, key) {
  const map = {};
  rows.forEach((r) => { const v = r[key] || '?'; map[v] = (map[v] || 0) + 1; });
  return map;
}

function topN(map, n) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ─── Summary Builder ──────────────────────────────────────────────────────────

function summarise(pass1Rows, pass2Rows) {
  const out = [];

  const sfgeRows    = pass2Rows.filter((r) => r.engine === 'sfge');
  const combinedTotal = pass1Rows.length + sfgeRows.length;
  const combinedHigh  = pass1Rows.filter((r) => r.severity === '2').length +
                        sfgeRows.filter((r) => r.severity === '2').length;
  const combinedMod   = pass1Rows.filter((r) => r.severity === '3').length +
                        sfgeRows.filter((r) => r.severity === '3').length;
  const files1 = new Set(pass1Rows.map((r) => r.file)).size;
  const files2 = new Set(sfgeRows.map((r) => r.file)).size;

  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

  out.push(
    '════════════════════════════════════════════════════════════',
    '  Salesforce Code Analyzer Summary',
    `  Generated: ${now}`,
    '════════════════════════════════════════════════════════════',
    '',
    '  Two passes were run:',
    '  Pass 1 — Recommended rules, all component types',
    '  Pass 2 — Recommended + SFGE (data-flow), Apex/Triggers only',
  );

  // Combined totals
  out.push(...section('COMBINED TOTALS', [
    `  Total violations : ${combinedTotal.toLocaleString()}`,
    `  Files affected   : ${(files1 + files2).toLocaleString()}`,
    `  High severity    : ${combinedHigh.toLocaleString()}`,
    `  Moderate severity: ${combinedMod.toLocaleString()}`,
    `  SFGE-only (new)  : ${sfgeRows.length}  ← not in Pass 1`,
  ]));

  // Pass 1 by severity
  const bySev   = counter(pass1Rows, 'severity');
  const total1  = pass1Rows.length;
  const sevLines = [
    `  ${'Severity'.padEnd(12)} ${'Count'.padStart(6)}   ${'Bar'.padEnd(30)}  ${'Pct'.padStart(5)}`,
    `  ${'─'.repeat(12)} ${'─'.repeat(6)}   ${'─'.repeat(30)}  ${'─'.repeat(5)}`,
  ];
  SEV_ORDER.forEach((label) => {
    const key = Object.keys(SEV_LABEL).find((k) => SEV_LABEL[k] === label);
    const n   = bySev[key] || 0;
    if (n) sevLines.push(`  ${label.padEnd(12)} ${String(n).padStart(6)}   ${bar(n, total1).padEnd(30)}  ${(n / total1 * 100).toFixed(1).padStart(4)}%`);
  });
  out.push(...section('PASS 1 — By Severity', sevLines));

  // Pass 1 by engine
  const byEng    = counter(pass1Rows, 'engine');
  const engLines = [
    `  ${'Engine'.padEnd(12)} ${'Total'.padStart(6)}  ${'High'.padStart(6)}  ${'Moderate'.padStart(8)}  Scope`,
    `  ${'─'.repeat(12)} ${'─'.repeat(6)}  ${'─'.repeat(6)}  ${'─'.repeat(8)}  ${'─'.repeat(20)}`,
  ];
  topN(byEng, 10).forEach(([eng, n]) => {
    const high  = pass1Rows.filter((r) => r.engine === eng && r.severity === '2').length;
    const mod   = pass1Rows.filter((r) => r.engine === eng && r.severity === '3').length;
    const scope = SCOPE_MAP[eng] || '';
    engLines.push(`  ${eng.padEnd(12)} ${String(n).padStart(6)}  ${String(high).padStart(6)}  ${String(mod).padStart(8)}  ${scope}`);
  });
  out.push(...section('PASS 1 — By Engine', engLines));

  // Pass 1 by component type
  const byComp   = counter(pass1Rows.map((r) => ({ ...r, _comp: componentType(r.file || '') })), '_comp');
  const compLines = [
    `  ${'Component'.padEnd(22)} ${'Count'.padStart(6)}   Bar`,
    `  ${'─'.repeat(22)} ${'─'.repeat(6)}   ${'─'.repeat(30)}`,
  ];
  topN(byComp, 10).forEach(([comp, n]) => {
    compLines.push(`  ${comp.padEnd(22)} ${String(n).padStart(6)}   ${bar(n, total1)}`);
  });
  out.push(...section('PASS 1 — By Component Type', compLines));

  // Pass 1 top 15 rules
  const byRule   = counter(pass1Rows, 'rule');
  const ruleLines = [
    `  ${'#'.padStart(3)}  ${'Rule'.padEnd(50)} ${'Sev'.padStart(3)}  ${'Count'.padStart(6)}`,
    `  ${'─'.repeat(3)}  ${'─'.repeat(50)} ${'─'.repeat(3)}  ${'─'.repeat(6)}`,
  ];
  topN(byRule, 15).forEach(([rule, n], i) => {
    const sample  = pass1Rows.find((r) => r.rule === rule);
    const sevChar = sample ? (SEV_LABEL[sample.severity] || '?')[0] : '?';
    ruleLines.push(`  ${String(i + 1).padStart(3)}  ${rule.padEnd(50)} ${sevChar.padStart(3)}  ${String(n).padStart(6)}`);
  });
  out.push(...section('PASS 1 — Top 15 Rules by Count', ruleLines));

  // SFGE findings
  if (sfgeRows.length) {
    const sfgeByRule = counter(sfgeRows, 'rule');
    const sfgeHigh   = sfgeRows.filter((r) => r.severity === '2').length;
    const sfgeMod    = sfgeRows.filter((r) => r.severity === '3').length;
    const sfgeLines  = [
      `  Total SFGE violations: ${sfgeRows.length} (${sfgeHigh} High, ${sfgeMod} Moderate)`,
      '',
      `  ${'Rule'.padEnd(50)} ${'Sev'.padStart(3)}  ${'Count'.padStart(6)}`,
      `  ${'─'.repeat(50)} ${'─'.repeat(3)}  ${'─'.repeat(6)}`,
    ];
    topN(sfgeByRule, 20).forEach(([rule, n]) => {
      const sample  = sfgeRows.find((r) => r.rule === rule);
      const sevChar = sample ? (SEV_LABEL[sample.severity] || '?')[0] : '?';
      sfgeLines.push(`  ${rule.padEnd(50)} ${sevChar.padStart(3)}  ${String(n).padStart(6)}`);
    });
    sfgeLines.push('', '  Top files with SFGE violations:');
    const sfgeByFile = counter(sfgeRows.map((r) => ({ ...r, _f: (r.file || '').split('/').pop() })), '_f');
    topN(sfgeByFile, 10).forEach(([fname, n]) => {
      sfgeLines.push(`    ${fname.padEnd(45)} ${String(n).padStart(3)}`);
    });
    out.push(...section('PASS 2 — SFGE (Salesforce Graph Engine) — NEW violations', sfgeLines));
  } else {
    out.push(...section('PASS 2 — SFGE', ['  No SFGE violations found, or SFGE CSV not provided.']));
  }

  // Top 10 files overall
  const allRows   = [...pass1Rows, ...sfgeRows];
  const byFile    = counter(allRows.map((r) => ({ ...r, _f: (r.file || '').split('/').pop() })), '_f');
  const fileLines = [
    `  ${'File'.padEnd(50)} ${'Violations'.padStart(10)}`,
    `  ${'─'.repeat(50)} ${'─'.repeat(10)}`,
  ];
  topN(byFile, 10).forEach(([fname, n]) => {
    fileLines.push(`  ${fname.padEnd(50)} ${String(n).padStart(10)}`);
  });
  out.push(...section('TOP 10 FILES BY VIOLATION COUNT (combined)', fileLines));

  // Remediation guide
  out.push(...section('RECOMMENDED REMEDIATION ORDER', [
    '',
    '  Priority 1 — Security (SFGE findings, fix immediately)',
    '    ApexFlsViolation              → add stripInaccessible() or WITH SECURITY_ENFORCED',
    '    DatabaseOperationsMustUseWithSharing → change class to "with sharing"',
    '    AvoidDatabaseOperationInLoop  → move SOQL outside loops, use bulk queries',
    '',
    '  Priority 2 — Security (PMD/Flow)',
    '    PreventPassingUserDataIntoElementWithoutSharing → add sharing to Flows',
    '    ApexCRUDViolation             → add isAccessible()/isUpdateable() CRUD checks',
    '    AvoidHardcodingId             → use Custom Metadata or Custom Settings',
    '    AvoidOldSalesforceApiVersions → update metadata to API 63.0+',
    '',
    '  Priority 3 — Reliability',
    '    MissingNullCheckOnSoqlVariable → null-check after single-row SOQL',
    '    SameRecordUpdate (flows)      → consolidate updates in Flow elements',
    '    AvoidDebugStatements          → remove or guard System.debug() calls',
    '',
    '  Priority 4 — Quality & Formatting (autofix)',
    '    NoTrailingWhitespace          → run: npm run prettier',
    '    NoMixedIndentation            → run: npm run prettier',
    '    ApexUnitTestClassShouldHaveRunAs → wrap tests in System.runAs()',
  ]));

  out.push('', '═'.repeat(60), '  End of report', '═'.repeat(60), '');
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  if (!fs.existsSync(PASS1_FILE)) {
    console.error(`ERROR: Pass 1 CSV not found: ${PASS1_FILE}`);
    console.error('Run the code analyzer first to generate this file.');
    process.exit(1);
  }

  const pass1Rows = parseCSV(PASS1_FILE);
  const pass2Rows = fs.existsSync(PASS2_FILE) ? parseCSV(PASS2_FILE) : [];

  if (!fs.existsSync(PASS2_FILE)) {
    console.warn(`WARNING: Pass 2 CSV not found: ${PASS2_FILE} — SFGE section will be empty.`);
  }

  const lines  = summarise(pass1Rows, pass2Rows);
  const output = lines.join('\n');

  console.log(output);

  if (OUT_FILE) {
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, output, 'utf8');
    console.log(`\nSummary written to: ${OUT_FILE}`);
  }
}

run();
