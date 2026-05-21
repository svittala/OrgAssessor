#!/usr/bin/env node
/**
 * 2-analyze.js
 *
 * Reads inventory.json and a domains.config.json, classifies every metadata
 * component into a business capability domain, infers personas from profiles
 * and permission sets, and outputs analysis.json.
 *
 * Domain definitions are loaded from an EXTERNAL config file so they can be
 * tailored to any org without touching this script.
 *
 * Config file resolution order (first found wins):
 *   1. Explicit 3rd argument:   node 2-analyze.js <inv> <outDir> <domainsConfig>
 *   2. <outputDir>/domains.config.json   (same folder as the output)
 *   3. scripts/organalysis/domains.config.json  (project-level default)
 *
 * If no config is found, run 0-discover-domains.js first to generate one.
 *
 * Usage:
 *   node scripts/organalysis/2-analyze.js [inventoryFile] [outputDir] [domainsConfig]
 *
 * Defaults:
 *   inventoryFile  ./reports/organalysis/inventory.json
 *   outputDir      ./reports/organalysis
 *   domainsConfig  (resolved automatically — see above)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const ROOT           = process.cwd();
const INVENTORY_FILE = path.resolve(ROOT, process.argv[2] || 'reports/organalysis/inventory.json');
const OUTPUT_DIR     = path.resolve(ROOT, process.argv[3] || 'reports/organalysis');
const OUTPUT_FILE    = path.join(OUTPUT_DIR, 'analysis.json');
const EXPLICIT_CONFIG = process.argv[4] ? path.resolve(ROOT, process.argv[4]) : null;

// ─── Load domain config ───────────────────────────────────────────────────────

function resolveConfigFile() {
  // 1. Explicit argument
  if (EXPLICIT_CONFIG) {
    if (!fs.existsSync(EXPLICIT_CONFIG)) {
      console.error(`ERROR: domains config not found at: ${EXPLICIT_CONFIG}`);
      process.exit(1);
    }
    return EXPLICIT_CONFIG;
  }

  // 2. Same directory as output
  const outputDirConfig = path.join(OUTPUT_DIR, 'domains.config.json');
  if (fs.existsSync(outputDirConfig)) return outputDirConfig;

  // 3. Project-level scripts default
  const projectDefault = path.join(__dirname, 'domains.config.json');
  if (fs.existsSync(projectDefault)) return projectDefault;

  // Nothing found
  return null;
}

function loadDomains() {
  const configFile = resolveConfigFile();

  if (!configFile) {
    console.error('ERROR: No domains.config.json found.');
    console.error('');
    console.error('Generate a starter config by running:');
    console.error('  node scripts/organalysis/0-discover-domains.js');
    console.error('');
    console.error('Then edit the config to reflect your org\'s business domains and re-run:');
    console.error('  node scripts/organalysis/2-analyze.js');
    process.exit(1);
  }

  console.log(`Loading domains from: ${configFile}`);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Failed to parse domains config: ${e.message}`);
    process.exit(1);
  }

  if (!config.domains || !Array.isArray(config.domains)) {
    console.error('ERROR: domains.config.json must have a "domains" array.');
    process.exit(1);
  }

  const domains = config.domains.map((d) => {
    if (!d.id)   { console.error(`ERROR: domain missing "id": ${JSON.stringify(d)}`);   process.exit(1); }
    if (!d.name) { console.error(`ERROR: domain "${d.id}" missing "name"`);             process.exit(1); }
    return {
      id:          d.id,
      name:        d.name,
      description: d.description || '',
      patterns:    Array.isArray(d.patterns) ? d.patterns : [],
      priority:    typeof d.priority === 'number' ? d.priority : 5,
      appTabs:     Array.isArray(d._appTabs) ? d._appTabs : [],
    };
  });

  const fallbackId = config.fallbackDomainId || domains[domains.length - 1]?.id || 'uncategorized';

  // Ensure fallback domain exists
  if (!domains.find((d) => d.id === fallbackId)) {
    domains.push({
      id:          fallbackId,
      name:        'Uncategorized',
      description: 'Components not matched to any domain.',
      patterns:    [],
      priority:    0,
    });
  }

  return { domains, fallbackId };
}

// ─── Classifier ───────────────────────────────────────────────────────────────

let DOMAINS;
let FALLBACK_ID;

/** Normalise a name for pattern matching: lowercase + underscores. */
function normalise(name) {
  return name
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1_$2')  // camelCase → snake_case
    .replace(/[\s-]+/g, '_')
    .replace(/__+/g, '_');
}

