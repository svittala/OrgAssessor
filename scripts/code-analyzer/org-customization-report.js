#!/usr/bin/env node
/**
 * org-customization-report.js
 *
 * Queries a connected Salesforce org via `sf org list metadata` for each
 * standard metadata type and generates a self-contained HTML report.
 * Mirrors the logic embedded in org-customization-report.sh.
 *
 * Prerequisites:
 *   sf CLI authenticated to a default org (sf org login web / sf org login jwt)
 *
 * Usage (from project root):
 *   node scripts/code-analyzer/org-customization-report.js [--org <alias>] [--out <path>]
 *
 * Options:
 *   --org <alias>   Salesforce org alias or username (uses default if omitted)
 *   --out <path>    Output HTML path (default: reports/org-customization-report.html)
 *   --quiet         Suppress per-type progress lines
 */

'use strict';

const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const ROOT  = process.cwd();
const QUIET = process.argv.includes('--quiet');

function argVal(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const ORG_FLAG   = argVal('--org', null);
const OUT_FILE   = path.resolve(ROOT, argVal('--out', 'reports/org-customization-report.html'));

// ─── Metadata types to query ──────────────────────────────────────────────────

const METADATA_TYPES = [
  { apiName: 'CustomObject',             displayName: 'Custom Objects',            category: 'Data Model',       filter: (n) => n.endsWith('__c') },
  { apiName: 'ApexClass',                displayName: 'Apex Classes',              category: 'Business Logic',   filter: null },
  { apiName: 'Flow',                     displayName: 'Flows',                     category: 'Automation',       filter: null },
  { apiName: 'LightningComponentBundle', displayName: 'Lightning Web Components',  category: 'Modern UI',        filter: null },
  { apiName: 'AuraDefinitionBundle',     displayName: 'Aura Components',           category: 'Component Framework', filter: null },
  { apiName: 'ApexPage',                 displayName: 'Visualforce Pages',         category: 'Legacy UI',        filter: null },
  { apiName: 'ApexComponent',            displayName: 'Visualforce Components',    category: 'Reusable UI',      filter: null },
  { apiName: 'ApexTrigger',              displayName: 'Apex Triggers',             category: 'Event Handling',   filter: null },
  { apiName: 'Layout',                   displayName: 'Custom Layouts',            category: 'UI Configuration', filter: null },
  { apiName: 'PermissionSet',            displayName: 'Permission Sets',           category: 'Access Control',   filter: null },
  { apiName: 'CustomTab',                displayName: 'Custom Tabs',               category: 'Navigation',       filter: null },
  { apiName: 'CustomMetadata',           displayName: 'Custom Metadata',           category: 'Configuration Data', filter: null },
  { apiName: 'StaticResource',           displayName: 'Static Resources',          category: 'Assets',           filter: null },
];

// ─── SF CLI query ─────────────────────────────────────────────────────────────

function getMetadataInfo(apiName, filterFn) {
  try {
    const orgArg = ORG_FLAG ? `--target-org ${ORG_FLAG}` : '';
    const cmd    = `sf org list metadata --metadata-type ${apiName} ${orgArg} --json 2>/dev/null`;
    const stdout = execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }).toString();
    const data   = JSON.parse(stdout);
    let items    = data.result || [];
    if (filterFn) items = items.filter((item) => filterFn(item.fullName || ''));
    const names = items.map((item) => item.fullName || '').filter(Boolean).sort();
    return { count: names.length, items: names };
  } catch {
    return { count: 0, items: [] };
  }
}

// ─── HTML generation ──────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function itemsListHTML(items) {
  if (!items.length) return '<li>No items found</li>';
  return items.map((item) => `<li>${esc(item)}</li>`).join('\n');
}

