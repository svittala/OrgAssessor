# OrgAssessor

OrgAssessor is a Node.js-based library designed for comprehensive Salesforce code analysis and organizational assessment. It works entirely with **local metadata access**, meaning no active connection to a Salesforce org is required during the analysis phase.

The project provides two primary modules:
1.  **Salesforce Code Analyzer (SCA)**: Automated multi-pass code quality and security analysis.
2.  **Org Analysis**: Metadata-driven discovery and classification of components into business capabilities.

---

## 🚀 Key Features

### 1. Salesforce Code Analyzer (SCA)
Orchestrates the Salesforce Code Analyzer solution to perform deep static analysis and data-flow path analysis.
*   **Multi-Pass Analysis**:
    *   **Pass 1**: Recommended rules across all component types (Apex, LWC, Aura, Flow, etc.).
    *   **Pass 2**: Deep data-flow analysis (SFGE) for Apex and Triggers to find complex security vulnerabilities.
*   **Prioritized Reporting**: Generates HTML and CSV reports, along with a text summary that categorizes issues by priority (Critical, High, Moderate, Low) and error type.
*   **Permission Analysis**: Dedicated script to analyze Profiles and Permission Sets for excessive or dangerous permissions.

### 2. Org Analysis (Business Capability Matrix)
Generates a summary of org contents organized by business capabilities.
*   **Automated Discovery**: Identifies common name tokens across components to suggest business domains.
*   **Business Capability Matrix**: Maps components (Apex, LWC, Flows, etc.) to specific business domains (e.g., Commerce, Support, Billing).
*   **Interactive Reports**: Produces a self-contained HTML report with tabs for Capability Matrix, Domain Breakdown, Personas, and Integrations.
*   **Assumptions**: This module assumes the org metadata is organized such that business functionality can be inferred from naming conventions and site structures.

---

## 📋 Prerequisites

Before running the scripts, ensure you have the following installed:

*   **Node.js**: Version 18.x or higher.
*   **Salesforce CLI (`sf`)**: [Install Guide](https://developer.salesforce.com/tools/salesforcecli).
*   **Code Analyzer Plugin**:
    ```bash
    sf plugins install code-analyzer
    ```

---

## 🛠️ Usage

### 1. Salesforce Code Analysis
To run the full code analysis pipeline (Pass 1, Pass 2, and Summary):

```bash
# From the project root
bash scripts/code-analyzer/run-analysis.sh
```

**Individual Steps**:
*   **Run Analysis**: `node scripts/code-analyzer/run-analysis.js`
*   **Generate Summary**: `node scripts/code-analyzer/parse-results.js`
*   **Analyze Permissions**: `node scripts/code-analyzer/analyze-permissions.js`

### 2. Org Analysis
To generate the Business Capability Matrix:

```bash
# From the project root
node scripts/organalysis/run-all.js <forceAppPath> <outputDir>

# Example:
node scripts/organalysis/run-all.js force-app/main/default reports/my-org
```

On the first run, it will generate a `domains.config.json`. You should review and edit this file to map your naming patterns to business domains, then re-run the script to generate the final report.

---

## 📊 Reports

All reports are generated in the `reports/` directory:

*   **`reports/code-analysis.html`**: Interactive SCA report for Pass 1.
*   **`reports/code-analysis-with-sfge.html`**: SCA report including deep path analysis.
*   **`reports/code-analysis-summary.txt`**: Prioritized text summary of all code issues.
*   **`reports/permission-analysis-summary.txt`**: Human-readable report of permission risks.
*   **`reports/organalysis/capability-matrix-<timestamp>.html`**: Interactive Business Capability Matrix.

---

## 📂 Project Structure

*   `scripts/code-analyzer/`: Scripts for SCA, permission analysis, and result parsing.
*   `scripts/organalysis/`: Scripts for metadata inventory, domain discovery, and capability reporting.
*   `code-analyzer.yml`: Configuration for the Salesforce Code Analyzer engines.
