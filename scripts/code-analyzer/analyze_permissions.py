#!/usr/bin/env python3
"""
Analyze Salesforce profiles and permission sets for excessive permissions.

Checks:
  1. System-level userPermissions (ViewAllData, ModifyAllData, ManageUsers, etc.)
  2. Object-level viewAllRecords / modifyAllRecords grants per object
  3. Dangerous combinations (e.g. AuthorApex + ModifyAllData)

Outputs (all written to <project-root>/reports/):
  permission-analysis-results.csv    — every individual finding (one row each)
  permission-analysis-summary.csv    — one row per profile/permset with risk score
  permission-analysis-summary.txt    — human-readable ranked report (mirrors console)

Usage (from any directory):
  python3 scripts/code-analyzer/analyze_permissions.py [--csv-only] [--quiet]

Options:
  --csv-only   Write CSV/TXT files but suppress console output.
  --quiet      Suppress per-component detail; print top-10 table and file paths only.
"""

import csv
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

# ── Path resolution (works regardless of cwd) ─────────────────────────────────

SCRIPT_DIR   = Path(__file__).parent.resolve()          # scripts/code-analyzer/
PROJECT_ROOT = (SCRIPT_DIR / ".." / "..").resolve()     # project root

SOURCE_ROOT  = PROJECT_ROOT / "force-app" / "main" / "default"
PROFILES_DIR = SOURCE_ROOT / "profiles"
PERMSETS_DIR = SOURCE_ROOT / "permissionsets"
REPORTS_DIR  = PROJECT_ROOT / "reports"

OUTPUT_FINDINGS    = REPORTS_DIR / "permission-analysis-results.csv"
OUTPUT_SUMMARY_CSV = REPORTS_DIR / "permission-analysis-summary.csv"
OUTPUT_SUMMARY_TXT = REPORTS_DIR / "permission-analysis-summary.txt"

NS = "http://soap.sforce.com/2006/04/metadata"

# ── Risk catalogue ────────────────────────────────────────────────────────────
# Risk levels: 1=Critical, 2=High, 3=Medium

SYSTEM_PERMISSIONS = {
    # ── Critical ──────────────────────────────────────────────────────────────
    "ViewAllData":                  (1, "View All Data — can read every record in the org regardless of sharing"),
    "ModifyAllData":                (1, "Modify All Data — can create, edit, delete every record in the org"),
    "ManageUsers":                  (1, "Manage Users — can create/edit/deactivate any user and assign any profile"),
    "ManageProfilesPermissionsets": (1, "Manage Profiles & Permission Sets — can escalate any user's privileges"),
    "ResetPasswords":               (1, "Reset Passwords & Unlock Users — can take over any user account"),
    # ── High ──────────────────────────────────────────────────────────────────
    "AuthorApex":                   (2, "Author Apex — can execute arbitrary server-side code"),
    "ManageEncryptionKeys":         (2, "Manage Encryption Keys — can access Shield Platform Encryption keys"),
    "ViewEncryptedData":            (2, "View Encrypted Data — can read Shield-encrypted field values"),
    "BulkApiHardDelete":            (2, "Bulk API Hard Delete — can permanently destroy records bypassing Recycle Bin"),
    "DataExport":                   (2, "Data Export — can export the full org dataset"),
    "QueryAllFiles":                (2, "Query All Files — can read all files/ContentDocument regardless of sharing"),
    "ManageSandboxes":              (2, "Manage Sandboxes — can create sandboxes that copy production data"),
    "InstallPackaging":             (2, "Download AppExchange Packages — can install arbitrary third-party code"),
    "ManageTranslation":            (2, "Manage Translation — can modify all translated labels org-wide"),
    "ViewAllUsers":                 (2, "View All Users — can see all users including deactivated"),
    "ManageDataIntegrations":       (2, "Manage Data Integrations — can configure and run data integrations"),
    # ── Medium ────────────────────────────────────────────────────────────────
    "EditPublicReports":            (3, "Create & Customize Reports — can create reports across all visible data"),
    "ManageReports":                (3, "Manage Reports — can create/edit/delete all public reports"),
    "EditPublicDashboards":         (3, "Create Public Dashboards — can publish dashboards to all users"),
    "ManageDashboards":             (3, "Manage Dashboards — can create/edit/delete all dashboards"),
    "RunReports":                   (3, "Run Reports — can run any report they have access to"),
    "ScheduleReports":              (3, "Schedule Reports — can schedule report delivery to any user"),
    "ManageCustomPermissions":      (3, "Manage Custom Permissions — can assign custom permissions to any perm set"),
    "FlowUFLRequired":              (3, "Flow User — can run flows that may modify data"),
    "ManageFlows":                  (3, "Manage Flows — can create/edit/delete any flow"),
    "ConvertLeads":                 (3, "Convert Leads — can convert leads creating Account/Contact/Opportunity"),
    "TransferAnyEntity":            (3, "Transfer Record — can transfer ownership of any record"),
    "TransferAnyLead":              (3, "Transfer Leads — can transfer any lead to any user"),
    "MassInlineEdit":               (3, "Mass Inline Edit — can bulk-edit records in list views"),
    "ViewSetup":                    (3, "View Setup & Configuration — can read all setup metadata"),
}