/** Return array of domain ids that match the given name, sorted by priority desc. */
function classifyName(name) {
  const norm    = normalise(name);
  const matches = [];

  for (const domain of DOMAINS) {
    if (!domain.patterns.length) continue; // skip catch-all domains in matching
    for (const pat of domain.patterns) {
      try {
        if (new RegExp(pat, 'i').test(norm)) {
          matches.push(domain.id);
          break;
        }
      } catch {
        // Silently skip malformed regex patterns
      }
    }
  }

  matches.sort((a, b) => {
    const da = DOMAINS.find((d) => d.id === a);
    const db = DOMAINS.find((d) => d.id === b);
    return (db?.priority ?? 0) - (da?.priority ?? 0);
  });

  return matches.length ? matches : [FALLBACK_ID];
}

function primaryDomain(name) {
  return classifyName(name)[0];
}

// ─── Component Classifiers ────────────────────────────────────────────────────

function classify(items) {
  return items.map((item) => ({
    ...item,
    domains:       classifyName(item.name),
    primaryDomain: primaryDomain(item.name),
  }));
}

// ─── Domain Aggregator ────────────────────────────────────────────────────────

function buildDomainMap(inventory, classified) {
  const domainMap = {};

  DOMAINS.forEach((d) => {
    domainMap[d.id] = {
      ...d,
      objects:        [],
      lwcComponents:  [],
      auraComponents: [],
      apexClasses:    [],
      flows:          [],
      flexiPages:     [],
      triggers:       [],
      tabs:           [],
      appTabs:        d.appTabs || [],   // tabs declared in the app metadata
    };
  });

  const add = (domainId, category, item) => {
    const target = domainMap[domainId] || domainMap[FALLBACK_ID];
    if (target) target[category].push(item.name || item);
  };

  classified.objects.forEach((o)        => add(o.primaryDomain, 'objects', o));
  classified.lwcComponents.forEach((c)  => add(c.primaryDomain, 'lwcComponents', c));
  classified.auraComponents.forEach((c) => add(c.primaryDomain, 'auraComponents', c));
  classified.apexClasses.forEach((c)    => add(c.primaryDomain, 'apexClasses', c));
  classified.flows.forEach((f)          => add(f.primaryDomain, 'flows', f));
  classified.flexiPages.forEach((p)     => add(p.primaryDomain, 'flexiPages', p));

  inventory.triggers.forEach((t) => {
    const dom = t.object ? primaryDomain(t.object) : FALLBACK_ID;
    add(dom, 'triggers', t);
  });

  inventory.tabs.forEach((tab) => {
    add(primaryDomain(tab.name), 'tabs', tab);
  });

  // Annotate with totals
  const result = {};
  Object.entries(domainMap).forEach(([id, domain]) => {
    const total =
      domain.objects.length + domain.lwcComponents.length +
      domain.auraComponents.length + domain.apexClasses.length +
      domain.flows.length + domain.flexiPages.length +
      domain.triggers.length + domain.tabs.length;
    // Keep domain even if empty so it appears in the report (makes gaps visible)
    result[id] = { ...domain, componentCount: total };
  });

  return result;
}

// ─── Persona Inference ────────────────────────────────────────────────────────

const SKIP_PS_PREFIXES = ['sfdcInternalInt', 'salesforce_cli', 'sfdcInternalQe'];

function inferPersonas(inventory) {
  const personas = [];

  inventory.permissionSets.forEach((ps) => {
    if (SKIP_PS_PREFIXES.some((p) => ps.name.startsWith(p))) return;

    const accessedObjects = ps.objectPermissions.map((op) => op.object);
    const visibleTabs     = ps.tabVisibility  || [];
    const visibleApps     = ps.appVisibility  || [];
    const domains         = [...new Set([
      ...accessedObjects.flatMap((o) => classifyName(o)),
      ...visibleTabs.flatMap((t)     => classifyName(t)),
      ...visibleApps.flatMap((a)     => classifyName(a)),
    ])];

    personas.push({
      source: 'permissionset',
      name:            ps.label || ps.name,
      accessedObjects,
      visibleTabs,
      visibleApps,
      domains,
    });
  });

  inventory.profiles.forEach((p) => {
    const domains = [...new Set([
      ...p.objectPermissions.flatMap((o) => classifyName(o)),
      ...p.tabVisibility.flatMap((t)     => classifyName(t)),
    ])];
    personas.push({
      source:          'profile',
      name:            p.name,
      userLicense:     p.userLicense,
      accessedObjects: p.objectPermissions,
      visibleTabs:     p.tabVisibility,
      visibleApps:     p.appVisibility,
      domains,
    });
  });

  return personas;
}

