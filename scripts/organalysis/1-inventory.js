#!/usr/bin/env node
/**
 * 1-inventory.js
 *
 * Scans a Salesforce force-app/main/default metadata directory and produces a
 * structured JSON inventory. Parses key XML files (apps, permission sets,
 * profiles) for richer metadata.
 *
 * Usage:
 *   node scripts/organalysis/1-inventory.js [forceAppPath] [outputDir]
 *
 * Defaults:
 *   forceAppPath  ./force-app/main/default
 *   outputDir     ./reports/organalysis
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const ROOT        = process.cwd();
const FORCE_APP   = path.resolve(ROOT, process.argv[2] || 'force-app/main/default');
const OUTPUT_DIR  = path.resolve(ROOT, process.argv[3] || 'reports/organalysis');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'inventory.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

/** List immediate child names in a directory (returns [] if missing). */
function listDir(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir);
}

/** List immediate child names that are directories. */
function listSubDirs(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((n) => {
    try { return fs.statSync(path.join(dir, n)).isDirectory(); } catch { return false; }
  });
}

/** Read file text, return '' on error. */
function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

/** Very lightweight XML tag value extractor. Handles simple single-value tags. */
function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

/** Extract all values for a repeating tag. */
function xmlTagAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

/** Extract all attributes of a given attribute name inside a repeated block. */
function xmlAttr(xml, block, attr) {
  const blockRe = new RegExp(`<${block}[^>]*>([\\s\\S]*?)</${block}>`, 'gi');
  const results = [];
  let bm;
  while ((bm = blockRe.exec(xml)) !== null) {
    const attrM = bm[1].match(new RegExp(`<${attr}[^>]*>([\\s\\S]*?)</${attr}>`, 'i'));
    if (attrM) results.push(attrM[1].trim());
  }
  return results;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseAppFile(filePath) {
  const xml = readFile(filePath);
  const name    = path.basename(filePath).replace('.app-meta.xml', '');
  const label   = xmlTag(xml, 'label') || name;
  const description = xmlTag(xml, 'description') || null;
  // App files use <tabs> (plural) in classic format, <navItem> in newer format
  const tabs    = xmlTagAll(xml, 'navItem').length
    ? xmlTagAll(xml, 'navItem')
    : xmlTagAll(xml, 'tabs').length
      ? xmlTagAll(xml, 'tabs')
      : xmlTagAll(xml, 'tab');
  const logo    = xmlTag(xml, 'logoFile') || xmlTag(xml, 'logo') || null;
  const headerColor = xmlTag(xml, 'headerColor') || null;
  const formFactor  = xmlTag(xml, 'formFactor') || 'Large';
  const utilityBar  = xmlTag(xml, 'utilityBar') || null;
  return { name, label, description, tabs, logo, headerColor, formFactor, utilityBar };
}

function parsePermissionSetFile(filePath) {
  const xml = readFile(filePath);
  const name  = path.basename(filePath).replace('.permissionset-meta.xml', '');
  const label = xmlTag(xml, 'label') || name;

  // Object permissions
  const objPermsXml = [];
  const opRe = /<objectPermissions>([\s\S]*?)<\/objectPermissions>/gi;
  let m;
  while ((m = opRe.exec(xml)) !== null) {
    const block  = m[1];
    const obj    = xmlTag(block, 'object');
    const perms  = {};
    ['allowCreate','allowDelete','allowEdit','allowRead','modifyAllRecords','viewAllRecords'].forEach((p) => {
      const v = xmlTag(block, p);
      if (v === 'true') perms[p] = true;
    });
    if (obj) objPermsXml.push({ object: obj, ...perms });
  }

  // Tab visibilities
  const tabVisibility = [];
  const tvRe = /<tabSettings>([\s\S]*?)<\/tabSettings>/gi;
  while ((m = tvRe.exec(xml)) !== null) {
    const tab        = xmlTag(m[1], 'tab');
    const visibility = xmlTag(m[1], 'visibility');
    if (tab && visibility !== 'Hidden') tabVisibility.push(tab);
  }

  // App visibilities
  const appVisibility = xmlAttr(xml, 'applicationVisibilities', 'application')
    .filter((_, i) => {
      const allVis = xmlAttr(xml, 'applicationVisibilities', 'visible');
      return allVis[i] === 'true';
    });

  return { name, label, objectPermissions: objPermsXml, tabVisibility, appVisibility };
}

function parseProfileFile(filePath) {
  const xml   = readFile(filePath);
  const name  = path.basename(filePath).replace('.profile-meta.xml', '');
  const userLicense = xmlTag(xml, 'userLicense') || null;
  const custom      = xmlTag(xml, 'custom') === 'true';

  const objPerms = [];
  const opRe    = /<objectPermissions>([\s\S]*?)<\/objectPermissions>/gi;
  let m;
  while ((m = opRe.exec(xml)) !== null) {
    const obj = xmlTag(m[1], 'object');
    if (obj) objPerms.push(obj);
  }

  const tabVis = xmlAttr(xml, 'tabVisibilities', 'tab');
  const appVis = xmlAttr(xml, 'applicationVisibilities', 'application');

  return { name, userLicense, custom, objectPermissions: objPerms, tabVisibility: tabVis, appVisibility: appVis };
}

function parseFlowFile(filePath) {
  const xml   = readFile(filePath);
  const name  = path.basename(filePath).replace('.flow-meta.xml', '');
  const label = xmlTag(xml, 'label') || name;
  const type  = xmlTag(xml, 'processType') || xmlTag(xml, 'triggerType') || 'Unknown';
  const status = xmlTag(xml, 'status') || 'Unknown';
  return { name, label, type, status };
}

function parseNetworkFile(filePath) {
  const xml  = readFile(filePath);
  const name = path.basename(filePath).replace('.network-meta.xml', '');
  const status = xmlTag(xml, 'status') || 'Active';
  return { name, status };
}

// ─── Inventory ────────────────────────────────────────────────────────────────

function inventoryFolder(category, dir, pattern) {
  const all = listDir(dir);
  return all
    .filter((f) => !pattern || f.match(pattern))
    .map((f) => ({
      name: f.replace(/\..*$/, '').replace(/-meta$/, ''),
      file: f,
    }));
}

function run() {
  if (!exists(FORCE_APP)) {
    console.error(`ERROR: force-app path not found: ${FORCE_APP}`);
    process.exit(1);
  }

  console.log(`Scanning: ${FORCE_APP}`);
  const d = (sub) => path.join(FORCE_APP, sub);

  // ── Apps ──────────────────────────────────────────────────────────────────
  const appFiles = listDir(d('applications')).filter((f) => f.endsWith('.app-meta.xml'));
  const applications = appFiles.map((f) => parseAppFile(path.join(d('applications'), f)));

  // ── Objects ───────────────────────────────────────────────────────────────
  const objectFolders = listSubDirs(d('objects'));
  const objects = objectFolders.map((name) => {
    const fieldsDir = path.join(d('objects'), name, 'fields');
    const fields    = listDir(fieldsDir).map((f) => f.replace('.field-meta.xml', ''));
    const isCustom  = name.endsWith('__c');
    const isEvent   = name.endsWith('__e');
    const isExternal = name.endsWith('__x');
    const type      = isEvent ? 'PlatformEvent' : isExternal ? 'ExternalObject' : isCustom ? 'CustomObject' : 'StandardObject';
    return { name, type, fieldCount: fields.length };
  });

  // ── Profiles ──────────────────────────────────────────────────────────────
  const profileFiles = listDir(d('profiles')).filter((f) => f.endsWith('.profile-meta.xml'));
  const profiles     = profileFiles.map((f) => parseProfileFile(path.join(d('profiles'), f)));

  // ── Permission Sets ───────────────────────────────────────────────────────
  const psFiles  = listDir(d('permissionsets')).filter((f) => f.endsWith('.permissionset-meta.xml'));
  const permissionSets = psFiles.map((f) => parsePermissionSetFile(path.join(d('permissionsets'), f)));

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const tabs = inventoryFolder('tabs', d('tabs'), /\.tab-meta\.xml$/);

  // ── FlexiPages ────────────────────────────────────────────────────────────
  const flexiPages = inventoryFolder('flexipages', d('flexipages'), /\.flexipage-meta\.xml$/)
    .map((fp) => {
      const xml  = readFile(path.join(d('flexipages'), fp.file));
      const type = xmlTag(xml, 'type') || 'Unknown';
      return { ...fp, pageType: type };
    });

  // ── Flows ─────────────────────────────────────────────────────────────────
  const flowFiles = listDir(d('flows')).filter((f) => f.endsWith('.flow-meta.xml'));
  const flows     = flowFiles.map((f) => parseFlowFile(path.join(d('flows'), f)));

  // ── LWC ───────────────────────────────────────────────────────────────────
  const lwcDirs = listSubDirs(d('lwc'));
  const lwcComponents = lwcDirs.map((name) => {
    const dir    = path.join(d('lwc'), name);
    const files  = listDir(dir);
    const hasTest = files.some((f) => f.includes('.test.'));
    const hasHtml = files.some((f) => f.endsWith('.html'));
    const hasCss  = files.some((f) => f.endsWith('.css'));
    return { name, hasTest, hasHtml, hasCss };
  });

  // ── Aura ──────────────────────────────────────────────────────────────────
  const auraDirs     = listSubDirs(d('aura'));
  const auraComponents = auraDirs.map((name) => ({ name }));

  // ── Apex ──────────────────────────────────────────────────────────────────
  const apexFiles = listDir(d('classes')).filter((f) => f.endsWith('.cls'));
  const apexClasses = apexFiles.map((f) => {
    const name   = f.replace('.cls', '');
    const source = readFile(path.join(d('classes'), f));
    const isTest = /@isTest/i.test(source);
    const isTriggerHandler = /triggerhandler|handler/i.test(name);
    const isController = /controller/i.test(name);
    const isScheduled  = /schedulable/i.test(source);
    const isBatch      = /database\.batchable/i.test(source);
    return { name, isTest, isTriggerHandler, isController, isScheduled, isBatch };
  });

  // ── Triggers ──────────────────────────────────────────────────────────────
  const triggerFiles  = listDir(d('triggers')).filter((f) => f.endsWith('.trigger'));
  const triggers = triggerFiles.map((f) => {
    const name   = f.replace('.trigger', '');
    const source = readFile(path.join(d('triggers'), f));
    const obj    = (source.match(/trigger\s+\w+\s+on\s+(\w+)/i) || [])[1] || null;
    const events = (source.match(/\(([^)]+)\)/i) || [])[1]?.split(',').map((s) => s.trim()) || [];
    return { name, object: obj, events };
  });

  // ── Visualforce Pages ─────────────────────────────────────────────────────
  const vfPages = inventoryFolder('pages', d('pages'), /\.page-meta\.xml$/);

  // ── Sites / Networks ──────────────────────────────────────────────────────
  const siteFiles   = listDir(d('sites')).filter((f) => f.endsWith('.site-meta.xml'));
  const sites       = siteFiles.map((f) => ({ name: f.replace('.site-meta.xml', '') }));
  const networkFiles = listDir(d('networks')).filter((f) => f.endsWith('.network-meta.xml'));
  const networks    = networkFiles.map((f) => parseNetworkFile(path.join(d('networks'), f)));

  // ── Static Resources ──────────────────────────────────────────────────────
  const staticResources = inventoryFolder('staticresources', d('staticresources'), /\.resource-meta\.xml$/);

  // ── CSP Trusted Sites ─────────────────────────────────────────────────────
  const cspDir   = d('cspTrustedSites');
  const cspFiles = listDir(cspDir).filter((f) => f.endsWith('.cspTrustedSite-meta.xml'));
  const cspTrustedSites = cspFiles.map((f) => {
    const xml = readFile(path.join(cspDir, f));
    const endpointUrl = xmlTag(xml, 'endpointUrl') || null;
    return { name: f.replace('.cspTrustedSite-meta.xml', ''), endpointUrl };
  });

  // ── Named Credentials ─────────────────────────────────────────────────────
  const namedCredentials = inventoryFolder('namedCredentials', d('namedCredentials'), /\.namedCredential-meta\.xml$/);

  // ── Remote Site Settings ──────────────────────────────────────────────────
  const remoteSiteSettings = inventoryFolder('remoteSiteSettings', d('remoteSiteSettings'), /\.remoteSite-meta\.xml$/);

  // ─── Assemble ─────────────────────────────────────────────────────────────
  const inventory = {
    meta: {
      scannedAt: new Date().toISOString(),
      forceAppPath: FORCE_APP,
      projectName: path.basename(path.resolve(ROOT)),
    },
    applications,
    objects,
    profiles,
    permissionSets,
    tabs,
    flexiPages,
    flows,
    lwcComponents,
    auraComponents,
    apexClasses,
    triggers,
    vfPages,
    sites,
    networks,
    staticResources,
    cspTrustedSites,
    namedCredentials,
    remoteSiteSettings,
    summary: {
      applications:      applications.length,
      objects:           objects.length,
      customObjects:     objects.filter((o) => o.type === 'CustomObject').length,
      externalObjects:   objects.filter((o) => o.type === 'ExternalObject').length,
      profiles:          profiles.length,
      permissionSets:    permissionSets.length,
      tabs:              tabs.length,
      flexiPages:        flexiPages.length,
      flows:             flows.length,
      lwcComponents:     lwcComponents.length,
      auraComponents:    auraComponents.length,
      apexClasses:       apexClasses.length,
      apexTestClasses:   apexClasses.filter((c) => c.isTest).length,
      triggers:          triggers.length,
      vfPages:           vfPages.length,
      sites:             sites.length,
      networks:          networks.length,
    },
  };

  // ─── Output ───────────────────────────────────────────────────────────────
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(inventory, null, 2), 'utf8');

  console.log('\n=== Inventory Summary ===');
  Object.entries(inventory.summary).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(22)}: ${v}`);
  });
  console.log(`\nOutput: ${OUTPUT_FILE}`);
}

run();
