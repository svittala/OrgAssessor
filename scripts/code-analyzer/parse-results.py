#!/usr/bin/env python3
"""
SMART Code Analyzer — Results Parser
=====================================
Reads the two CSV output files from run-analysis.sh and prints a
structured summary to the terminal and optionally to a text file.

Usage:
    python3 scripts/code-analyzer/parse-results.py \
        --pass1 reports/code-analysis.csv \
        --pass2 reports/code-analysis-with-sfge.csv \
        --out   reports/code-analysis-summary.txt
"""

import argparse
import collections
import csv
import sys
from datetime import datetime
from pathlib import Path


SEV_LABEL = {'1': 'Critical', '2': 'High', '3': 'Moderate', '4': 'Low', '5': 'Info'}


def load_csv(path: str) -> list[dict]:
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


def component_type(file_path: str) -> str:
    if '/classes/' in file_path:    return 'Apex Classes'
    if '/triggers/' in file_path:   return 'Triggers'
    if '/pages/' in file_path:      return 'Visualforce Pages'
    if '/aura/' in file_path:       return 'Aura'
    if '/lwc/' in file_path:        return 'LWC'
    if '/flows/' in file_path:      return 'Flows'
    return 'Other'


def bar(n: int, total: int, width: int = 30) -> str:
    filled = round(n / total * width) if total else 0
    return '█' * filled + '░' * (width - filled)


def section(title: str, lines: list[str]) -> list[str]:
    border = '─' * 60
    return ['', border, f'  {title}', border] + lines