# Dangerous combinations — both permissions must be enabled=true
DANGEROUS_COMBOS = [
    ({"AuthorApex", "ModifyAllData"},               1, "AuthorApex + ModifyAllData: can write arbitrary code that modifies every record"),
    ({"ManageUsers", "ResetPasswords"},              1, "ManageUsers + ResetPasswords: can fully take over any user account"),
    ({"ViewAllData", "DataExport"},                  1, "ViewAllData + DataExport: can exfiltrate the entire org dataset"),
    ({"ManageProfilesPermissionsets", "ManageUsers"},1, "ManageProfiles + ManageUsers: full privilege escalation path"),
    ({"AuthorApex", "ViewAllData"},                  2, "AuthorApex + ViewAllData: code can silently read all records"),
    ({"BulkApiHardDelete", "ModifyAllData"},          2, "BulkApiHardDelete + ModifyAllData: can permanently destroy all data"),
    ({"ManageEncryptionKeys", "ViewEncryptedData"},  2, "ManageEncryptionKeys + ViewEncryptedData: full access to encrypted data"),
    ({"InstallPackaging", "ModifyAllData"},           2, "InstallPackaging + ModifyAllData: third-party code with unrestricted DML"),
]

RISK_LABEL = {1: "CRITICAL", 2: "HIGH", 3: "MEDIUM"}
RISK_SCORE = {1: 10, 2: 4, 3: 1}

# ── XML helpers ───────────────────────────────────────────────────────────────

def tag(local: str) -> str:
    return f"{{{NS}}}{local}"

def parse_file(path: Path):
    """Return (root_element, metadata_type_str)."""
    tree = ET.parse(path)
    root = tree.getroot()
    if root.tag == tag("Profile"):
        return root, "Profile"
    if root.tag == tag("PermissionSet"):
        return root, "PermissionSet"
    return root, "Unknown"

def get_enabled_user_permissions(root) -> set[str]:
    enabled = set()
    for up in root.findall(tag("userPermissions")):
        enabled_el = up.find(tag("enabled"))
        name_el    = up.find(tag("name"))
        if enabled_el is not None and name_el is not None:
            if enabled_el.text and enabled_el.text.strip().lower() == "true":
                enabled.add(name_el.text.strip())
    return enabled

def get_object_permissions(root) -> list[dict]:
    results = []
    for op in root.findall(tag("objectPermissions")):
        obj_el  = op.find(tag("object"))
        view_el = op.find(tag("viewAllRecords"))
        mod_el  = op.find(tag("modifyAllRecords"))
        if obj_el is None:
            continue
        view_all   = view_el is not None and view_el.text  and view_el.text.strip().lower()  == "true"
        modify_all = mod_el  is not None and mod_el.text   and mod_el.text.strip().lower()   == "true"
        if view_all or modify_all:
            results.append({"object": obj_el.text.strip(), "viewAll": view_all, "modifyAll": modify_all})
    return results

# ── Analysis ──────────────────────────────────────────────────────────────────

