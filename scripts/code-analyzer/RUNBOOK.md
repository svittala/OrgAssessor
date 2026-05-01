# CMIMS — Salesforce Code Analyzer Runbook

How to run the full code quality analysis manually, interpret the results,
and act on the findings. No agent or automation required.

---

## Prerequisites

Before running, verify these are installed on your machine:

### 1. Salesforce CLI (`sf`)

```bash
sf version
# Expected: @salesforce/cli/2.x.x or higher
```

If not installed: https://developer.salesforce.com/tools/salesforcecli

### 2. Code Analyzer plugin

```bash
sf plugins
# Look for: code-analyzer x.x.x
```

If not installed:

```bash
sf plugins install code-analyzer
```

### 3. Python 3 (for the summary script)

```bash
python3 --version
# Expected: Python 3.9 or higher
```

### 4. Node / npm (already in the project — for Prettier autofix)

```bash
npm --version
```

---

## Quick Start (automated — one command)

From the project root (`CMIMS/`):

```bash
bash scripts/code-analyzer/run-analysis.sh
```

This runs both passes and generates all four output files automatically.
Jump to the **Understanding the Output** section to interpret results.

---

## Manual Step-by-Step

If you prefer to run each step individually, follow the steps below.

### Step 1 — Navigate to the project root

```bash
cd /path/to/CMIMS
```

All commands below assume you are in the project root.

### Step 2 — Create the output folder

```bash
mkdir -p reports
```

Only needed the first time. The `reports/` folder is where all output files land.

### Step 3 — Pass 1: Recommended rules, all component types

```bash
sf code-analyzer run \
  --workspace . \
  --target force-app/main/default/classes \
  --target force-app/main/default/triggers \
  --target force-app/main/default/pages \
  --target force-app/main/default/aura \
  --target force-app/main/default/lwc \
  --target force-app/main/default/flows \
  --rule-selector Recommended \
  --output-file reports/code-analysis.html \
  --output-file reports/code-analysis.csv \
  --view table
```

**What this does:**

| Flag | Purpose |
|---|---|
| `--workspace .` | Tells the analyzer the full project scope (needed for some engines to compile correctly) |
| `--target force-app/...` | Each `--target` adds a folder to scan; specify one per component type |
| `--rule-selector Recommended` | Runs only rules tagged Recommended (best signal-to-noise for first run) |
| `--output-file reports/code-analysis.html` | Self-contained HTML report — open directly in a browser |
| `--output-file reports/code-analysis.csv` | Raw data — open in Excel or filter with Python |
| `--view table` | Shows a concise table in the terminal while running |

**Engines that fire automatically based on file type:**

| Engine | Files it analyzes |
|---|---|
| `pmd` | Apex classes, triggers, Visualforce pages |
| `flow` | Flow metadata (`.flow-meta.xml`) |
| `eslint` | JavaScript in LWC and Aura components |
| `regex` | All file types (API versions, trailing whitespace, etc.) |
| `cpd` | Apex classes and triggers (copy-paste detection) |
| `retire-js` | JavaScript (known vulnerable library versions) |

**Expected runtime:** 25–40 seconds

---

### Step 4 — Pass 2: Add SFGE (Salesforce Graph Engine)

> **Why a separate pass?**
> SFGE rules are tagged `DevPreview`, not `Recommended`, so they are excluded from Pass 1.
> SFGE does deep **data-flow path analysis** — it traces how data moves through your code
> across method calls and is far more accurate for security findings than pattern-matching engines.
> It only applies to Apex (classes and triggers).

```bash
sf code-analyzer run \
  --workspace . \
  --target force-app/main/default/classes \
  --target force-app/main/default/triggers \
  --rule-selector Recommended \
  --rule-selector sfge \
  --output-file reports/code-analysis-with-sfge.html \
  --output-file reports/code-analysis-with-sfge.csv \
  --view table
```

**What changes vs Pass 1:**

- Targets are reduced to Apex classes and triggers only (SFGE does not apply to flows, LWC, VF)
- `--rule-selector sfge` is added alongside `Recommended`
- Output files are separate so you can diff the two runs

**SFGE rules included:**

| Rule | Severity | What it checks |
|---|---|---|
| `ApexFlsViolation` | High | Field-Level Security missing before SOQL read/write |
| `DatabaseOperationsMustUseWithSharing` | High | SOQL/DML in classes without sharing enforcement |
| `AvoidDatabaseOperationInLoop` | High | SOQL or DML inside a for-each loop (governor limit risk) |
| `MissingNullCheckOnSoqlVariable` | Moderate | SOQL single-row result used without null check |
| `ApexNullPointerException` | Moderate | NullPointerException risk traced via path analysis |
| `AvoidMultipleMassSchemaLookups` | High | Repeated Schema.getGlobalDescribe() calls (performance) |
| `UnimplementedType` | Low | Interface or abstract class with unimplemented methods |

