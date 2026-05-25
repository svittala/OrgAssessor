#!/usr/bin/env bash
# =============================================================================
# SMART — Salesforce Code Analyzer Runner
# =============================================================================
# Usage (run from the project root: CMIMS/):
#
#   bash scripts/code-analyzer/run-analysis.sh
#
# What it does:
#   Pass 1 — Recommended rules against all component types
#            (Apex, Triggers, VF Pages, Aura, LWC, Flows)
#   Pass 2 — Adds SFGE (Graph Engine / data-flow) rules for Apex & Triggers
#   Summary — Calls parse-results.js to print a violation breakdown
#
# Outputs (all written to reports/):
#   code-analysis.html           — Pass 1 full report (browser-readable)
#   code-analysis.csv            — Pass 1 raw data (filterable in Excel)
#   code-analysis-with-sfge.html — Pass 2 report (Apex + SFGE)
#   code-analysis-with-sfge.csv  — Pass 2 raw data
#   code-analysis-summary.txt    — Combined summary from parse-results.js
# =============================================================================

set -euo pipefail

# ── Resolve project root (script works from any working directory) ────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${PROJECT_ROOT}"

# ── Timestamp for labelling ───────────────────────────────────────────────────
RUN_DATE=$(date +"%Y-%m-%d %H:%M")

echo "========================================================"
echo "  CMIMS Code Analyzer"
echo "  ${RUN_DATE}"
echo "  Project: ${PROJECT_ROOT}"
echo "========================================================"
echo ""

# ── Pre-flight checks ─────────────────────────────────────────────────────────
echo ">>> Checking prerequisites..."

if ! command -v sf &>/dev/null; then
    echo "ERROR: 'sf' CLI not found. Install from https://developer.salesforce.com/tools/salesforcecli"
    exit 1
fi

SF_VERSION=$(sf version --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log((JSON.parse(d)||{}).cliVersion||'?'))" 2>/dev/null || echo "unknown")
echo "    sf CLI: ${SF_VERSION}"

if ! sf code-analyzer run --help &>/dev/null; then
    echo "ERROR: 'code-analyzer' plugin not installed."
    echo "       Install it with: sf plugins install code-analyzer"
    exit 1
fi

CA_VERSION=$(sf plugins 2>/dev/null | grep "code-analyzer" | awk '{print $2}' || echo "unknown")
echo "    code-analyzer plugin: ${CA_VERSION}"

if ! command -v node &>/dev/null; then
    echo "WARNING: node not found. Summary script will be skipped."
    SKIP_SUMMARY=true
else
    SKIP_SUMMARY=false
    echo "    node: $(node --version)"
fi

echo ""

# ── Create output directory ───────────────────────────────────────────────────
mkdir -p reports
echo ">>> Output directory: ${PROJECT_ROOT}/reports/"
echo ""

# ── PASS 1: Recommended rules — all component types ──────────────────────────
echo ">>> PASS 1: Recommended rules (all components)"
echo "    Targets: classes, triggers, pages, aura, lwc, flows"
echo "    Engines: pmd, eslint, flow, regex, cpd, retire-js"
echo "    This typically takes 25-40 seconds..."
echo ""

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

echo ""
echo ">>> Pass 1 complete."
echo "    Reports: reports/code-analysis.html"
echo "             reports/code-analysis.csv"
echo ""

# ── PASS 2: Add SFGE data-flow rules — Apex & Triggers only ──────────────────
echo ">>> PASS 2: Recommended + SFGE data-flow rules (Apex & Triggers)"
echo "    Targets: classes, triggers"
echo "    Extra engine: sfge (Salesforce Graph Engine — path analysis)"
echo "    NOTE: sfge is tagged DevPreview and is NOT included in 'Recommended'."
echo "          It performs deep data-flow analysis and can take 60-120 seconds."
echo ""

sf code-analyzer run \
    --workspace . \
    --target force-app/main/default/classes \
    --target force-app/main/default/triggers \
    --rule-selector Recommended \
    --rule-selector sfge \
    --output-file reports/code-analysis-with-sfge.html \
    --output-file reports/code-analysis-with-sfge.csv \
    --view table

echo ""
echo ">>> Pass 2 complete."
echo "    Reports: reports/code-analysis-with-sfge.html"
echo "             reports/code-analysis-with-sfge.csv"
echo ""

# ── SUMMARY ───────────────────────────────────────────────────────────────────
if [ "${SKIP_SUMMARY}" = "false" ]; then
    echo ">>> Generating summary..."
    node scripts/code-analyzer/parse-results.js \
        --pass1 reports/code-analysis.csv \
        --pass2 reports/code-analysis-with-sfge.csv \
        --out   reports/code-analysis-summary.txt
    echo ""
    cat reports/code-analysis-summary.txt
fi

echo ""
echo "========================================================"
echo "  Done. Open these files to review results:"
echo "    reports/code-analysis.html          (Pass 1 — all components)"
echo "    reports/code-analysis-with-sfge.html(Pass 2 — Apex + SFGE)"
echo "    reports/code-analysis-summary.txt   (Text summary)"
echo "========================================================"