def analyze_file(path: Path) -> dict:
    root, meta_type = parse_file(path)
    name = path.name.replace(".profile-meta.xml", "").replace(".permissionset-meta.xml", "")

    enabled_perms = get_enabled_user_permissions(root)
    obj_perms     = get_object_permissions(root)

    findings   = []
    risk_score = 0

    for perm, (risk, desc) in SYSTEM_PERMISSIONS.items():
        if perm in enabled_perms:
            findings.append({"type": "SystemPermission", "permission": perm,
                             "risk": RISK_LABEL[risk], "risk_level": risk, "detail": desc, "object": ""})
            risk_score += RISK_SCORE[risk]

    for op in obj_perms:
        if op["modifyAll"]:
            findings.append({"type": "ObjectPermission", "permission": "modifyAllRecords",
                             "risk": "HIGH", "risk_level": 2,
                             "detail": f"Modify All Records on {op['object']}", "object": op["object"]})
            risk_score += RISK_SCORE[2]
        elif op["viewAll"]:
            findings.append({"type": "ObjectPermission", "permission": "viewAllRecords",
                             "risk": "MEDIUM", "risk_level": 3,
                             "detail": f"View All Records on {op['object']}", "object": op["object"]})
            risk_score += RISK_SCORE[3]

    combos_hit = []
    for (perm_set, risk, desc) in DANGEROUS_COMBOS:
        if perm_set.issubset(enabled_perms):
            combos_hit.append({"type": "DangerousCombo", "permission": " + ".join(sorted(perm_set)),
                               "risk": RISK_LABEL[risk], "risk_level": risk, "detail": desc, "object": ""})
            risk_score += RISK_SCORE[risk] * 2   # combos weighted double

    return {
        "name": name, "meta_type": meta_type,
        "findings": findings, "combos": combos_hit,
        "risk_score": risk_score,
        "enabled_perms": enabled_perms, "obj_perms": obj_perms,
    }

def overall_risk(score: int) -> str:
    if score >= 20: return "CRITICAL"
    if score >= 10: return "HIGH"
    if score >= 3:  return "MEDIUM"
    return "LOW"

# ── Output helpers ────────────────────────────────────────────────────────────