**Expected runtime:** 60–120 seconds (path analysis is heavier than pattern matching)

---

### Step 5 — Generate the text summary

```bash
python3 scripts/code-analyzer/parse-results.py \
  --pass1 reports/code-analysis.csv \
  --pass2 reports/code-analysis-with-sfge.csv \
  --out   reports/code-analysis-summary.txt
```

This prints a formatted summary to the terminal and saves it to
`reports/code-analysis-summary.txt`. It shows:

- Combined totals (High, Moderate, Low, Info)
- Breakdown by severity, engine, and component type
- Top 15 rules by violation count
- SFGE-specific findings isolated
- Top 10 files by violation count
- Prioritised remediation checklist

---
### Step 6 — Generate Profile and Permissionset analysis
```bash
python3 scripts/code-analyzer/analyze_permissions.py \
```
This generates 2 files reports folder
   - permission-analysis-results.csv and 
   - permission-analysis-summary.csv

This also prints a formatted summary to the terminal and saves it to
`reports/permission-analysis-summary.txt`. It shows:

- Combined totals (High, Moderate, Low, Info)
- Breakdown by severity, engine, and component type
- Top 15 rules by violation count
- SFGE-specific findings isolated
- Top 10 files by violation count
- Prioritised remediation checklist

### That is all the steps - you are done here 
## Understanding the Output

### Output files

| File | Format | Best for |
|---|---|---|
| `reports/code-analysis.html` | HTML | Reviewing results in a browser; supports filtering and sorting |
| `reports/code-analysis.csv` | CSV | Filtering in Excel, or querying with Python/SQL |
| `reports/code-analysis-with-sfge.html` | HTML | Same as above but includes SFGE findings for Apex |
| `reports/code-analysis-with-sfge.csv` | CSV | Isolating SFGE violations (`engine == sfge` column) |
| `reports/code-analysis-summary.txt` | Plain text | Quick terminal read; good for sharing or pasting into a ticket |

### CSV columns explained

| Column | Description |
|---|---|
| `rule` | Rule name (e.g. `ApexFlsViolation`) |
| `engine` | Which engine flagged it (`pmd`, `sfge`, `flow`, etc.) |
| `severity` | Number: 1=Critical, 2=High, 3=Moderate, 4=Low, 5=Info |
| `tags` | Rule categories (e.g. `Security`, `Performance`, `Recommended`) |
| `file` | Relative path to the file with the violation |
| `startLine` | Line number where the violation starts |
| `message` | Human-readable description of what was found |
| `resources` | Link to documentation for the rule |

### Severity guide

| Severity | When to fix |
|---|---|
| **High (2)** | Fix before next deployment — security and governor-limit risks |
| **Moderate (3)** | Fix in the current sprint — reliability and quality issues |
| **Low (4)** | Fix when touching the file — style, naming, documentation |
| **Info (5)** | Autofix with Prettier or ignore — whitespace, formatting |

---

## Filtering the CSV in Excel

1. Open `reports/code-analysis.csv` in Excel
2. Select row 1 → Data → Filter
3. Useful filters:
   - `severity = 2` → show only High violations
   - `engine = sfge` → show only SFGE data-flow findings
   - `engine = pmd` → show only PMD static analysis
   - `tags contains Security` → show only security-tagged rules
   - `file contains FOIAExport` → show violations in a specific file

---

## Filtering the CSV with Python (quick one-liners)

Show only High SFGE violations:
```bash
python3 -c "
import csv
with open('reports/code-analysis-with-sfge.csv') as f:
    rows = [r for r in csv.DictReader(f) if r['engine']=='sfge' and r['severity']=='2']
print(f'{len(rows)} High SFGE violations')
for r in rows:
    print(f\"  {r['rule']}: {r['file'].split('/')[-1]}:{r['startLine']}\")
"
```

Show violations by file for a specific class:
```bash
python3 -c "
import csv
cls = 'FOIAExportController'
with open('reports/code-analysis-with-sfge.csv') as f:
    rows = [r for r in csv.DictReader(f) if cls in r['file']]
print(f'{len(rows)} violations in {cls}')
for r in rows:
    print(f\"  [{r['engine']}] {r['rule']} (sev {r['severity']}) line {r['startLine']}\")
"
```

