#!/bin/bash
cd "$(dirname "$0")"

# dotenvを読み込むためプロジェクトルートで実行
exec node dist/index.js wizard