function buildHTML(metaInfo, totalComponents, timestamp, orgLabel) {
  let customizationLevel, color;
  if (totalComponents < 10)       { customizationLevel = 'Low';    color = '#90EE90'; }
  else if (totalComponents < 50)  { customizationLevel = 'Medium'; color = '#FFD700'; }
  else                            { customizationLevel = 'High';   color = '#FF6B6B'; }

  const metricCards = {
    'Core Customization Metrics': ['CustomObject', 'ApexClass', 'Flow', 'ApexTrigger'],
    'User Interface Components':  ['LightningComponentBundle', 'AuraDefinitionBundle', 'ApexPage', 'ApexComponent'],
    'Configuration & Setup':      ['Layout', 'PermissionSet', 'CustomTab', 'CustomMetadata'],
    'Resources':                  ['StaticResource'],
  };

  const sectionIcons = {
    CustomObject:             '📦',
    ApexClass:                '⚙️',
    Flow:                     '🔄',
    LightningComponentBundle: '⚡',
    AuraDefinitionBundle:     '🎨',
    ApexPage:                 '📄',
    ApexComponent:            '🔧',
    ApexTrigger:              '🎯',
    Layout:                   '📋',
    PermissionSet:            '🔐',
    CustomTab:                '📑',
    CustomMetadata:           '⚙️',
    StaticResource:           '📦',
  };

  const metricsHTML = Object.entries(metricCards).map(([sectionTitle, keys]) => {
    const cards = keys.map((k) => {
      const t = METADATA_TYPES.find((m) => m.apiName === k);
      const d = metaInfo[k];
      return `<div class="metric-card"><h3>${esc(t.displayName)}</h3><div class="number">${d.count}</div><div class="category">${esc(t.category)}</div></div>`;
    }).join('\n');
    return `<h2 class="section-title">${esc(sectionTitle)}</h2><div class="metrics">${cards}</div>`;
  }).join('\n');

  const detailsHTML = METADATA_TYPES.map((t) => {
    const d    = metaInfo[t.apiName];
    const icon = sectionIcons[t.apiName] || '📌';
    return `
      <div class="metadata-section">
        <div class="section-header"><h3>${icon} ${esc(t.displayName)}</h3><span class="count-badge">${d.count}</span></div>
        <div class="items-list"><ul>${itemsListHTML(d.items)}</ul></div>
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Org Customization Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; min-height: 100vh; }
    .container { max-width: 1000px; margin: 0 auto; background: white; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,.3); overflow: hidden; }
    header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 30px; text-align: center; }
    header h1 { font-size: 2.5em; margin-bottom: 10px; }
    header p  { font-size: .95em; opacity: .9; }
    .content  { padding: 30px; }
    .info-grid { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 30px; display: grid; grid-template-columns: repeat(2,1fr); gap: 10px; }
    .info-item { padding: 10px; }
    .info-item strong { color: #667eea; }
    .summary-box { border-left: 5px solid #667eea; padding: 20px; border-radius: 5px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; background: ${color}; }
    .summary-box h2 { font-size: 1.5em; color: #333; }
    .summary-box .level-badge { background: white; padding: 10px 20px; border-radius: 20px; font-weight: bold; color: #667eea; font-size: 1.1em; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: 20px; margin-bottom: 20px; }
    .metric-card { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; text-align: center; }
    .metric-card h3 { color: #667eea; margin-bottom: 10px; font-size: .9em; text-transform: uppercase; font-weight: 600; }
    .metric-card .number { font-size: 2.5em; color: #333; font-weight: bold; margin: 15px 0; }
    .metric-card .category { color: #999; font-size: .85em; }
    .section-title { font-size: 1.3em; color: #333; margin: 30px 0 20px 0; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
    .items-list { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 5px; padding: 15px; margin-top: 10px; max-height: 400px; overflow-y: auto; }
    .items-list ul { list-style: none; }
    .items-list li { padding: 8px 0; border-bottom: 1px solid #e0e0e0; font-size: .9em; color: #555; }
    .items-list li:last-child { border-bottom: none; }
    .items-list li::before { content: "▸ "; color: #667eea; font-weight: bold; margin-right: 8px; }
    .metadata-section { margin-bottom: 30px; padding-bottom: 30px; border-bottom: 1px solid #e0e0e0; }
    .metadata-section:last-child { border-bottom: none; }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .section-header h3 { margin: 0; color: #667eea; font-size: 1.1em; }
    .count-badge { background: #667eea; color: white; padding: 5px 10px; border-radius: 15px; font-size: .9em; font-weight: bold; }
    footer { background: #f8f9fa; padding: 20px; text-align: center; color: #999; border-top: 1px solid #e0e0e0; font-size: .9em; }
    .recommendation { background: #e3f2fd; border-left: 4px solid #2196F3; padding: 15px; border-radius: 4px; margin-top: 20px; color: #1565c0; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔍 Org Customization Report</h1>
      <p>Comprehensive Metadata Assessment</p>
    </header>
    <div class="content">
      <div class="info-grid">
        <div class="info-item"><strong>Report Generated:</strong> ${esc(timestamp)}</div>
        <div class="info-item"><strong>Target Org:</strong> ${esc(orgLabel)}</div>
        <div class="info-item"><strong>Total Custom Components:</strong> ${totalComponents}</div>
        <div class="info-item"><strong>Customization Level:</strong> <span style="color:#667eea;font-weight:bold;">${esc(customizationLevel)}</span></div>
      </div>
      <div class="summary-box">
        <div>
          <h2>Overall Customization Score</h2>
          <p>Total custom metadata components detected in your org</p>
        </div>
        <div class="level-badge">${totalComponents} Components</div>
      </div>
      ${metricsHTML}
      <h2 class="section-title">Detailed Metadata Listings</h2>
      ${detailsHTML}
      <div class="recommendation">
        <strong>💡 Customization Level Assessment:</strong><br>
        <span style="font-size:1.1em;font-weight:bold;">${esc(customizationLevel)}</span><br>
        Your org has <strong>${totalComponents}</strong> custom components indicating a
        <strong style="text-transform:lowercase;">${esc(customizationLevel)}</strong> level of customization.
      </div>
    </div>
    <footer>
      <p>Generated on ${esc(timestamp)} | Org Customization Assessment Tool</p>
    </footer>
  </div>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  // Verify sf CLI is available
  try {
    execSync('sf version --json', { stdio: 'pipe', timeout: 10000 });
  } catch {
    console.error("ERROR: 'sf' CLI not found. Install from https://developer.salesforce.com/tools/salesforcecli");
    process.exit(1);
  }

  console.log('Gathering metadata information from the connected org...\n');

  const metaInfo       = {};
  let totalComponents  = 0;

  METADATA_TYPES.forEach((t) => {
    const { count, items } = getMetadataInfo(t.apiName, t.filter);
    metaInfo[t.apiName]    = { count, items };
    totalComponents       += count;
    if (!QUIET) console.log(`  ✓ ${t.displayName}: ${count} items`);
  });

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const orgLabel  = ORG_FLAG || 'default';

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, buildHTML(metaInfo, totalComponents, timestamp, orgLabel), 'utf8');

  console.log(`\n✅ Report generated: ${OUT_FILE}`);
  console.log('   Open in your browser to review.');
}

run();
