#!/usr/bin/env node
/**
 * 3-report.js
 *
 * Reads analysis.json and generates a self-contained HTML capability matrix
 * report. Opens with no external dependencies — all CSS and JS are inlined.
 *
 * Usage:
 *   node scripts/organalysis/3-report.js [analysisFile] [outputDir]
 *
 * Defaults:
 *   analysisFile  ./reports/organalysis/analysis.json
 *   outputDir     ./reports/organalysis
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const ROOT          = process.cwd();
const ANALYSIS_FILE = path.resolve(ROOT, process.argv[2] || 'reports/organalysis/analysis.json');
const OUTPUT_DIR    = path.resolve(ROOT, process.argv[3] || 'reports/organalysis');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badge(text, cls = '') {
  return `<span class="badge ${esc(cls)}">${esc(text)}</span>`;
}

function pill(text) {
  return `<span class="pill">${esc(text)}</span>`;
}

/** Show every item — no truncation. */
function pills(arr) {
  if (!arr || !arr.length) return '<span class="empty">—</span>';
  return arr.map(pill).join('');
}

/** Accent-coloured pills used for App Tabs rows. */
function pillsAccent(arr) {
  if (!arr || !arr.length) return '<span class="empty">—</span>';
  return arr.map((t) => `<span class="pill pill--tab">${esc(t)}</span>`).join('');
}

/**
 * Pills inside a scrollable container for use inside table cells.
 * All items are always present in the DOM; the container scrolls
 * vertically so cells don't grow unbounded.
 */
function pillsCell(arr) {
  if (!arr || !arr.length) return '<span class="empty">—</span>';
  const count = arr.length > 1 ? `<span class="cell-count">${arr.length}</span>` : '';
  return `<div class="pill-cell">${count}${arr.map(pill).join('')}</div>`;
}

function domainBadge(domainId, domains) {
  const domain = domains[domainId];
  if (!domain) return '';
  return badge(domain.name, 'domain');
}

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function buildStatCards(summary) {
  const stats = [
    { label: 'Business Domains',  value: '—' },           // filled below
    { label: 'Objects',            value: summary.objects },
    { label: 'Custom Objects',     value: summary.customObjects },
    { label: 'External Objects',   value: summary.externalObjects },
    { label: 'LWC Components',     value: summary.lwcComponents },
    { label: 'Aura Components',    value: summary.auraComponents },
    { label: 'Apex Classes',       value: summary.apexClasses },
    { label: 'Test Classes',       value: summary.apexTestClasses },
    { label: 'Flows',              value: summary.flows },
    { label: 'FlexiPages',         value: summary.flexiPages },
    { label: 'Profiles',           value: summary.profiles },
    { label: 'Permission Sets',    value: summary.permissionSets },
  ];
  return `<div class="stat-grid">
    ${stats.map((s) => `
      <div class="stat-card">
        <div class="stat-value">${esc(String(s.value))}</div>
        <div class="stat-label">${esc(s.label)}</div>
      </div>`).join('')}
  </div>`;
}

function buildCapabilityMatrix(domains, integrationsByDomain) {
  const rows = Object.values(domains)
    .sort((a, b) => b.componentCount - a.componentCount);

  const thead = `<tr>
    <th>Business Domain</th>
    <th>Objects</th>
    <th>LWC Components</th>
    <th>Aura Components</th>
    <th>Apex Classes</th>
    <th>Flows</th>
    <th>Pages / Tabs</th>
    <th>Integrations</th>
    <th>Total</th>
  </tr>`;

  const tbody = rows.map((d) => {
    const intgs = (integrationsByDomain[d.id] || []).map((i) => i.name);
    const pages = [...(d.flexiPages || []), ...(d.tabs || [])];
    return `<tr>
      <td class="td-domain"><strong>${esc(d.name)}</strong><br><small class="desc">${esc(d.description)}</small></td>
      <td>${pillsCell(d.objects)}</td>
      <td>${pillsCell(d.lwcComponents)}</td>
      <td>${pillsCell(d.auraComponents)}</td>
      <td>${pillsCell(d.apexClasses)}</td>
      <td>${pillsCell(d.flows)}</td>
      <td>${pillsCell(pages)}</td>
      <td>${pillsCell(intgs)}</td>
      <td class="count">${d.componentCount}</td>
    </tr>`;
  }).join('');

  return `<div class="table-wrap">
    <table class="matrix-table">
      <thead>${thead}</thead>
      <tbody>${tbody}</tbody>
    </table>
  </div>`;
}

