#!/bin/bash
# ドライラン - 変更内容の確認のみ（実際の更新なし）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CSV="${1:-$PROJECT_DIR/exclusions.csv}"

echo "Dry-run: checking changes from: $CSV"
cd "$PROJECT_DIR" && npx ebay-exclude apply "$CSV" --dry-run
