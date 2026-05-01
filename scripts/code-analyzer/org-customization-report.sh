#!/bin/bash

# Org Customization Assessment Report Generator - PYTHON VERSION
# this script is in scripts/code-analyzer/ folder so we need to go up two levels to get to the root folder

cd ../../

echo "Gathering metadata information from ASETT org..."

python3 << 'PYTHON_EOF'
import subprocess
import json
from datetime import datetime

def get_metadata_info(metadata_type, filter_func=None):
    """Retrieve metadata count and list for a given type"""
    try:
        result = subprocess.run(
            ["sf", "org", "list", "metadata", "--metadata-type", metadata_type, "--json"],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            items = data.get("result", [])
            if filter_func:
                items = [item for item in items if filter_func(item.get("fullName", ""))]
            count = len(items)
            item_names = sorted([item.get("fullName", "") for item in items if item.get("fullName")])
            return count, item_names
        else:
            return 0, []
    except Exception as e:
        print(f"Error retrieving {metadata_type}: {e}")
        return 0, []

def format_items_html(items):
    """Format items list as HTML"""
    if not items:
        return "<li>No items found</li>"
    return "\n".join([f"<li>{item}</li>" for item in items])

# Retrieve all metadata
metadata_types = {
    "CustomObject": ("Custom Objects", lambda name: name.endswith("__c")),
    "ApexClass": ("Apex Classes", None),
    "Flow": ("Flows", None),
    "LightningComponentBundle": ("Lightning Web Components", None),
    "AuraDefinitionBundle": ("Aura Components", None),
    "ApexPage": ("Visualforce Pages", None),
    "ApexComponent": ("Visualforce Components", None),
    "ApexTrigger": ("Apex Triggers", None),
    "Layout": ("Custom Layouts", None),
    "PermissionSet": ("Permission Sets", None),
    "CustomTab": ("Custom Tabs", None),
    "CustomMetadata": ("Custom Metadata", None),
    "StaticResource": ("Static Resources", None)
}

metadata_info = {}
total_components = 0

for api_name, (display_name, filter_func) in metadata_types.items():
    count, items = get_metadata_info(api_name, filter_func)
    metadata_info[api_name] = {
        "count": count,
        "items": items,
        "display_name": display_name
    }
    total_components += count
    print(f"  ✓ {display_name}: {count} items")

# Determine customization level
if total_components < 10:
    customization_level = "Low"
    color = "#90EE90"
elif total_components < 50:
    customization_level = "Medium"
    color = "#FFD700"
else:
    customization_level = "High"
    color = "#FF6B6B"

# Generate HTML
timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
org_name = "asettdev"

html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASETT Org Customization Report</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; min-height: 100vh; }}
        .container {{ max-width: 1000px; margin: 0 auto; background: white; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); overflow: hidden; }}
        header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 30px; text-align: center; }}
        header h1 {{ font-size: 2.5em; margin-bottom: 10px; }}
        header p {{ font-size: 0.95em; opacity: 0.9; }}
        .content {{ padding: 30px; }}
        .info-grid {{ background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 30px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }}
        .info-item {{ padding: 10px; }}
        .info-item strong {{ color: #667eea; }}
        .summary-box {{ border-left: 5px solid #667eea; padding: 20px; border-radius: 5px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; background: {color}; }}
        .summary-box h2 {{ font-size: 1.5em; color: #333; }}
        .summary-box .level-badge {{ background: white; padding: 10px 20px; border-radius: 20px; font-weight: bold; color: #667eea; font-size: 1.1em; }}
        .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }}
        .metric-card {{ background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; text-align: center; }}
        .metric-card h3 {{ color: #667eea; margin-bottom: 10px; font-size: 0.9em; text-transform: uppercase; font-weight: 600; }}
        .metric-card .number {{ font-size: 2.5em; color: #333; font-weight: bold; margin: 15px 0; }}
        .metric-card .category {{ color: #999; font-size: 0.85em; }}
        .section-title {{ font-size: 1.3em; color: #333; margin: 30px 0 20px 0; border-bottom: 2px solid #667eea; padding-bottom: 10px; }}
        .items-list {{ background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 5px; padding: 15px; margin-top: 10px; max-height: 400px; overflow-y: auto; }}
        .items-list ul {{ list-style: none; }}
        .items-list li {{ padding: 8px 0; border-bottom: 1px solid #e0e0e0; font-size: 0.9em; color: #555; }}
        .items-list li:last-child {{ border-bottom: none; }}
        .items-list li::before {{ content: "▸ "; color: #667eea; font-weight: bold; margin-right: 8px; }}
        .metadata-section {{ margin-bottom: 30px; padding-bottom: 30px; border-bottom: 1px solid #e0e0e0; }}
        .metadata-section:last-child {{ border-bottom: none; }}
        .section-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }}
        .section-header h3 {{ margin: 0; color: #667eea; font-size: 1.1em; }}
        .count-badge {{ background: #667eea; color: white; padding: 5px 10px; border-radius: 15px; font-size: 0.9em; font-weight: bold; }}
        footer {{ background: #f8f9fa; padding: 20px; text-align: center; color: #999; border-top: 1px solid #e0e0e0; font-size: 0.9em; }}
        .recommendation {{ background: #e3f2fd; border-left: 4px solid #2196F3; padding: 15px; border-radius: 4px; margin-top: 20px; color: #1565c0; }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🔍 ASETT Org Customization Report</h1>
            <p>Comprehensive Metadata Assessment</p>
        </header>
        <div class="content">
            <div class="info-grid">
                <div class="info-item"><strong>Report Generated:</strong> {timestamp}</div>
                <div class="info-item"><strong>Target Org:</strong> {org_name}</div>
                <div class="info-item"><strong>Total Custom Components:</strong> {total_components}</div>
                <div class="info-item"><strong>Customization Level:</strong> <span style="color: #667eea; font-weight: bold;">{customization_level}</span></div>
            </div>
            <div class="summary-box">
                <div>
                    <h2>Overall Customization Score</h2>
                    <p>Total custom metadata components detected in your org</p>
                </div>
                <div class="level-badge">{total_components} Components</div>
            </div>
            <h2 class="section-title">Core Customization Metrics</h2>
            <div class="metrics">
                <div class="metric-card"><h3>Custom Objects</h3><div class="number">{metadata_info["CustomObject"]["count"]}</div><div class="category">Data Model</div></div>
                <div class="metric-card"><h3>Apex Classes</h3><div class="number">{metadata_info["ApexClass"]["count"]}</div><div class="category">Business Logic</div></div>
                <div class="metric-card"><h3>Flows</h3><div class="number">{metadata_info["Flow"]["count"]}</div><div class="category">Automation</div></div>
                <div class="metric-card"><h3>Apex Triggers</h3><div class="number">{metadata_info["ApexTrigger"]["count"]}</div><div class="category">Event Handling</div></div>
            </div>
            <h2 class="section-title">User Interface Components</h2>
            <div class="metrics">
                <div class="metric-card"><h3>Lightning Web Components</h3><div class="number">{metadata_info["LightningComponentBundle"]["count"]}</div><div class="category">Modern UI</div></div>
                <div class="metric-card"><h3>Aura Components</h3><div class="number">{metadata_info["AuraDefinitionBundle"]["count"]}</div><div class="category">Component Framework</div></div>
                <div class="metric-card"><h3>Visualforce Pages</h3><div class="number">{metadata_info["ApexPage"]["count"]}</div><div class="category">Legacy UI</div></div>
                <div class="metric-card"><h3>Visualforce Components</h3><div class="number">{metadata_info["ApexComponent"]["count"]}</div><div class="category">Reusable UI</div></div>
            </div>
            <h2 class="section-title">Configuration & Setup</h2>
            <div class="metrics">
                <div class="metric-card"><h3>Custom Layouts</h3><div class="number">{metadata_info["Layout"]["count"]}</div><div class="category">UI Configuration</div></div>
                <div class="metric-card"><h3>Permission Sets</h3><div class="number">{metadata_info["PermissionSet"]["count"]}</div><div class="category">Access Control</div></div>
                <div class="metric-card"><h3>Custom Tabs</h3><div class="number">{metadata_info["CustomTab"]["count"]}</div><div class="category">Navigation</div></div>
                <div class="metric-card"><h3>Custom Metadata</h3><div class="number">{metadata_info["CustomMetadata"]["count"]}</div><div class="category">Configuration Data</div></div>
            </div>
            <h2 class="section-title">Resources</h2>
            <div class="metrics">
                <div class="metric-card"><h3>Static Resources</h3><div class="number">{metadata_info["StaticResource"]["count"]}</div><div class="category">Assets</div></div>
            </div>
            <h2 class="section-title">Detailed Metadata Listings</h2>
            <div class="metadata-section">
                <div class="section-header"><h3>📦 Custom Objects</h3><span class="count-badge">{metadata_info["CustomObject"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["CustomObject"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>⚙️ Apex Classes</h3><span class="count-badge">{metadata_info["ApexClass"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["ApexClass"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>🔄 Flows</h3><span class="count-badge">{metadata_info["Flow"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["Flow"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>⚡ Lightning Web Components</h3><span class="count-badge">{metadata_info["LightningComponentBundle"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["LightningComponentBundle"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>🎨 Aura Components</h3><span class="count-badge">{metadata_info["AuraDefinitionBundle"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["AuraDefinitionBundle"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>📄 Visualforce Pages</h3><span class="count-badge">{metadata_info["ApexPage"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["ApexPage"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>🔧 Visualforce Components</h3><span class="count-badge">{metadata_info["ApexComponent"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["ApexComponent"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>🎯 Apex Triggers</h3><span class="count-badge">{metadata_info["ApexTrigger"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["ApexTrigger"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>📋 Custom Layouts</h3><span class="count-badge">{metadata_info["Layout"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["Layout"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>🔐 Permission Sets</h3><span class="count-badge">{metadata_info["PermissionSet"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["PermissionSet"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>📑 Custom Tabs</h3><span class="count-badge">{metadata_info["CustomTab"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["CustomTab"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>⚙️ Custom Metadata</h3><span class="count-badge">{metadata_info["CustomMetadata"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["CustomMetadata"]["items"])}</ul></div>
            </div>
            <div class="metadata-section">
                <div class="section-header"><h3>📦 Static Resources</h3><span class="count-badge">{metadata_info["StaticResource"]["count"]}</span></div>
                <div class="items-list"><ul>{format_items_html(metadata_info["StaticResource"]["items"])}</ul></div>
            </div>
            <div class="recommendation">
                <strong>💡 Customization Level Assessment:</strong><br>
                <span style="font-size: 1.1em; font-weight: bold;">{customization_level}</span><br>
                Your org has <strong>{total_components}</strong> custom components indicating a <strong style="text-transform: lowercase;">{customization_level}</strong> level of customization.
            </div>
        </div>
        <footer>
            <p>Generated on {timestamp} | ASETT Org Customization Assessment Tool</p>
        </footer>
    </div>
</body>
</html>"""

# Write HTML file
with open("org-customization-report.html", "w") as f:
    f.write(html_content)

print("\n✅ Report generated successfully: org-customization-report.html")

PYTHON_EOF

echo "📊 Opening report in browser..."
open "org-customization-report.html" 2>/dev/null || xdg-open "org-customization-report.html" 2>/dev/null || echo "Open org-customization-report.html manually in your browser"
