#!/bin/bash
# 全ポリシーにCSVの除外設定を適用
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CSV="${1:-$PROJECT_DIR/exclusions.csv}"

echo "Applying exclusions from: $CSV"
cd "$PROJECT_DIR" && npx ebay-exclude apply "$CSV"
