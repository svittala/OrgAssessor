#!/usr/bin/env node
/**
 * 0-discover-apps.js
 *
 * Discovers Lightning Applications, Experience Cloud sites, and networks.
 * Generates apps.config.json for user review and exclusion configuration.
 *
 * This is the first step in the security analysis pipeline. Users can edit
 * the generated config to exclude certain apps, and their related profiles/
 * permission sets will be skipped in subsequent stages.
 *
 * Usage:
 *   node scripts/code-analyzer/0-discover-apps.js [forceAppPath] [outputDir]
 *
 * Defaults:
 *   forceAppPath   ./force-app/main/default
 *   outputDir      ./reports/code-analyzer
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const ROOT            = process.cwd();
const FORCE_APP_PATH  = path.resolve(ROOT, process.argv[2] || 'force-app/main/default');
const OUTPUT_DIR      = path.resolve(ROOT, process.argv[3] || 'reports/code-analyzer');
const OUTPUT_FILE     = path.join(OUTPUT_DIR, 'apps.config.json');

// ─── File I/O ─────────────────────────────────────────────────────────────────

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function listDir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function listSubDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch { return []; }
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function xmlTagAll(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const results = [];
  let m;
  while ((m = regex.exec(xml)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

// ─── App parsers ──────────────────────────────────────────────────────────────

function parseCustomApp(filePath) {
  const xml  = readFile(filePath);
  const name = path.basename(filePath).replace('.app-meta.xml', '');
  const label = xmlTag(xml, 'label') || name;
  const tabs = xmlTagAll(xml, 'tabs');

  return {
    name,
    label,
    tabs,
  };
}

function parseSite(filePath, isModern = false) {
  const xml = readFile(filePath);
  const name = path.basename(filePath).replace('.site-meta.xml', '');
  const label = isModern
    ? xmlTag(xml, 'label') || name
    : xmlTag(xml, 'masterLabel') || name;
  const urlPrefix = xmlTag(xml, 'urlPathPrefix') || '';

  return {
    name,
    label,
    urlPrefix,
  };
}

function parseNetwork(filePath) {
  const xml = readFile(filePath);
  const name = path.basename(filePath).replace('.network-meta.xml', '');
  const urlPrefix = xmlTag(xml, 'urlPathPrefix') || '';

  return {
    name,
    label: name,
    urlPrefix,
  };
}

// ─── Discovery ────────────────────────────────────────────────────────────────

function discoverApps() {
  const appsDir = path.join(FORCE_APP_PATH, 'applications');
  const appFiles = listDir(appsDir)
    .filter(f => f.endsWith('.app-meta.xml') && !f.startsWith('standard__'));

  return appFiles.map(f => {
    const app = parseCustomApp(path.join(appsDir, f));
    return {
      id: `app_${app.name.toLowerCase()}`,
      name: app.name,
      label: app.label,
      type: 'CustomApplication',
      included: true,
      _discoveredAt: new Date().toISOString(),
      _tabs: app.tabs,
    };
  });
}

function discoverSites() {
  const results = [];

  // Classic sites
  const sitesDir = path.join(FORCE_APP_PATH, 'sites');
  const siteFiles = listDir(sitesDir).filter(f => f.endsWith('.site-meta.xml'));

  siteFiles.forEach(f => {
    const site = parseSite(path.join(sitesDir, f), false);
    results.push({
      id: `site_${site.name.toLowerCase()}`,
      name: site.name,
      label: site.label,
      type: 'CustomSite',
      included: true,
      _discoveredAt: new Date().toISOString(),
      _urlPrefix: site.urlPrefix,
    });
  });

  // Modern (Picasso) sites
  const picassoDir = path.join(FORCE_APP_PATH, 'siteDotComSites');
  const picassoFiles = listDir(picassoDir).filter(f => f.endsWith('.site-meta.xml'));

  picassoFiles.forEach(f => {
    const site = parseSite(path.join(picassoDir, f), true);
    results.push({
      id: `picasso_${site.name.toLowerCase()}`,
      name: site.name,
      label: site.label,
      type: 'SiteDotCom',
      included: true,
      _discoveredAt: new Date().toISOString(),
      _urlPrefix: site.urlPrefix,
    });
  });

  return results;
}

function discoverNetworks() {
  const networksDir = path.join(FORCE_APP_PATH, 'networks');
  const networkFiles = listDir(networksDir).filter(f => f.endsWith('.network-meta.xml'));

  return networkFiles.map(f => {
    const net = parseNetwork(path.join(networksDir, f));
    return {
      id: `network_${net.name.toLowerCase()}`,
      name: net.name,
      label: net.label,
      type: 'Network',
      included: true,
      _discoveredAt: new Date().toISOString(),
      _urlPrefix: net.urlPrefix,
    };
  });
}

// ─── Config builder ───────────────────────────────────────────────────────────

function buildConfig() {
  const apps = discoverApps();
  const sites = discoverSites();
  const networks = discoverNetworks();

  const allApps = [...apps, ...sites, ...networks]
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    _instructions: [
      'This file was auto-generated by 0-discover-apps.js.',
      'It lists all Lightning Applications, Experience Cloud sites, and networks found in your org.',
      'To exclude an app or site from the security analysis (along with its profiles/permission sets),',
      'set "included": false for that entry, then re-run the analysis pipeline.',
      'The "_discoveredAt", "_tabs", and "_urlPrefix" fields are for reference only.',
      'Once satisfied, run:  node scripts/code-analyzer/run-all.js',
    ],
    apps: allApps,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  if (!fs.existsSync(FORCE_APP_PATH)) {
    console.error(`ERROR: force-app path not found: ${FORCE_APP_PATH}`);
    process.exit(1);
  }

  console.log(`Discovering apps and sites in: ${FORCE_APP_PATH}`);

  const config = buildConfig();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Backup existing config if present
  if (fs.existsSync(OUTPUT_FILE)) {
    const backup = OUTPUT_FILE.replace('.json', '.backup.json');
    fs.copyFileSync(OUTPUT_FILE, backup);
    console.log(`\nExisting config backed up to: ${backup}`);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(config, null, 2), 'utf8');

  const appCount    = config.apps.length;
  const customApps  = config.apps.filter(a => a.type === 'CustomApplication').length;
  const sites       = config.apps.filter(a => a.type === 'CustomSite').length;
  const picasso     = config.apps.filter(a => a.type === 'SiteDotCom').length;
  const networks    = config.apps.filter(a => a.type === 'Network').length;

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  Discovery Complete`);
  console.log(`${'═'.repeat(64)}`);
  console.log(`  Total apps/sites discovered: ${appCount}`);
  console.log(`    - Custom Applications   : ${customApps}`);
  console.log(`    - Classic Sites         : ${sites}`);
  console.log(`    - Modern Sites (Picasso): ${picasso}`);
  console.log(`    - Networks              : ${networks}`);
  console.log(`\nConfig written: ${OUTPUT_FILE}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review the config file above`);
  console.log(`     - All entries have "included": true by default`);
  console.log(`  2. To exclude an app from analysis, change "included": false`);
  console.log(`     - Profiles/permission sets for that app will be skipped`);
  console.log(`  3. Save and re-run:  node scripts/code-analyzer/run-all.js`);
  console.log(`${'═'.repeat(64)}\n`);
}

run();