class Reporter:
    """Writes lines to both stdout and a text file simultaneously."""

    def __init__(self, txt_path: Path, silent: bool = False):
        self._silent = silent
        self._fh = open(txt_path, "w", encoding="utf-8")

    def write(self, line: str = ""):
        if not self._silent:
            print(line)
        self._fh.write(line + "\n")

    def close(self):
        self._fh.close()

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    csv_only = "--csv-only" in sys.argv
    quiet    = "--quiet"    in sys.argv

    # Ensure reports directory exists
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    # Scan all profiles and permission sets
    all_results = []
    for directory, glob_pat in [
        (PROFILES_DIR, "*.profile-meta.xml"),
        (PERMSETS_DIR, "*.permissionset-meta.xml"),
    ]:
        if not directory.exists():
            print(f"WARNING: directory not found — {directory}", file=sys.stderr)
            continue
        for path in sorted(directory.glob(glob_pat)):
            all_results.append(analyze_file(path))

    all_results.sort(key=lambda r: -r["risk_score"])

    # ── Text report (console + .txt file) ─────────────────────────────────────
    rpt = Reporter(OUTPUT_SUMMARY_TXT, silent=csv_only)
    run_ts = datetime.now().strftime("%Y-%m-%d %H:%M")

    critical = [r for r in all_results if overall_risk(r["risk_score"]) == "CRITICAL"]
    high     = [r for r in all_results if overall_risk(r["risk_score"]) == "HIGH"]
    medium   = [r for r in all_results if overall_risk(r["risk_score"]) == "MEDIUM"]
    low      = [r for r in all_results if overall_risk(r["risk_score"]) == "LOW"]

    rpt.write(f"\n{'='*72}")
    rpt.write(f"  ASETT PERMISSION ANALYSIS")
    rpt.write(f"  {run_ts}  |  Project: {PROJECT_ROOT}")
    rpt.write(f"  {len(all_results)} profiles/permission-sets scanned")
    rpt.write(f"{'='*72}")
    rpt.write(f"\n  CRITICAL: {len(critical)}   HIGH: {len(high)}   MEDIUM: {len(medium)}   LOW (clean): {len(low)}\n")

    if not quiet:
        for result in all_results:
            if not result["findings"] and not result["combos"]:
                continue
            risk = overall_risk(result["risk_score"])
            rpt.write(f"\n{'─'*72}")
            rpt.write(f"  [{risk}]  {result['name']}  ({result['meta_type']})  score={result['risk_score']}")
            rpt.write(f"{'─'*72}")

            for c in sorted(result["combos"], key=lambda x: x["risk_level"]):
                rpt.write(f"  !! COMBO [{c['risk']}]  {c['permission']}")
                rpt.write(f"     {c['detail']}")

            sys_findings = [f for f in result["findings"] if f["type"] == "SystemPermission"]
            for f in sorted(sys_findings, key=lambda x: x["risk_level"]):
                rpt.write(f"  >> [{f['risk']:8s}]  {f['permission']}")
                rpt.write(f"     {f['detail']}")

            obj_modify = [f for f in result["findings"] if f["type"] == "ObjectPermission" and f["permission"] == "modifyAllRecords"]
            obj_view   = [f for f in result["findings"] if f["type"] == "ObjectPermission" and f["permission"] == "viewAllRecords"]
            if obj_modify:
                rpt.write(f"  >> [HIGH    ]  modifyAllRecords on {len(obj_modify)} object(s): {', '.join(f['object'] for f in obj_modify)}")
            if obj_view:
                rpt.write(f"  >> [MEDIUM  ]  viewAllRecords on {len(obj_view)} object(s): {', '.join(f['object'] for f in obj_view)}")

    rpt.write(f"\n{'='*72}")
    rpt.write(f"  TOP 10 RISKIEST COMPONENTS")
    rpt.write(f"{'='*72}")
    rpt.write(f"  {'Rank':<5} {'Overall':<10} {'Score':<7} {'Type':<14} Name")
    rpt.write(f"  {'─'*4} {'─'*9} {'─'*6} {'─'*13} {'─'*40}")
    for i, r in enumerate(all_results[:10], 1):
        rpt.write(f"  {i:<5} {overall_risk(r['risk_score']):<10} {r['risk_score']:<7} {r['meta_type']:<14} {r['name']}")

    # ── CSV: findings ──────────────────────────────────────────────────────────
    findings_rows = []
    summary_rows  = []

    for result in all_results:
        risk = overall_risk(result["risk_score"])

        summary_rows.append({
            "name":              result["name"],
            "type":              result["meta_type"],
            "overall_risk":      risk,
            "risk_score":        result["risk_score"],
            "system_perm_count": sum(1 for f in result["findings"] if f["type"] == "SystemPermission"),
            "critical_perms":    sum(1 for f in result["findings"] if f["risk_level"] == 1),
            "high_perms":        sum(1 for f in result["findings"] if f["risk_level"] == 2),
            "medium_perms":      sum(1 for f in result["findings"] if f["risk_level"] == 3),
            "obj_modify_all":    sum(1 for f in result["findings"] if f["type"] == "ObjectPermission" and f["permission"] == "modifyAllRecords"),
            "obj_view_all":      sum(1 for f in result["findings"] if f["type"] == "ObjectPermission" and f["permission"] == "viewAllRecords"),
            "dangerous_combos":  len(result["combos"]),
            "view_all_data":     "ViewAllData"   in result["enabled_perms"],
            "modify_all_data":   "ModifyAllData" in result["enabled_perms"],
            "manage_users":      "ManageUsers"   in result["enabled_perms"],
            "author_apex":       "AuthorApex"    in result["enabled_perms"],
        })

        for f in result["findings"]:
            findings_rows.append({
                "name": result["name"], "type": result["meta_type"], "overall_risk": risk,
                "finding_type": f["type"], "permission": f["permission"],
                "risk": f["risk"], "object": f.get("object", ""), "detail": f["detail"],
            })
        for c in result["combos"]:
            findings_rows.append({
                "name": result["name"], "type": result["meta_type"], "overall_risk": risk,
                "finding_type": c["type"], "permission": c["permission"],
                "risk": c["risk"], "object": "", "detail": c["detail"],
            })

    with open(OUTPUT_FINDINGS, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=[
            "name", "type", "overall_risk", "finding_type", "permission", "risk", "object", "detail"
        ])
        writer.writeheader()
        writer.writerows(findings_rows)

    with open(OUTPUT_SUMMARY_CSV, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=[
            "name", "type", "overall_risk", "risk_score",
            "system_perm_count", "critical_perms", "high_perms", "medium_perms",
            "obj_modify_all", "obj_view_all", "dangerous_combos",
            "view_all_data", "modify_all_data", "manage_users", "author_apex",
        ])
        writer.writeheader()
        writer.writerows(summary_rows)

    rpt.write(f"\n{'='*72}")
    rpt.write(f"  Reports written to: {REPORTS_DIR}/")
    rpt.write(f"  {'─'*68}")
    rpt.write(f"  permission-analysis-results.csv     {len(findings_rows):>5} findings")
    rpt.write(f"  permission-analysis-summary.csv     {len(summary_rows):>5} components")
    rpt.write(f"  permission-analysis-summary.txt           (this file)")
    rpt.write(f"{'='*72}\n")

    rpt.close()


if __name__ == "__main__":
    main()
