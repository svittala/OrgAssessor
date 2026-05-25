#!/usr/bin/env node
/**
 * analyze-permissions.js
 *
 * Analyzes Salesforce profiles and permission sets for excessive or dangerous
 * permissions. Mirrors analyze_permissions.py exactly.
 *
 * Checks:
 *   1. System-level userPermissions (ViewAllData, ModifyAllData, ManageUsers…)
 *   2. Object-level viewAllRecords / modifyAllRecords grants
 *   3. Dangerous combinations (e.g. AuthorApex + ModifyAllData)
 *
 * Outputs (written to <project-root>/reports/):
 *   permission-analysis-results.csv    — every individual finding (one row each)
 *   permission-analysis-summary.csv    — one row per profile/permset with risk score
 *   permission-analysis-summary.txt    — human-readable ranked report
 *
 * Usage (from any directory):
 *   node scripts/code-analyzer/analyze-permissions.js [--csv-only] [--quiet] [--force-app <path>]
 *
 * Options:
 *   --csv-only        Write files but suppress console output
 *   --quiet           Suppress per-component detail; show top-10 table only
 *   --force-app <p>   Path to force-app root (default: ./force-app/main/default)
 *   --reports <p>     Output directory (default: ./reports)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const ROOT       = process.cwd();
const CSV_ONLY   = process.argv.includes('--csv-only');
const QUIET      = process.argv.includes('--quiet');

function argVal(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const SOURCE_ROOT  = path.resolve(ROOT, argVal('--force-app', 'force-app/main/default'));
const REPORTS_DIR  = path.resolve(ROOT, argVal('--reports', 'reports'));
const PROFILES_DIR = path.join(SOURCE_ROOT, 'profiles');
const PERMSETS_DIR = path.join(SOURCE_ROOT, 'permissionsets');

const OUT_FINDINGS    = path.join(REPORTS_DIR, 'permission-analysis-results.csv');
const OUT_SUMMARY_CSV = path.join(REPORTS_DIR, 'permission-analysis-summary.csv');
const OUT_SUMMARY_TXT = path.join(REPORTS_DIR, 'permission-analysis-summary.txt');

// ─── Risk catalogue ───────────────────────────────────────────────────────────

const SYSTEM_PERMISSIONS = {
  // Critical
  ViewAllData:                  [1, 'View All Data — can read every record in the org regardless of sharing'],
  ModifyAllData:                [1, 'Modify All Data — can create, edit, delete every record in the org'],
  ManageUsers:                  [1, 'Manage Users — can create/edit/deactivate any user and assign any profile'],
  ManageProfilesPermissionsets: [1, 'Manage Profiles & Permission Sets — can escalate any user\'s privileges'],
  ResetPasswords:               [1, 'Reset Passwords & Unlock Users — can take over any user account'],
  // High
  AuthorApex:                   [2, 'Author Apex — can execute arbitrary server-side code'],
  ManageEncryptionKeys:         [2, 'Manage Encryption Keys — can access Shield Platform Encryption keys'],
  ViewEncryptedData:            [2, 'View Encrypted Data — can read Shield-encrypted field values'],
  BulkApiHardDelete:            [2, 'Bulk API Hard Delete — can permanently destroy records bypassing Recycle Bin'],
  DataExport:                   [2, 'Data Export — can export the full org dataset'],
  QueryAllFiles:                [2, 'Query All Files — can read all files/ContentDocument regardless of sharing'],
  ManageSandboxes:              [2, 'Manage Sandboxes — can create sandboxes that copy production data'],
  InstallPackaging:             [2, 'Download AppExchange Packages — can install arbitrary third-party code'],
  ManageTranslation:            [2, 'Manage Translation — can modify all translated labels org-wide'],
  ViewAllUsers:                 [2, 'View All Users — can see all users including deactivated'],
  ManageDataIntegrations:       [2, 'Manage Data Integrations — can configure and run data integrations'],
  // Medium
  EditPublicReports:            [3, 'Create & Customize Reports — can create reports across all visible data'],
  ManageReports:                [3, 'Manage Reports — can create/edit/delete all public reports'],
  EditPublicDashboards:         [3, 'Create Public Dashboards — can publish dashboards to all users'],
  ManageDashboards:             [3, 'Manage Dashboards — can create/edit/delete all dashboards'],
  RunReports:                   [3, 'Run Reports — can run any report they have access to'],
  ScheduleReports:              [3, 'Schedule Reports — can schedule report delivery to any user'],
  ManageCustomPermissions:      [3, 'Manage Custom Permissions — can assign custom permissions to any perm set'],
  FlowUFLRequired:              [3, 'Flow User — can run flows that may modify data'],
  ManageFlows:                  [3, 'Manage Flows — can create/edit/delete any flow'],
  ConvertLeads:                 [3, 'Convert Leads — can convert leads creating Account/Contact/Opportunity'],
  TransferAnyEntity:            [3, 'Transfer Record — can transfer ownership of any record'],
  TransferAnyLead:              [3, 'Transfer Leads — can transfer any lead to any user'],
  MassInlineEdit:               [3, 'Mass Inline Edit — can bulk-edit records in list views'],
  ViewSetup:                    [3, 'View Setup & Configuration — can read all setup metadata'],
};

const DANGEROUS_COMBOS = [
  [new Set(['AuthorApex', 'ModifyAllData']),               1, 'AuthorApex + ModifyAllData: can write arbitrary code that modifies every record'],
  [new Set(['ManageUsers', 'ResetPasswords']),              1, 'ManageUsers + ResetPasswords: can fully take over any user account'],
  [new Set(['ViewAllData', 'DataExport']),                  1, 'ViewAllData + DataExport: can exfiltrate the entire org dataset'],
  [new Set(['ManageProfilesPermissionsets', 'ManageUsers']),1, 'ManageProfiles + ManageUsers: full privilege escalation path'],
  [new Set(['AuthorApex', 'ViewAllData']),                  2, 'AuthorApex + ViewAllData: code can silently read all records'],
  [new Set(['BulkApiHardDelete', 'ModifyAllData']),         2, 'BulkApiHardDelete + ModifyAllData: can permanently destroy all data'],
  [new Set(['ManageEncryptionKeys', 'ViewEncryptedData']),  2, 'ManageEncryptionKeys + ViewEncryptedData: full access to encrypted data'],
  [new Set(['InstallPackaging', 'ModifyAllData']),           2, 'InstallPackaging + ModifyAllData: third-party code with unrestricted DML'],
];

const RISK_LABEL = { 1: 'CRITICAL', 2: 'HIGH', 3: 'MEDIUM' };
const RISK_SCORE = { 1: 10, 2: 4, 3: 1 };

// ─── XML helpers ──────────────────────────────────────────────────────────────

const NS_PREFIX = 'http://soap.sforce.com/2006/04/metadata';

/** Minimal XML value extractor — no external parser needed. */
function xmlTagFirst(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m  = xml.match(re);
  return m ? m[1].trim() : null;
}

function xmlTagAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

function getEnabledUserPermissions(xml) {
  const enabled = new Set();
  const blocks  = xmlTagAll(xml, 'userPermissions');
  blocks.forEach((block) => {
    const isEnabled = xmlTagFirst(block, 'enabled');
    const name      = xmlTagFirst(block, 'name');
    if (isEnabled && isEnabled.toLowerCase() === 'true' && name) {
      enabled.add(name);
    }
  });
  return enabled;
}

function getObjectPermissions(xml) {
  const results = [];
  const blocks  = xmlTagAll(xml, 'objectPermissions');
  blocks.forEach((block) => {
    const obj      = xmlTagFirst(block, 'object');
    const viewAll  = xmlTagFirst(block, 'viewAllRecords')  === 'true';
    const modAll   = xmlTagFirst(block, 'modifyAllRecords') === 'true';
    if (obj && (viewAll || modAll)) {
      results.push({ object: obj, viewAll, modifyAll: modAll });
    }
  });
  return results;
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

function analyzeFile(filePath) {
  const xml      = fs.readFileSync(filePath, 'utf8');
  const isProfile = xml.includes('<Profile ') || xml.includes('<Profile>');
  const metaType  = isProfile ? 'Profile' : 'PermissionSet';
  const name      = path.basename(filePath)
    .replace('.profile-meta.xml', '')
    .replace('.permissionset-meta.xml', '');

  const enabledPerms = getEnabledUserPermissions(xml);
  const objPerms     = getObjectPermissions(xml);

  const findings   = [];
  let   riskScore  = 0;

  Object.entries(SYSTEM_PERMISSIONS).forEach(([perm, [risk, desc]]) => {
    if (enabledPerms.has(perm)) {
      findings.push({ type: 'SystemPermission', permission: perm,
        risk: RISK_LABEL[risk], riskLevel: risk, detail: desc, object: '' });
      riskScore += RISK_SCORE[risk];
    }
  });

  objPerms.forEach((op) => {
    if (op.modifyAll) {
      findings.push({ type: 'ObjectPermission', permission: 'modifyAllRecords',
        risk: 'HIGH', riskLevel: 2,
        detail: `Modify All Records on ${op.object}`, object: op.object });
      riskScore += RISK_SCORE[2];
    } else if (op.viewAll) {
      findings.push({ type: 'ObjectPermission', permission: 'viewAllRecords',
        risk: 'MEDIUM', riskLevel: 3,
        detail: `View All Records on ${op.object}`, object: op.object });
      riskScore += RISK_SCORE[3];
    }
  });

  const combos = [];
  DANGEROUS_COMBOS.forEach(([permSet, risk, desc]) => {
    const allPresent = [...permSet].every((p) => enabledPerms.has(p));
    if (allPresent) {
      combos.push({ type: 'DangerousCombo',
        permission: [...permSet].sort().join(' + '),
        risk: RISK_LABEL[risk], riskLevel: risk, detail: desc, object: '' });
      riskScore += RISK_SCORE[risk] * 2; // combos weighted double
    }
  });

  return { name, metaType, findings, combos, riskScore, enabledPerms, objPerms };
}

function overallRisk(score) {
  if (score >= 20) return 'CRITICAL';
  if (score >= 10) return 'HIGH';
  if (score >= 3)  return 'MEDIUM';
  return 'LOW';
}

// ─── Reporter ─────────────────────────────────────────────────────────────────

class Reporter {
  constructor(txtPath, silent = false) {
    this._silent = silent;
    this._fh     = fs.openSync(txtPath, 'w');
  }
  write(line = '') {
    if (!this._silent) console.log(line);
    fs.writeSync(this._fh, line + '\n');
  }
  close() { fs.closeSync(this._fh); }
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function csvEscape(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCSV(filePath, headers, rows) {
  const lines = [headers.join(',')];
  rows.forEach((row) => lines.push(headers.map((h) => csvEscape(row[h] ?? '')).join(',')));
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  // Scan all profiles and permission sets
  const allResults = [];
  const dirs = [
    [PROFILES_DIR,  '*.profile-meta.xml'],
    [PERMSETS_DIR,  '*.permissionset-meta.xml'],
  ];

  dirs.forEach(([dir]) => {
    if (!fs.existsSync(dir)) {
      console.warn(`WARNING: directory not found — ${dir}`);
      return;
    }
    fs.readdirSync(dir)
      .filter((f) => f.endsWith('.profile-meta.xml') || f.endsWith('.permissionset-meta.xml'))
      .sort()
      .forEach((f) => allResults.push(analyzeFile(path.join(dir, f))));
  });

  allResults.sort((a, b) => b.riskScore - a.riskScore);

  // ── Text report ─────────────────────────────────────────────────────────────
  const rpt    = new Reporter(OUT_SUMMARY_TXT, CSV_ONLY);
  const runTs  = new Date().toISOString().replace('T', ' ').slice(0, 16);

  const critical = allResults.filter((r) => overallRisk(r.riskScore) === 'CRITICAL');
  const high     = allResults.filter((r) => overallRisk(r.riskScore) === 'HIGH');
  const medium   = allResults.filter((r) => overallRisk(r.riskScore) === 'MEDIUM');
  const low      = allResults.filter((r) => overallRisk(r.riskScore) === 'LOW');

  rpt.write(`\n${'='.repeat(72)}`);
  rpt.write('  PERMISSION ANALYSIS');
  rpt.write(`  ${runTs}  |  Project: ${ROOT}`);
  rpt.write(`  ${allResults.length} profiles/permission-sets scanned`);
  rpt.write('='.repeat(72));
  rpt.write(`\n  CRITICAL: ${critical.length}   HIGH: ${high.length}   MEDIUM: ${medium.length}   LOW (clean): ${low.length}\n`);

  if (!QUIET) {
    allResults.forEach((result) => {
      if (!result.findings.length && !result.combos.length) return;
      const risk = overallRisk(result.riskScore);
      rpt.write(`\n${'─'.repeat(72)}`);
      rpt.write(`  [${risk}]  ${result.name}  (${result.metaType})  score=${result.riskScore}`);
      rpt.write('─'.repeat(72));

      result.combos.sort((a, b) => a.riskLevel - b.riskLevel).forEach((c) => {
        rpt.write(`  !! COMBO [${c.risk}]  ${c.permission}`);
        rpt.write(`     ${c.detail}`);
      });

      result.findings
        .filter((f) => f.type === 'SystemPermission')
        .sort((a, b) => a.riskLevel - b.riskLevel)
        .forEach((f) => {
          rpt.write(`  >> [${f.risk.padEnd(8)}]  ${f.permission}`);
          rpt.write(`     ${f.detail}`);
        });

      const modAll  = result.findings.filter((f) => f.type === 'ObjectPermission' && f.permission === 'modifyAllRecords');
      const viewAll = result.findings.filter((f) => f.type === 'ObjectPermission' && f.permission === 'viewAllRecords');
      if (modAll.length)  rpt.write(`  >> [HIGH    ]  modifyAllRecords on ${modAll.length} object(s): ${modAll.map((f) => f.object).join(', ')}`);
      if (viewAll.length) rpt.write(`  >> [MEDIUM  ]  viewAllRecords on ${viewAll.length} object(s): ${viewAll.map((f) => f.object).join(', ')}`);
    });
  }

  rpt.write(`\n${'='.repeat(72)}`);
  rpt.write('  TOP 10 RISKIEST COMPONENTS');
  rpt.write('='.repeat(72));
  rpt.write(`  ${'Rank'.padEnd(5)} ${'Overall'.padEnd(10)} ${'Score'.padEnd(7)} ${'Type'.padEnd(14)} Name`);
  rpt.write(`  ${'─'.repeat(4)} ${'─'.repeat(9)} ${'─'.repeat(6)} ${'─'.repeat(13)} ${'─'.repeat(40)}`);
  allResults.slice(0, 10).forEach((r, i) => {
    rpt.write(`  ${String(i + 1).padEnd(5)} ${overallRisk(r.riskScore).padEnd(10)} ${String(r.riskScore).padEnd(7)} ${r.metaType.padEnd(14)} ${r.name}`);
  });

  // ── CSV: findings ────────────────────────────────────────────────────────────
  const findingsRows = [];
  const summaryRows  = [];

  allResults.forEach((result) => {
    const risk = overallRisk(result.riskScore);

    summaryRows.push({
      name:              result.name,
      type:              result.metaType,
      overall_risk:      risk,
      risk_score:        result.riskScore,
      system_perm_count: result.findings.filter((f) => f.type === 'SystemPermission').length,
      critical_perms:    result.findings.filter((f) => f.riskLevel === 1).length,
      high_perms:        result.findings.filter((f) => f.riskLevel === 2).length,
      medium_perms:      result.findings.filter((f) => f.riskLevel === 3).length,
      obj_modify_all:    result.findings.filter((f) => f.type === 'ObjectPermission' && f.permission === 'modifyAllRecords').length,
      obj_view_all:      result.findings.filter((f) => f.type === 'ObjectPermission' && f.permission === 'viewAllRecords').length,
      dangerous_combos:  result.combos.length,
      view_all_data:     result.enabledPerms.has('ViewAllData'),
      modify_all_data:   result.enabledPerms.has('ModifyAllData'),
      manage_users:      result.enabledPerms.has('ManageUsers'),
      author_apex:       result.enabledPerms.has('AuthorApex'),
    });

    [...result.findings, ...result.combos].forEach((f) => {
      findingsRows.push({
        name: result.name, type: result.metaType, overall_risk: risk,
        finding_type: f.type, permission: f.permission,
        risk: f.risk, object: f.object || '', detail: f.detail,
      });
    });
  });

  writeCSV(OUT_FINDINGS, [
    'name', 'type', 'overall_risk', 'finding_type', 'permission', 'risk', 'object', 'detail',
  ], findingsRows);

  writeCSV(OUT_SUMMARY_CSV, [
    'name', 'type', 'overall_risk', 'risk_score',
    'system_perm_count', 'critical_perms', 'high_perms', 'medium_perms',
    'obj_modify_all', 'obj_view_all', 'dangerous_combos',
    'view_all_data', 'modify_all_data', 'manage_users', 'author_apex',
  ], summaryRows);

  rpt.write(`\n${'='.repeat(72)}`);
  rpt.write(`  Reports written to: ${REPORTS_DIR}/`);
  rpt.write(`  ${'─'.repeat(68)}`);
  rpt.write(`  permission-analysis-results.csv     ${String(findingsRows.length).padStart(5)} findings`);
  rpt.write(`  permission-analysis-summary.csv     ${String(summaryRows.length).padStart(5)} components`);
  rpt.write('  permission-analysis-summary.txt           (this file)');
  rpt.write('='.repeat(72) + '\n');

  rpt.close();
}

run();
