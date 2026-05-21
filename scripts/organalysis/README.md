# Org Analysis Scripts

Generates a **Business Capability Matrix** from Salesforce org metadata — no org connection required. Works entirely from a local `force-app` directory.

---

## How It Works

The pipeline has four scripts. Each produces a file that feeds the next.

```
0-discover-domains.js   →   domains.config.json   (you edit this)
        ↓
1-inventory.js          →   inventory.json
        ↓
2-analyze.js            →   analysis.json
        ↓
3-report.js             →   capability-matrix-<timestamp>.html
```

**Step 0 (discovery)** is the key to making this work on any org. It reads your metadata, finds common name tokens across components, and suggests business domains for you to review. You rename, merge, and tune those domains once — then every subsequent run skips Step 0 and goes straight to the report.

---

## First Run on a New Org

```bash
# 1. Pull the org metadata locally (if not already done)
sf project retrieve start --target-org <alias>

# 2. Run the pipeline — it will auto-run discovery since no config exists yet
node scripts/organalysis/run-all.js <forceAppPath> <outputDir>

# Example:
node scripts/organalysis/run-all.js force-app/main/default reports/my-org
```

On the first run, the pipeline stops after Step 0 and prints:

```
ACTION REQUIRED
  A starter domains.config.json has been written to:
    reports/my-org/domains.config.json

  Before generating the report, open that file and:
    1. Rename each domain's "name" field to your business terminology
    2. Merge any domains that represent the same business area
    3. Adjust patterns to move components to the right domain
    4. Check the "uncategorized" domain for components that need placing
```

Open `domains.config.json`, edit it, then re-run the same command to get the full report.

---

## Subsequent Runs (config already exists)

```bash
# Re-run everything — discovery is skipped automatically
node scripts/organalysis/run-all.js

# Or via npm (uses default paths)
npm run org:analyze
```

---

## Editing `domains.config.json`

This is the only file you need to understand. It looks like this:

```json
{
  "_instructions": "...",
  "fallbackDomainId": "uncategorized",
  "domains": [
    {
      "id": "commerce",
      "name": "Commerce & Product Management",
      "description": "Product catalog, pricing, and ordering.",
      "patterns": ["product", "order", "bike", "price"],
      "priority": 8,
      "_discoveredComponents": ["OrderController", "ProductCard", ...]
    },
    {
      "id": "uncategorized",
      "name": "Uncategorized",
      "description": "Components not yet assigned to a domain.",
      "patterns": [],
      "priority": 1,
      "_discoveredComponents": [...]
    }
  ]
}
```

### Fields explained

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Short unique identifier. Used internally — no spaces. |
| `name` | Yes | Display name shown in the report. Use your business terminology. |
| `description` | No | One-sentence description of what this domain covers. |
| `patterns` | Yes | Array of lowercase regex fragments matched against component names. |
| `priority` | No | 1–10. Higher priority wins when a component matches multiple domains. Default: 5. |
| `_discoveredComponents` | No | Reference list written by the discovery script. **Ignored by 2-analyze.js** — safe to delete. |

### How patterns work

Patterns are matched against a **normalised** (lowercase + snake_case) version of each component name:
- `ProductController` → `product_controller`
- `orderItemTile` → `order_item_tile`
- `Order__c` → `order_c`

So `"product"` matches `ProductController`, `productCard`, `ProductRecord`, etc.

Use standard regex:
- `"^order"` — name must start with "order"
- `"order(?!_item)"` — "order" but not "order_item"
- `"(account|contact)"` — either word

### Common edits

**Rename a domain** — just change the `name` field:
```json
"name": "My Actual Business Term"
```

**Move a component to a different domain** — add its distinguishing token to that domain's patterns:
```json
"patterns": ["product", "order", "bike", "custom_token_here"]
```

**Merge two domains** — copy all patterns from one into the other, delete the merged domain.

**Reduce the "Uncategorized" bucket** — look at `_discoveredComponents` under `uncategorized`, identify the naming pattern, and add it to the right domain's `patterns` array.

