# ebay-exclude

eBayの発送除外国（Ship-to Exclusions）を管理するCLIツール + MCPサーバー。

## MCP連携（Claude Codeから使う場合）

このプロジェクトはMCPサーバーとして登録済み。
ユーザーが「ポリシー」「除外国」「eBay」等に言及した場合、以下のMCPツールを使うこと。

### 利用可能なツール

| ツール | 説明 | 使い方の例 |
|--------|------|------------|
| `mcp__ebay-exclude__list_policies` | ポリシー一覧取得 | 「ポリシー一覧を見せて」 |
| `mcp__ebay-exclude__get_policy_exclusions` | 特定ポリシーの除外設定を取得 | 「中古エコノミーの除外国は？」 |
| `mcp__ebay-exclude__update_exclusions` | 除外設定を更新 | 「このポリシーからアフリカを除外して」 |
| `mcp__ebay-exclude__export_all_excel` | 全ポリシーをExcel出力 | 「全ポリシーをExcelに出力して」 |
| `mcp__ebay-exclude__import_excel` | Excelからインポート | 「このExcelの変更を反映して」 |

### update_exclusions の引数
- `policyId`: 対象ポリシーID（必須）
- `addExclusions`: 追加する除外項目の表示名配列（例: `["Africa", "Japan", "PO Box"]`）
- `removeExclusions`: 解除する除外項目の表示名配列
- `setExclusions`: 除外リストを丸ごと置き換え

### 注意
- import_excelはデフォルトでdry-run（安全のため）。実際に反映するには `dryRun: false` を明示
- 表示名は英語（例: Japan, Africa, PO Box）
- ポリシー名でユーザーが指示した場合は、まず list_policies で該当ポリシーのIDを特定してから操作する

## CLI（手動操作）

```bash
# ポリシー一覧
node dist/index.js list

# 全ポリシーをExcelエクスポート（ピボット形式）
node dist/index.js export-all -o ebay-policies.xlsx

# Excelからインポート（ドライラン）
node dist/index.js import-all --dry-run ebay-policies.xlsx

# Excelからインポート（本番適用）
node dist/index.js import-all ebay-policies.xlsx

# ウィザード（対話式）
node dist/index.js wizard
```

## 環境変数（.env）
- `EBAY_ENV`: production / sandbox
- `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN`: eBay認証情報
- `EBAY_MARKETPLACE_ID`: デフォルト EBAY_US