---

## Exploring available rules

Before running, you can preview which rules will fire:

```bash
# List all Recommended rules
sf code-analyzer rules --rule-selector Recommended --view detail

# List all SFGE rules
sf code-analyzer rules --rule-selector sfge --view detail

# List all rules across all engines
sf code-analyzer rules --rule-selector all --view detail

# List only security-tagged rules
sf code-analyzer rules --rule-selector Security --view detail

# List only High-severity PMD rules
sf code-analyzer rules --rule-selector "pmd:2" --view detail
```

---

## Running a targeted scan (single file or folder)

You do not need to scan the entire project every time.
To scan just one class or component:

```bash
# Single Apex class
sf code-analyzer run \
  --workspace . \
  --target force-app/main/default/classes/FOIAExportController.cls \
  --rule-selector Recommended \
  --rule-selector sfge \
  --view detail

# All LWC components only
sf code-analyzer run \
  --workspace . \
  --target force-app/main/default/lwc \
  --rule-selector Recommended \
  --view table
```

`--view detail` shows the full violation message and resource link for each finding.

---

## Customising rules with a config file

To tune severity levels, disable noisy rules, or enable the project ESLint config:

```bash
# Generate a starter config file
sf code-analyzer config --output-file code-analyzer.yml
```

Then edit `code-analyzer.yml`. Example customisations:

```yaml
engines:
  eslint:
    # Wire in the project's eslint.config.js
    eslint_config_file: "eslint.config.js"
  sfge:
    # Disable SFGE if you want Pass 1 only
    disabled: false

rules:
  # Downgrade noisy Info rules to suppress from default output
  regex:NoTrailingWhitespace:
    severity: 5   # keep as Info (already is, just documenting)
  pmd:ApexDoc:
    severity: 5   # downgrade from Low to Info if doc is low priority
```

Once saved, Code Analyzer automatically picks up `code-analyzer.yml` from
the project root — no extra flags needed.

---

## Remediation priority order

Based on the CMIMS scan results (Apr 2026):

### Priority 1 — Security (fix before next deployment)

| Violation | Count | Fix |
|---|---|---|
| `PreventPassingUserDataIntoElementWithoutSharing` | 348 | Add sharing rules to Flows that write user-input data |
| `ApexFlsViolation` (SFGE) | 41 | Add `Security.stripInaccessible()` or `WITH SECURITY_ENFORCED` before SOQL |
| `DatabaseOperationsMustUseWithSharing` (SFGE) | 19 | Change class declaration to `with sharing` or `inherited sharing` |
| `ApexCRUDViolation` | 91 | Add `isAccessible()` / `isUpdateable()` checks before DML |
| `AvoidHardcodingId` | 52 | Move hardcoded IDs to Custom Metadata or Custom Labels |
| `AvoidOldSalesforceApiVersions` | 104 | Bump all metadata to API version 63.0+ |

### Priority 2 — Reliability

| Violation | Count | Fix |
|---|---|---|
| `AvoidDatabaseOperationInLoop` (SFGE) | 6 | Move SOQL outside loops; query by collected ID sets |
| `MissingNullCheckOnSoqlVariable` (SFGE) | 24 | Null-check single-row SOQL results before field access |
| `SameRecordUpdate` | 170 | Consolidate multiple updates on same record into one Flow element |

### Priority 3 — Code quality

| Violation | Count | Fix |
|---|---|---|
| `AvoidDebugStatements` | 507 | Remove `System.debug()` calls or gate with logging level |
| `DebugsShouldUseLoggingLevel` | 496 | Use `System.debug(LoggingLevel.DEBUG, msg)` pattern |
| `ApexUnitTestClassShouldHaveRunAs` | 208 | Wrap test logic in `System.runAs()` |
| `ApexUnitTestClassShouldHaveAsserts` | 42 | Add `System.assert*` to every test method |

### Priority 4 — Formatting (autofix)

```bash
# Fix trailing whitespace and indentation across the whole project
npm run prettier
```

This resolves `NoTrailingWhitespace` (504) and `NoMixedIndentation` (62) automatically.

---

## Re-running after fixes

After fixing a batch of violations, re-run the full analysis to verify:

```bash
bash scripts/code-analyzer/run-analysis.sh
```

Compare the new `reports/code-analysis-summary.txt` against the previous run.
You can keep dated copies:

```bash
cp reports/code-analysis-summary.txt reports/code-analysis-summary-$(date +%Y-%m-%d).txt
```