**Re-run discovery from scratch** (resets the config):
```bash
npm run org:analyze:discover
# Note: backs up the existing config to domains.config.backup.json first
```

---

## Running Against a Different Org

```bash
# Minimal — uses default output directory
node scripts/organalysis/run-all.js /path/to/other-org/force-app/main/default

# With custom output directory
node scripts/organalysis/run-all.js /path/to/other-org/force-app/main/default ./reports/other-org

# With a shared, pre-approved domains config (skip discovery entirely)
node scripts/organalysis/run-all.js /path/to/org/force-app/main/default ./reports/org ./my-domains.config.json
```

The output directory is created automatically if it does not exist.

---

## Running Steps Individually

Useful when iterating on domain patterns without re-scanning metadata.

```bash
# Step 0 — Re-run discovery (overwrites config, backs up old one first)
npm run org:analyze:discover
node scripts/organalysis/0-discover-domains.js [inventoryFile] [outputDir]

# Step 1 — Inventory only (fast, idempotent)
npm run org:analyze:inventory
node scripts/organalysis/1-inventory.js [forceAppPath] [outputDir]

# Steps 2 + 3 — Re-classify and re-report after editing domains.config.json
node scripts/organalysis/2-analyze.js && node scripts/organalysis/3-report.js

# Step 2 — Classify with a specific config file
node scripts/organalysis/2-analyze.js reports/organalysis/inventory.json reports/organalysis ./my-domains.config.json

# Step 3 — Report only
npm run org:analyze:report
node scripts/organalysis/3-report.js [analysisFile] [outputDir]
```

---

## Output Files

All written to `outputDir` (default: `reports/organalysis/`):

| File | Created by | Description |
|---|---|---|
| `domains.config.json` | Step 0 | Domain definitions — **the file you edit** |
| `domains.config.backup.json` | Step 0 | Auto-backup of previous config before overwrite |
| `inventory.json` | Step 1 | Raw metadata counts and parsed component list |
| `analysis.json` | Step 2 | Every component classified into a domain |
| `capability-matrix-<timestamp>.html` | Step 3 | Self-contained interactive HTML report |

The HTML report has four tabs:
- **Capability Matrix** — one row per domain with all supporting components
- **Domain Breakdown** — card per domain showing objects, LWC, Aura, Apex, flows, pages
- **Personas** — inferred from profiles and permission sets
- **Integrations** — detected from CSP trusted sites, remote sites, named credentials, Apex callouts

---

## Typical Iteration Loop

```
Run once            →  domains.config.json created
Edit config         →  rename domains, fix uncategorized bucket
Re-run steps 2+3   →  new report with your business domain names
Repeat             →  until the uncategorized count is acceptably small
```

```bash
# Iteration shortcut — no need to re-scan metadata
node scripts/organalysis/2-analyze.js && \
node scripts/organalysis/3-report.js && \
open $(ls -t reports/organalysis/*.html | head -1)
```

---

## Prerequisites

- **Node.js >= 10.13** — check with `node --version`
- Salesforce metadata retrieved locally under `force-app/main/default/`
- No npm packages needed — only Node.js built-ins are used

---

## Troubleshooting

**`ERROR: force-app path not found`**
Verify the path exists: `ls force-app/main/default`

**`ERROR: No domains.config.json found`**
Run `npm run org:analyze:discover` (or `node scripts/organalysis/run-all.js`) to generate one.

**`ERROR: inventory file not found`**
Run Step 1 before Step 2: `npm run org:analyze:inventory`

**Too many components in "Uncategorized"**
Open `domains.config.json`, look at `_discoveredComponents` under the `uncategorized` domain, identify what the names have in common, and add a pattern to the right domain.

**A component lands in the wrong domain**
Add its distinguishing name fragment to the correct domain's `patterns` array, then re-run Steps 2 and 3.

**Report is blank**
Open the HTML file directly in a browser (not inside an iframe). All assets are inlined — no server needed.