function buildDomainCards(domains) {
  return `<div class="domain-grid">
    ${Object.values(domains)
      .sort((a, b) => b.componentCount - a.componentCount)
      .map((d) => {
        const sections = [
          { label: 'App Tabs',        items: d.appTabs,    style: 'accent' },
          { label: 'Objects',         items: d.objects },
          { label: 'LWC',             items: d.lwcComponents },
          { label: 'Aura',            items: d.auraComponents },
          { label: 'Apex',            items: d.apexClasses },
          { label: 'Flows',           items: d.flows },
          { label: 'Pages / Tabs',    items: [...(d.flexiPages || []), ...(d.tabs || [])] },
          { label: 'Triggers',        items: d.triggers },
        ].filter((s) => s.items && s.items.length > 0);

        return `<div class="domain-card">
          <div class="domain-card-header">
            <span class="domain-title">${esc(d.name)}</span>
            <span class="domain-count">${d.componentCount}</span>
          </div>
          <p class="domain-desc">${esc(d.description)}</p>
          ${sections.map((s) => `
            <div class="section-row${s.style === 'accent' ? ' section-row--accent' : ''}">
              <span class="section-label">${esc(s.label)}</span>
              <div class="section-pills">${s.style === 'accent' ? pillsAccent(s.items) : pills(s.items)}</div>
            </div>`).join('')}
        </div>`;
      }).join('')}
  </div>`;
}

