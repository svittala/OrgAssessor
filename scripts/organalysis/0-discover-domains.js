#!/usr/bin/env node
/**
 * 0-discover-domains.js
 *
 * Reads inventory.json and suggests business capability domains. Writes a
 * domains.config.json that you review and edit before running 2-analyze.js.
 *
 * How discovery works — two phases:
 *
 *   PHASE 1 — Application-based domains (primary)
 *     Each Lightning Application in the org becomes a domain seed.
 *     The app's label becomes the domain name (e.g. "E-Bikes", "Sales Cloud").
 *     The app's tabs are tokenised to build the initial pattern list for that domain.
 *     This ensures domains reflect actual business applications, not arbitrary tokens.
 *
 *   PHASE 2 — Token-frequency domains (for remainder)
 *     Components not matched by any app-based domain are analysed by token
 *     frequency. Tokens appearing across 3+ components become additional domains.
 *     These represent business areas that exist in the org but are not surfaced
 *     as a named application (e.g. integrations, shared services).
 *
 *   PHASE 3 — Catch-all
 *     An "Uncategorized" domain always absorbs anything not yet matched.
 *
 * After running this script:
 *   - Open reports/organalysis/domains.config.json
 *   - App-based domains are already named correctly — just verify their patterns
 *   - Rename token-based domains to your business terminology
 *   - Merge domains that belong together, split ones that don't
 *   - Adjust or add patterns (they are lowercase regex fragments)
 *   - Then run:  node scripts/organalysis/2-analyze.js
 *
 * Usage:
 *   node scripts/organalysis/0-discover-domains.js [inventoryFile] [outputDir]
 *
 * Defaults:
 *   inventoryFile  ./reports/organalysis/inventory.json
 *   outputDir      ./reports/organalysis
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const ROOT           = process.cwd();
const INVENTORY_FILE = path.resolve(ROOT, process.argv[2] || 'reports/organalysis/inventory.json');
const OUTPUT_DIR     = path.resolve(ROOT, process.argv[3] || 'reports/organalysis');
const OUTPUT_FILE    = path.join(OUTPUT_DIR, 'domains.config.json');

// ─── Generic infrastructure tokens to discard ─────────────────────────────────
// These words are framework plumbing, not business concepts.

const STOP_TOKENS = new Set([
  'controller', 'test', 'tests', 'handler', 'helper', 'helpers',
  'manager', 'service', 'services', 'trigger', 'util', 'utils', 'utility',
  'page', 'pages', 'component', 'components', 'record', 'records',
  'form', 'forms', 'list', 'item', 'items', 'tile', 'tiles',
  'card', 'cards', 'button', 'buttons', 'bar', 'bars',
  'base', 'default', 'mock', 'mocks', 'factory', 'factories',
  'builder', 'builders', 'custom', 'main',
  'get', 'set', 'add', 'create', 'update', 'delete', 'remove',
  'find', 'search', 'view', 'edit', 'detail', 'details',
  'summary', 'new', 'old', 'my', 'the', 'and', 'or', 'for', 'by',
  'with', 'from', 'to', 'of', 'in', 'is', 'has', 'can', 'get',
  'batch', 'schedule', 'scheduled', 'async', 'sync',
  'related', 'related', 'override', 'extension', 'impl',
  'info', 'result', 'results', 'response', 'request',
  'error', 'errors', 'log', 'logs', 'event', 'events',
  'type', 'types', 'class', 'classes', 'object', 'objects',
  'field', 'fields', 'action', 'actions', 'flow', 'flows',
  'tab', 'tabs', 'app', 'apps', 'org', 'orgs',
  'lms', 'lwc', 'aura', 'sfdc', 'sf', 'api',
  'change', 'changes', 'format', 'formatted',
  'message', 'messages', 'notification', 'notifications',
  'post', 'push', 'pull', 'send', 'receive',
  'publish', 'publisher', 'subscribe', 'subscriber',
  'quick', 'start', 'sample', 'demo', 'test',
  'random', 'verify', 'validate', 'check',
  'picture', 'gallery', 'image', 'photo',
  'paged', 'paginator', 'pagination',
  'similar', 'related',
  // single chars and very short tokens
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
]);

// Minimum characters for a token to be considered meaningful
const MIN_TOKEN_LEN = 3;

// Minimum number of distinct components a token must appear in to become a domain seed
const MIN_FREQUENCY = 3;

// ─── Tokeniser ────────────────────────────────────────────────────────────────

/** Split a component name into lowercase business tokens. */
function tokenise(name) {
  return name
    // Remove Salesforce suffixes
    .replace(/__[cexb]$/i, '')
    // Split camelCase
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // Split on underscores, hyphens, spaces
    .split(/[_\-\s]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= MIN_TOKEN_LEN && !STOP_TOKENS.has(t));
}