def summarise(pass1_rows: list[dict], pass2_rows: list[dict]) -> list[str]:
    out: list[str] = []

    # ── Identify SFGE-only violations from Pass 2 ────────────────────────
    sfge_rows = [r for r in pass2_rows if r['engine'] == 'sfge']

    # Combined = Pass 1 (all) + SFGE delta
    combined_high     = sum(1 for r in pass1_rows if r['severity'] == '2') + \
                        sum(1 for r in sfge_rows  if r['severity'] == '2')
    combined_moderate = sum(1 for r in pass1_rows if r['severity'] == '3') + \
                        sum(1 for r in sfge_rows  if r['severity'] == '3')
    combined_total    = len(pass1_rows) + len(sfge_rows)

    # ── Header ────────────────────────────────────────────────────────────
    out += [
        '════════════════════════════════════════════════════════════',
        '  SMART — Salesforce Code Analyzer Summary',
        f'  Generated: {datetime.now().strftime("%Y-%m-%d %H:%M")}',
        '════════════════════════════════════════════════════════════',
        '',
        '  Two passes were run:',
        '  Pass 1 — Recommended rules, all component types',
        '  Pass 2 — Recommended + SFGE (data-flow), Apex/Triggers only',
    ]

    # ── Combined top-line ──────────────────────────────────────────────
    files1 = len({r['file'] for r in pass1_rows})
    files2 = len({r['file'] for r in sfge_rows})
    out += section('COMBINED TOTALS', [
        f'  Total violations : {combined_total:,}',
        f'  Files affected   : {files1 + files2:,}',
        f'  High severity    : {combined_high:,}',
        f'  Moderate severity: {combined_moderate:,}',
        f'  SFGE-only (new)  : {len(sfge_rows)}  ← not in Pass 1',
    ])

    # ── Pass 1 breakdown by severity ──────────────────────────────────
    by_sev = collections.Counter(SEV_LABEL.get(r['severity'], r['severity']) for r in pass1_rows)
    total1 = len(pass1_rows)
    sev_order = ['Critical', 'High', 'Moderate', 'Low', 'Info']
    sev_lines = [f'  {"Severity":<12} {"Count":>6}   {"Bar":<30}  {"Pct":>5}']
    sev_lines.append(f'  {"─"*12} {"─"*6}   {"─"*30}  {"─"*5}')
    for s in sev_order:
        n = by_sev.get(s, 0)
        if n:
            sev_lines.append(f'  {s:<12} {n:>6}   {bar(n, total1):<30}  {n/total1*100:>4.1f}%')
    out += section('PASS 1 — By Severity', sev_lines)

    # ── Pass 1 breakdown by engine ────────────────────────────────────
    by_eng = collections.Counter(r['engine'] for r in pass1_rows)
    eng_lines = [f'  {"Engine":<12} {"Total":>6}  {"High":>6}  {"Moderate":>8}  {"Scope"}']
    eng_lines.append(f'  {"─"*12} {"─"*6}  {"─"*6}  {"─"*8}  {"─"*20}')
    scope_map = {
        'pmd':      'Apex, VF Pages',
        'regex':    'All file types',
        'flow':     'Flows',
        'eslint':   'LWC, Aura JS',
        'cpd':      'Apex (copy-paste)',
        'retire-js':'JS (security)',
    }
    for eng, n in by_eng.most_common():
        high = sum(1 for r in pass1_rows if r['engine'] == eng and r['severity'] == '2')
        mod  = sum(1 for r in pass1_rows if r['engine'] == eng and r['severity'] == '3')
        scope = scope_map.get(eng, '')
        eng_lines.append(f'  {eng:<12} {n:>6}  {high:>6}  {mod:>8}  {scope}')
    out += section('PASS 1 — By Engine', eng_lines)

    # ── Pass 1 breakdown by component type ────────────────────────────
    by_comp = collections.Counter(component_type(r['file']) for r in pass1_rows)
    comp_lines = [f'  {"Component":<22} {"Count":>6}   {"Bar":<30}']
    comp_lines.append(f'  {"─"*22} {"─"*6}   {"─"*30}')
    for comp, n in by_comp.most_common():
        comp_lines.append(f'  {comp:<22} {n:>6}   {bar(n, total1):<30}')
    out += section('PASS 1 — By Component Type', comp_lines)

    # ── Pass 1 top rules ──────────────────────────────────────────────
    by_rule = collections.Counter(r['rule'] for r in pass1_rows)
    rule_lines = [f'  {"#":>3}  {"Rule":<50} {"Sev":>3}  {"Count":>6}']
    rule_lines.append(f'  {"─"*3}  {"─"*50} {"─"*3}  {"─"*6}')
    for i, (rule, n) in enumerate(by_rule.most_common(15), 1):
        sample_rows = [r for r in pass1_rows if r['rule'] == rule]
        sev = SEV_LABEL.get(sample_rows[0]['severity'], '?')[0] if sample_rows else '?'
        rule_lines.append(f'  {i:>3}  {rule:<50} {sev:>3}  {n:>6}')
    out += section('PASS 1 — Top 15 Rules by Count', rule_lines)

    # ── SFGE findings ─────────────────────────────────────────────────
    if sfge_rows:
        sfge_by_rule = collections.Counter(r['rule'] for r in sfge_rows)
        sfge_lines = [
            f'  Total SFGE violations: {len(sfge_rows)} '
            f'({sum(1 for r in sfge_rows if r["severity"]=="2")} High, '
            f'{sum(1 for r in sfge_rows if r["severity"]=="3")} Moderate)',
            '',
            f'  {"Rule":<50} {"Sev":>3}  {"Count":>6}',
            f'  {"─"*50} {"─"*3}  {"─"*6}',
        ]
        for rule, n in sfge_by_rule.most_common():
            sample = next(r for r in sfge_rows if r['rule'] == rule)
            sev = SEV_LABEL.get(sample['severity'], '?')
            sfge_lines.append(f'  {rule:<50} {sev[0]:>3}  {n:>6}')
        sfge_lines += ['', '  Top files with SFGE violations:']
        by_file = collections.Counter(r['file'].split('/')[-1] for r in sfge_rows)
        for fname, n in by_file.most_common(10):
            sfge_lines.append(f'    {fname:<45} {n:>3}')
        out += section('PASS 2 — SFGE (Salesforce Graph Engine) — NEW violations', sfge_lines)
    else:
        out += section('PASS 2 — SFGE', ['  No SFGE violations found, or SFGE CSV not provided.'])

    # ── Top files overall ──────────────────────────────────────────────
    all_rows = pass1_rows + sfge_rows
    by_file = collections.Counter(r['file'].split('/')[-1] for r in all_rows)
    file_lines = [f'  {"File":<50} {"Violations":>10}']
    file_lines.append(f'  {"─"*50} {"─"*10}')
    for fname, n in by_file.most_common(10):
        file_lines.append(f'  {fname:<50} {n:>10}')
    out += section('TOP 10 FILES BY VIOLATION COUNT (combined)', file_lines)

    # ── Quick-fix guide ───────────────────────────────────────────────
    out += section('RECOMMENDED REMEDIATION ORDER', [
        '',
        '  Priority 1 — Security (SFGE findings, fix immediately)',
        '    ApexFlsViolation          → add stripInaccessible() or WITH SECURITY_ENFORCED',
        '    DatabaseOperationsMustUseWithSharing → change class to "with sharing"',
        '    AvoidDatabaseOperationInLoop → move SOQL outside loops, use bulk queries',
        '',
        '  Priority 2 — Security (PMD/Flow)',
        '    PreventPassingUserDataIntoElementWithoutSharing → add sharing to Flows',
        '    ApexCRUDViolation         → add isAccessible()/isUpdateable() CRUD checks',
        '    AvoidHardcodingId         → use Custom Metadata or Custom Settings',
        '    AvoidOldSalesforceApiVersions → update metadata to API 63.0+',
        '',
        '  Priority 3 — Reliability',
        '    MissingNullCheckOnSoqlVariable → null-check after single-row SOQL',
        '    SameRecordUpdate (flows)  → consolidate updates in Flow elements',
        '    AvoidDebugStatements      → remove or guard System.debug() calls',
        '',
        '  Priority 4 — Quality & Formatting (autofix)',
        '    NoTrailingWhitespace      → run: npm run prettier',
        '    NoMixedIndentation        → run: npm run prettier',
        '    ApexUnitTestClassShouldHaveRunAs → wrap tests in System.runAs()',
        '    ApexDoc                   → add ApexDoc comments',
    ])

    out += ['', '═' * 60, '  End of report', '═' * 60, '']
    return out


def main():
    parser = argparse.ArgumentParser(description='Summarise Code Analyzer CSV outputs')
    parser.add_argument('--pass1', required=True, help='Path to Pass 1 CSV (Recommended, all components)')
    parser.add_argument('--pass2', required=True, help='Path to Pass 2 CSV (Recommended + SFGE, Apex only)')
    parser.add_argument('--out',   required=False, help='Optional output text file path')
    args = parser.parse_args()

    if not Path(args.pass1).exists():
        print(f'ERROR: Pass 1 CSV not found: {args.pass1}', file=sys.stderr)
        sys.exit(1)

    pass2_rows: list[dict] = []
    if Path(args.pass2).exists():
        pass2_rows = load_csv(args.pass2)
    else:
        print(f'WARNING: Pass 2 CSV not found: {args.pass2} — SFGE section will be empty.', file=sys.stderr)

    pass1_rows = load_csv(args.pass1)
    lines = summarise(pass1_rows, pass2_rows)
    output = '\n'.join(lines)

    print(output)

    if args.out:
        Path(args.out).write_text(output, encoding='utf-8')
        print(f'\nSummary written to: {args.out}')


if __name__ == '__main__':
    main()