function buildPersonaTable(personas) {
  if (!personas.length) return '<p class="empty">No personas found.</p>';

  const rows = personas.map((p) => {
    const domainTags = [...new Set(p.domains)]
      .filter((d) => d !== 'devtools' && d !== 'uncategorized')
      .map((d) => badge(d, 'domain-sm'))
      .join(' ');
    return `<tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${badge(p.source, p.source === 'profile' ? 'tag-profile' : 'tag-ps')}</td>
      <td>${esc(p.userLicense || '—')}</td>
      <td>${pillsCell(p.accessedObjects)}</td>
      <td>${pillsCell(p.visibleApps)}</td>
      <td>${domainTags || '<span class="empty">—</span>'}</td>
    </tr>`;
  }).join('');

  return `<div class="table-wrap">
    <table class="matrix-table">
      <thead><tr>
        <th>Persona</th><th>Source</th><th>User License</th>
        <th>Accessed Objects</th><th>Visible Apps</th><th>Capability Domains</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function buildIntegrationTable(integrations) {
  if (!integrations.length) return '<p class="empty">No integrations found.</p>';

  const deduped = [];
  const seen    = new Set();
  integrations.forEach((i) => {
    const key = `${i.name}|${i.type}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(i); }
  });

  const rows = deduped.map((i) => `<tr>
    <td><strong>${esc(i.name)}</strong></td>
    <td>${badge(i.type, 'tag-type')}</td>
    <td>${badge(i.direction, i.direction.startsWith('Outbound') ? 'tag-out' : 'tag-in')}</td>
    <td>${esc(i.mechanism)}</td>
    <td>${esc(i.endpoint || '—')}</td>
    <td>${badge(i.domain, 'domain-sm')}</td>
  </tr>`).join('');

  return `<div class="table-wrap">
    <table class="matrix-table">
      <thead><tr>
        <th>Name</th><th>Type</th><th>Direction</th><th>Mechanism</th><th>Endpoint</th><th>Domain</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #1a1a1a;
  background: #f7f7f8;
  margin: 0;
  padding: 0;
}
.page { max-width: 1280px; margin: 0 auto; padding: 32px 24px 64px; }
h1 { font-size: 24px; font-weight: 700; margin: 0 0 4px; }
h2 { font-size: 18px; font-weight: 600; margin: 32px 0 12px; border-bottom: 1px solid #e0e0e0; padding-bottom: 8px; }
h3 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
p  { margin: 4px 0 12px; color: #555; }
.meta { color: #888; font-size: 12px; margin-bottom: 24px; }

/* Stat grid */
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 8px; }
.stat-card { background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 16px 14px; }
.stat-value { font-size: 28px; font-weight: 700; color: #111; line-height: 1; }
.stat-label { font-size: 11px; color: #888; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.04em; }

/* Badges & pills */
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; background: #f0f0f0; color: #444; white-space: nowrap; }
.badge.domain    { background: #e8f0fe; color: #1a56db; }
.badge.domain-sm { background: #e8f0fe; color: #1a56db; font-size: 10px; padding: 1px 6px; }
.badge.tag-profile { background: #fef3c7; color: #b45309; }
.badge.tag-ps      { background: #dcfce7; color: #166534; }
.badge.tag-type    { background: #f3f4f6; color: #374151; }
.badge.tag-out     { background: #fce7f3; color: #9d174d; }
.badge.tag-in      { background: #e0f2fe; color: #0c4a6e; }
.pill  { display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 11px; background: #f0f0f0; color: #333; margin: 1px 1px 2px; white-space: nowrap; }
.empty { color: #bbb; font-style: italic; }

/* Scrollable pill container used inside table cells.
   All items are rendered — nothing is hidden.
   The container scrolls so rows stay a consistent height.       */
.pill-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  align-content: flex-start;
  max-height: 140px;
  overflow-y: auto;
  padding: 2px 2px 2px 0;
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
  position: relative;
}
.pill-cell::-webkit-scrollbar       { width: 4px; }
.pill-cell::-webkit-scrollbar-track { background: transparent; }
.pill-cell::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
/* Small count badge that appears when there are multiple items */
.cell-count {
  display: inline-block;
  min-width: 20px;
  text-align: center;
  padding: 1px 5px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  background: #1a56db;
  color: #fff;
  margin: 1px 3px 1px 0;
  white-space: nowrap;
  align-self: flex-start;
  flex-shrink: 0;
}

/* Table */
.table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid #e4e4e7; background: #fff; }
.matrix-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.matrix-table th { background: #f7f7f8; text-align: left; padding: 10px 12px; font-weight: 600; font-size: 12px; color: #555; border-bottom: 1px solid #e4e4e7; white-space: nowrap; }
.matrix-table td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: top; max-width: 220px; }
.matrix-table td.td-domain { max-width: 200px; min-width: 160px; }
.matrix-table tr:last-child td { border-bottom: none; }
.matrix-table tr:hover td { background: #fafafa; }
.matrix-table td.count { text-align: center; font-weight: 700; color: #1a56db; max-width: 60px; }
.desc { color: #888; font-size: 11px; line-height: 1.4; }

/* Domain cards */
.domain-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
.domain-card { background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 16px; }
.domain-card-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
.domain-title { font-weight: 600; font-size: 14px; }
.domain-count { font-size: 12px; font-weight: 700; color: #1a56db; background: #e8f0fe; padding: 2px 8px; border-radius: 999px; }
.domain-desc { font-size: 12px; color: #888; margin: 0 0 10px; }
.section-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
.section-row--accent { background: #f0f4ff; border-radius: 6px; padding: 5px 7px; margin-bottom: 8px; }
.section-row--accent .section-label { color: #1a56db; }
.section-label { min-width: 70px; font-size: 11px; font-weight: 600; color: #777; text-transform: uppercase; letter-spacing: 0.03em; padding-top: 3px; }
.section-pills { flex: 1; display: flex; flex-wrap: wrap; gap: 2px; }
.pill--tab { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }

/* Nav */
.nav { display: flex; gap: 4px; border-bottom: 2px solid #e4e4e7; margin-bottom: 24px; }
.nav-btn { padding: 8px 16px; font-size: 13px; font-weight: 500; border: none; background: none; cursor: pointer; color: #555; border-bottom: 2px solid transparent; margin-bottom: -2px; }
.nav-btn.active { color: #1a56db; border-bottom-color: #1a56db; }
.tab-panel { display: none; }
.tab-panel.active { display: block; }
`;