// ─── Collect all component names ──────────────────────────────────────────────

function collectNames(inventory) {
  const names = [];
  const push  = (n, category) => names.push({ name: n, category });

  (inventory.objects        || []).forEach((o) => push(o.name, 'object'));
  (inventory.lwcComponents  || []).forEach((c) => push(c.name, 'lwc'));
  (inventory.auraComponents || []).forEach((c) => push(c.name, 'aura'));
  (inventory.apexClasses    || []).forEach((c) => {
    if (!c.isTest) push(c.name, 'apex');          // skip test classes for discovery
  });
  (inventory.flows          || []).forEach((f) => push(f.name, 'flow'));
  (inventory.flexiPages     || []).forEach((p) => push(p.name, 'flexipage'));
  (inventory.tabs           || []).forEach((t) => push(t.name, 'tab'));
  (inventory.triggers       || []).forEach((t) => push(t.name, 'trigger'));

  return names;
}

// ─── Token frequency analysis ─────────────────────────────────────────────────

/**
 * Count how many distinct component names each token appears in.
 * Returns a Map of token → Set<componentName>.
 */
function buildTokenIndex(names) {
  const index = new Map(); // token → Set of component names

  names.forEach(({ name }) => {
    const tokens = tokenise(name);
    tokens.forEach((tok) => {
      if (!index.has(tok)) index.set(tok, new Set());
      index.get(tok).add(name);
    });
  });

  return index;
}

// ─── Domain seed detection ────────────────────────────────────────────────────

/**
 * For each seed token, find co-occurring tokens (tokens that often appear
 * alongside the seed in the same component names). These become additional
 * patterns for the domain.
 */
function findCoTokens(seedToken, seedComponents, tokenIndex, topN = 5) {
  const coCount = new Map();

  seedComponents.forEach((compName) => {
    tokenise(compName).forEach((tok) => {
      if (tok === seedToken) return;
      coCount.set(tok, (coCount.get(tok) || 0) + 1);
    });
  });

  return [...coCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([tok]) => tok);
}

// ─── App-name helpers ─────────────────────────────────────────────────────────

/** Convert an app name or label to a safe domain id. */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Normalise a Lightning App tab reference to business tokens.
 * Strips standard- prefixes, __c/__x suffixes, then tokenises.
 */
function tabTokens(tab) {
  const cleaned = tab
    .replace(/^standard-/i, '')
    .replace(/__[cx]$/i, '');
  return tokenise(cleaned);
}

// ─── Phase 1: Application-based domain seeds ──────────────────────────────────

function buildAppDomains(inventory) {
  const apps = inventory.applications || [];
  if (!apps.length) return [];

  console.log(`\n=== Phase 1: Application-based domains ===`);

  return apps.map((app, idx) => {
    // Collect patterns from the app's tab names
    const tabPatterns = [...new Set(
      (app.tabs || []).flatMap(tabTokens)
    )];

    // Also include a slug of the app name itself as a pattern
    const appSlug = slugify(app.label || app.name);
    const namePattern = appSlug.replace(/_/g, '_?'); // allow optional underscores

    const patterns = [...new Set([namePattern, ...tabPatterns])];

    const appDescription = app.description
      || `Components belonging to the "${app.label || app.name}" Lightning Application.`;

    console.log(`  [app] "${app.label || app.name}"${app.description ? ' ✓ description' : ''}  →  patterns: ${patterns.join(', ')}`);

    return {
      id:          `app_${slugify(app.name)}`,
      name:        app.label || app.name,
      description: appDescription,
      patterns,
      priority:    9,
      _source:     'application',
      _appTabs:    app.tabs || [],
    };
  });
}

// ─── Config builder ───────────────────────────────────────────────────────────

