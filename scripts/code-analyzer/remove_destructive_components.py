#!/usr/bin/env python3
"""
Remove local source files for every component listed in destructiveChanges.xml.

Supports:
  ApexPage              → force-app/main/default/pages/<name>.page
                          force-app/main/default/pages/<name>.page-meta.xml
  ApexClass             → force-app/main/default/classes/<name>.cls
                          force-app/main/default/classes/<name>.cls-meta.xml
  LightningComponentBundle → force-app/main/default/lwc/<name>/ (entire dir)

Usage:
  python3 scripts/code-analyzer/remove_destructive_components.py [--dry-run]

Options:
  --dry-run   Print what would be deleted without actually deleting anything.
"""

import os
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()

DESTRUCTIVE_XML = SCRIPT_DIR  / "destructiveChanges.xml"
SOURCE_ROOT = SCRIPT_DIR / "force-app" / "main" / "default"

NAMESPACE = "http://soap.sforce.com/2006/04/metadata"

TYPE_MAP = {
    "ApexPage": {
        "dir": SOURCE_ROOT / "pages",
        "extensions": [".page", ".page-meta.xml"],
    },
    "ApexClass": {
        "dir": SOURCE_ROOT / "classes",
        "extensions": [".cls", ".cls-meta.xml"],
    },
    "LightningComponentBundle": {
        "dir": SOURCE_ROOT / "lwc",
        "extensions": None,  # entire directory
    },
}

def parse_destructive_xml(xml_path: Path) -> dict[str, list[str]]:
    """Parse destructiveChanges.xml and return {typeName: [member, ...]}."""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    result: dict[str, list[str]] = {}
    for types_el in root.findall(f"{{{NAMESPACE}}}types"):
        name_el = types_el.find(f"{{{NAMESPACE}}}name")
        if name_el is None:
            continue
        type_name = name_el.text.strip()
        members = [
            m.text.strip()
            for m in types_el.findall(f"{{{NAMESPACE}}}members")
            if m.text
        ]
        result[type_name] = members
    return result


def remove_files(members: list[str], config: dict, dry_run: bool) -> tuple[int, int]:
    """Delete files/dirs for a given metadata type. Returns (removed, missing)."""
    removed = 0
    missing = 0
    base_dir: Path = config["dir"]
    extensions = config["extensions"]

    for member in members:
        if extensions is None:
            # LWC — delete the entire component directory
            target = base_dir / member
            if target.is_dir():
                print(f"  [DIR]  {target.relative_to(SCRIPT_DIR)}")
                if not dry_run:
                    shutil.rmtree(target)
                removed += 1
            else:
                print(f"  [SKIP] {target.relative_to(SCRIPT_DIR)}  (not found)")
                missing += 1
        else:
            for ext in extensions:
                target = base_dir / f"{member}{ext}"
                if target.exists():
                    print(f"  [FILE] {target.relative_to(SCRIPT_DIR)}")
                    if not dry_run:
                        target.unlink()
                    removed += 1
                else:
                    print(f"  [SKIP] {target.relative_to(SCRIPT_DIR)}  (not found)")
                    missing += 1

    return removed, missing


def main():
    dry_run = "--dry-run" in sys.argv

    if dry_run:
        print("=== DRY RUN — no files will be deleted ===\n")

    if not DESTRUCTIVE_XML.exists():
        print(f"ERROR: destructiveChanges.xml not found at:\n  {DESTRUCTIVE_XML}")
        sys.exit(1)

    components = parse_destructive_xml(DESTRUCTIVE_XML)

    total_removed = 0
    total_missing = 0

    for type_name, members in components.items():
        config = TYPE_MAP.get(type_name)
        if config is None:
            print(f"\n[WARN] No handler for metadata type '{type_name}' — skipping {len(members)} member(s).")
            continue

        print(f"\n{'='*60}")
        print(f"  {type_name}  ({len(members)} members)")
        print(f"{'='*60}")

        removed, missing = remove_files(members, config, dry_run)
        total_removed += removed
        total_missing += missing

    print(f"\n{'='*60}")
    if dry_run:
        print(f"  DRY RUN complete.")
        print(f"  Would delete : {total_removed} file(s)/dir(s)")
        print(f"  Not found    : {total_missing} file(s)/dir(s)")
    else:
        print(f"  Done.")
        print(f"  Deleted      : {total_removed} file(s)/dir(s)")
        print(f"  Not found    : {total_missing} file(s)/dir(s)")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