// ─── JS ───────────────────────────────────────────────────────────────────────

const JS = `
document.querySelectorAll('.nav-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var target = btn.getAttribute('data-tab');
    document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById(target).classList.add('active');
  });
});
// Fix domain count stat
var domains = document.querySelectorAll('.domain-card');
var statValues = document.querySelectorAll('.stat-value');
if (statValues[0]) statValues[0].textContent = domains.length;
`;

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  if (!fs.existsSync(ANALYSIS_FILE)) {
    console.error(`ERROR: analysis file not found: ${ANALYSIS_FILE}`);
    console.error('Run 2-analyze.js first.');
    process.exit(1);
  }

  console.log(`Reading analysis: ${ANALYSIS_FILE}`);
  const analysis = JSON.parse(fs.readFileSync(ANALYSIS_FILE, 'utf8'));

  const { meta, summary, domains, personas, integrations } = analysis;

  // Group integrations by domain
  const integrationsByDomain = {};
  integrations.forEach((i) => {
    if (!integrationsByDomain[i.domain]) integrationsByDomain[i.domain] = [];
    integrationsByDomain[i.domain].push(i);
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(meta.projectName)} — Business Capability Matrix</title>
  <style>${CSS}</style>
</head>
<body>
<div class="page">

  <h1>${esc(meta.projectName)} — Business Capability Matrix</h1>
  <p class="meta">
    Source: <code>${esc(meta.forceAppPath)}</code> &nbsp;|&nbsp;
    Analyzed: ${esc(new Date(meta.analyzedAt).toLocaleString())}
  </p>

  ${buildStatCards(summary)}

  <div class="nav">
    <button class="nav-btn active" data-tab="tab-matrix">Capability Matrix</button>
    <button class="nav-btn"        data-tab="tab-domains">Domain Breakdown</button>
    <button class="nav-btn"        data-tab="tab-personas">Personas</button>
    <button class="nav-btn"        data-tab="tab-integrations">Integrations</button>
  </div>

  <div id="tab-matrix" class="tab-panel active">
    <h2>Capability Matrix</h2>
    <p>Each row is a discrete business capability domain derived from metadata component names and patterns.</p>
    ${buildCapabilityMatrix(domains, integrationsByDomain)}
  </div>

  <div id="tab-domains" class="tab-panel">
    <h2>Domain Breakdown</h2>
    <p>Detailed view of every component classified to each business domain.</p>
    ${buildDomainCards(domains)}
  </div>

  <div id="tab-personas" class="tab-panel">
    <h2>Business Personas</h2>
    <p>Inferred from Salesforce profiles and permission sets. Domains indicate which capabilities each persona can access.</p>
    ${buildPersonaTable(personas)}
  </div>

  <div id="tab-integrations" class="tab-panel">
    <h2>External Integration Points</h2>
    <p>Detected from CSP Trusted Sites, Remote Site Settings, Named Credentials, and Apex callout class naming patterns.</p>
    ${buildIntegrationTable(integrations)}
  </div>

</div>
<script>${JS}</script>
</body>
</html>`;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFile = path.join(OUTPUT_DIR, `capability-matrix-${timestamp}.html`);
  fs.writeFileSync(outputFile, html, 'utf8');

  console.log(`\nReport written: ${outputFile}`);
  console.log(`Open in browser: open "${outputFile}"`);
}

run();