function buildConfig(inventory) {
  const names      = collectNames(inventory);
  const tokenIndex = buildTokenIndex(names);

  // ── Phase 1: App-based domains ────────────────────────────────────────────
  const appDomains         = buildAppDomains(inventory);
  const assignedComponents = new Set();

  // Pre-assign components that match app domain patterns so Phase 2 skips them
  appDomains.forEach((d) => {
    names.forEach(({ name }) => {
      const norm = name.toLowerCase().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').replace(/__+/g, '_');
      const matched = d.patterns.some((pat) => {
        try { return new RegExp(pat, 'i').test(norm); } catch { return false; }
      });
      if (matched) assignedComponents.add(name);
    });
  });

  // Annotate app domains with their discovered components
  appDomains.forEach((d) => {
    d._discoveredComponents = names
      .filter(({ name }) => {
        const norm = name.toLowerCase().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').replace(/__+/g, '_');
        return d.patterns.some((pat) => {
          try { return new RegExp(pat, 'i').test(norm); } catch { return false; }
        });
      })
      .map(({ name }) => name)
      .sort();
  });

  // ── Phase 2: Token-frequency domains for remainder ────────────────────────
  const remainingNames = names.filter(({ name }) => !assignedComponents.has(name));
  const remainingIndex = buildTokenIndex(remainingNames);

  const seeds = [...remainingIndex.entries()]
    .filter(([, comps]) => comps.size >= MIN_FREQUENCY)
    .sort((a, b) => b[1].size - a[1].size);

  console.log(`\n=== Phase 2: Token-frequency domains (${remainingNames.length} unmatched components) ===`);
  if (seeds.length) {
    seeds.forEach(([tok, comps]) => console.log(`  "${tok}" → ${comps.size} components`));
  } else {
    console.log('  (all components matched by app-based domains)');
  }

  const tokenDomains = [];
  seeds.forEach(([tok, comps], idx) => {
    const coTokens  = findCoTokens(tok, comps, tokenIndex);
    const allTokens = [tok, ...coTokens];

    const ownComponents = [...comps].filter((c) => !assignedComponents.has(c));
    ownComponents.forEach((c) => assignedComponents.add(c));

    if (ownComponents.length === 0) return;

    const displayName = tok.charAt(0).toUpperCase() + tok.slice(1);

    tokenDomains.push({
      id:          `domain_${slugify(tok)}`,
      name:        `${displayName} (rename me)`,
      description: `Auto-suggested from token "${tok}". Rename to your business terminology.`,
      patterns:    allTokens,
      priority:    Math.max(2, 8 - idx),
      _source:     'token-frequency',
      _discoveredComponents: ownComponents.sort(),
    });
  });

  // ── Phase 3: Uncategorized catch-all ─────────────────────────────────────
  const uncategorizedComponents = names
    .filter(({ name }) => !assignedComponents.has(name))
    .map(({ name }) => name)
    .sort();

  const domains = [
    ...appDomains,
    ...tokenDomains,
    {
      id:          'uncategorized',
      name:        'Uncategorized',
      description: 'Components not matched to any domain. Review and move them to appropriate domains by adding patterns.',
      patterns:    [],
      priority:    1,
      _source:     'fallback',
      _discoveredComponents: uncategorizedComponents,
    },
  ];

  return {
    _instructions: [
      'This file was auto-generated by 0-discover-domains.js.',
      'App-based domains (marked _source: "application") are named from your org\'s Lightning Applications — verify their patterns.',
      'Token-based domains (marked _source: "token-frequency") need renaming to your business terminology.',
      'Patterns are lowercase regex fragments matched against normalised (snake_case) component names.',
      'Higher priority wins when a component matches multiple domains.',
      'The "uncategorized" domain catches anything unmatched — keep it last with empty patterns.',
      'The "_discoveredComponents" and "_source" fields are for reference only — ignored by 2-analyze.js.',
      'Once satisfied, run:  node scripts/organalysis/2-analyze.js',
    ],
    fallbackDomainId: 'uncategorized',
    domains,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  if (!fs.existsSync(INVENTORY_FILE)) {
    console.error(`ERROR: inventory file not found: ${INVENTORY_FILE}`);
    console.error('Run 1-inventory.js first.');
    process.exit(1);
  }

  console.log(`Reading inventory: ${INVENTORY_FILE}`);
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));

  const config = buildConfig(inventory);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Warn before overwriting
  if (fs.existsSync(OUTPUT_FILE)) {
    const backup = OUTPUT_FILE.replace('.json', '.backup.json');
    fs.copyFileSync(OUTPUT_FILE, backup);
    console.log(`\nExisting config backed up to: ${backup}`);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(config, null, 2), 'utf8');

  const domainCount        = config.domains.length - 1; // exclude uncategorized
  const uncategorized      = config.domains.find((d) => d.id === 'uncategorized');
  const uncategorizedCount = uncategorized?._discoveredComponents?.length ?? 0;

  console.log(`\n=== Discovery Complete ===`);
  console.log(`  Suggested domains  : ${domainCount}`);
  console.log(`  Uncategorized      : ${uncategorizedCount} components`);
  console.log(`\nConfig written: ${OUTPUT_FILE}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open and edit: ${OUTPUT_FILE}`);
  console.log(`     - Rename domain "name" fields to your business terminology`);
  console.log(`     - Merge domains that belong together`);
  console.log(`     - Add/remove patterns as needed`);
  console.log(`  2. Run analysis:  node scripts/organalysis/2-analyze.js`);
  console.log(`  3. Run report:    node scripts/organalysis/3-report.js`);
}

run();
