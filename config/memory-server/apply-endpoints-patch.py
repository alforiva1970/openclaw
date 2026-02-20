#!/usr/bin/env python3
"""
Apply memory-endpoints-patch.js to ThinkCentre Memory Server v3.0

Usage:
    python3 apply-endpoints-patch.py [path-to-index.js]

This script appends the endpoints from memory-endpoints-patch.js
to the Memory Server's index.js on the ThinkCentre.

Default path: /home/alfonso/memory-server/index.js
"""

import sys
import os
import shutil
from datetime import datetime

PATCH_FILE = os.path.join(os.path.dirname(__file__), 'memory-endpoints-patch.js')
DEFAULT_TARGET = '/home/alfonso/memory-server/index.js'

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TARGET

    if not os.path.exists(target):
        print(f"❌ Target file not found: {target}")
        print("Usage: python3 apply-endpoints-patch.py [path-to-index.js]")
        sys.exit(1)

    if not os.path.exists(PATCH_FILE):
        print(f"❌ Patch file not found: {PATCH_FILE}")
        sys.exit(1)

    # Check if already patched
    with open(target, 'r') as f:
        content = f.read()

    if '/api/memory/store' in content:
        print("⚠️  Endpoints already present in target file. Skipping.")
        sys.exit(0)

    # Backup
    backup = f"{target}.backup.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(target, backup)
    print(f"📋 Backup: {backup}")

    # Read patch
    with open(PATCH_FILE, 'r') as f:
        patch = f.read()

    # Find the last app.listen or server.listen and insert before it
    # Or just append before the listen call
    listen_markers = ['app.listen(', 'server.listen(']
    insert_pos = -1

    for marker in listen_markers:
        pos = content.rfind(marker)
        if pos > insert_pos:
            insert_pos = pos

    if insert_pos > 0:
        # Find the start of the line containing listen
        line_start = content.rfind('\n', 0, insert_pos)
        if line_start == -1:
            line_start = 0
        else:
            line_start += 1

        new_content = content[:line_start] + '\n' + patch + '\n' + content[line_start:]
    else:
        # Just append
        new_content = content + '\n' + patch

    with open(target, 'w') as f:
        f.write(new_content)

    print(f"✅ Patch applied to {target}")
    print("   Added endpoints: /api/memory/store, /api/memory/recent, /api/memory/search, /api/memory/stats")
    print(f"\n🔄 Restart the Memory Server: pm2 restart memory-server")

if __name__ == '__main__':
    main()
