#!/bin/bash
# 現在のeBay除外設定をCSVにエクスポート
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT="${1:-$PROJECT_DIR/current-exclusions.csv}"

echo "Exporting current exclusions to: $OUTPUT"
cd "$PROJECT_DIR" && npx ebay-exclude export -o "$OUTPUT"
echo "Done: $OUTPUT"