// ─── Integration Mapper ───────────────────────────────────────────────────────

const CALLOUT_PATTERNS = ['callout', 'http', 'rest', 'jwt', 'oauth', 'slack', 'webhook', 'sftp'];

function mapIntegrations(inventory) {
  const integrations = [];

  inventory.cspTrustedSites.forEach((csp) => {
    integrations.push({
      name: csp.name, type: 'CSP Trusted Site',
      endpoint: csp.endpointUrl, direction: 'Inbound (browser)',
      mechanism: 'Content Security Policy', domain: primaryDomain(csp.name),
    });
  });

  inventory.remoteSiteSettings.forEach((rs) => {
    integrations.push({
      name: rs.name, type: 'Remote Site',
      endpoint: null, direction: 'Outbound',
      mechanism: 'Remote Site Setting', domain: primaryDomain(rs.name),
    });
  });

  inventory.namedCredentials.forEach((nc) => {
    integrations.push({
      name: nc.name, type: 'Named Credential',
      endpoint: null, direction: 'Outbound',
      mechanism: 'Named Credential', domain: primaryDomain(nc.name),
    });
  });

  inventory.apexClasses
    .filter((c) => !c.isTest && CALLOUT_PATTERNS.some((p) => c.name.toLowerCase().includes(p)))
    .forEach((c) => {
      integrations.push({
        name: c.name, type: 'Apex Callout',
        endpoint: null, direction: 'Outbound',
        mechanism: 'Apex HTTP Callout', domain: primaryDomain(c.name),
      });
    });

  return integrations;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  if (!fs.existsSync(INVENTORY_FILE)) {
    console.error(`ERROR: inventory file not found: ${INVENTORY_FILE}`);
    console.error('Run 1-inventory.js first.');
    process.exit(1);
  }

  // Load domain config — exits with instructions if missing
  const { domains, fallbackId } = loadDomains();
  DOMAINS     = domains;
  FALLBACK_ID = fallbackId;

  console.log(`Reading inventory: ${INVENTORY_FILE}`);
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));

  const classified = {
    objects:        classify(inventory.objects),
    lwcComponents:  classify(inventory.lwcComponents),
    auraComponents: classify(inventory.auraComponents),
    apexClasses:    classify(inventory.apexClasses),
    flows:          classify(inventory.flows),
    flexiPages:     classify(inventory.flexiPages),
  };

  const domainMap    = buildDomainMap(inventory, classified);
  const personas     = inferPersonas(inventory);
  const integrations = mapIntegrations(inventory);

  const analysis = {
    meta: {
      ...inventory.meta,
      analyzedAt:   new Date().toISOString(),
      domainsConfig: resolveConfigFile(),
    },
    summary:    inventory.summary,
    domains:    domainMap,
    personas,
    integrations,
    classified,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(analysis, null, 2), 'utf8');

  // ── Console summary ──────────────────────────────────────────────────────

  console.log('\n=== Capability Domains ===');
  Object.values(domainMap)
    .sort((a, b) => b.componentCount - a.componentCount)
    .forEach((d) => {
      const bar      = '█'.repeat(Math.min(30, Math.ceil(d.componentCount / 3)));
      const fallmark = d.id === FALLBACK_ID ? ' ← review these' : '';
      console.log(`  ${String(d.componentCount).padStart(3)}  ${bar}  ${d.name}${fallmark}`);
    });

  const fallback = domainMap[FALLBACK_ID];
  if (fallback && fallback.componentCount > 0) {
    console.log(`\n  TIP: ${fallback.componentCount} components landed in "${fallback.name}".`);
    console.log(`       Add patterns to domains.config.json to reduce this number.`);
  }

  console.log(`\n=== Personas: ${personas.length} ===`);
  personas.forEach((p) => console.log(`  - ${p.name} (${p.source})`));

  console.log(`\nOutput: ${OUTPUT_FILE}`);
}

run();
