import ExcelJS from 'exceljs';
import chalk from 'chalk';
import path from 'path';
import { getFulfillmentPolicies } from '../lib/ebay-api';
import { classifyRegionName } from '../lib/classify-region';
import { regionMapping, countryToIso } from '../data/definitions';

// ISOコード→表示名の逆引き
const isoToCountry: Record<string, string> = {};
for (const [name, iso] of Object.entries(countryToIso)) {
  isoToCountry[iso] = name;
}
const reverseRegionMapping: Record<string, string> = Object.fromEntries(
  Object.entries(regionMapping).map(([k, v]) => [v, k])
);

export async function exportAllCommand(opts: { token?: string; marketplaceId?: string; output?: string }) {
  const marketplaceId = opts.marketplaceId || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
  const outputFile = opts.output || 'ebay-policies.xlsx';
  const abs = path.resolve(outputFile);

  console.log(chalk.cyan('全ポリシーを取得中...'));
  const policies = await getFulfillmentPolicies(opts.token, marketplaceId);
  console.log(chalk.gray(`${policies.length}件のポリシーを取得しました`));

  // Step 1: 全ポリシーの除外項目を収集し、ユニークな列名を決定
  const allPolicyData: Array<{ name: string; id: string; excludedNames: Set<string> }> = [];
  const allExcludedDisplayNames = new Set<string>();

  for (const p of policies) {
    const excluded = p.shipToLocations?.regionExcluded || [];
    const excludedNames = new Set<string>();

    for (const r of excluded) {
      const rType = classifyRegionName(r.regionName);
      let displayName = r.regionName;

      if (rType === 'COUNTRY_REGION') {
        displayName = reverseRegionMapping[r.regionName] || r.regionName;
      } else if (rType === 'COUNTRY') {
        displayName = isoToCountry[r.regionName] || r.regionName;
      }
      // domestic, PO_BOX はそのまま

      excludedNames.add(displayName);
      allExcludedDisplayNames.add(displayName);
    }

    allPolicyData.push({ name: p.name, id: p.fulfillmentPolicyId, excludedNames });
  }

  // Step 2: 列の順序を決定
  // リージョン → 特殊地域 → 国名（アルファベット順）
  const regionOrder = ['Africa', 'Asia', 'Central America and Caribbean', 'Europe', 'Middle East', 'North America', 'Oceania', 'Southeast Asia', 'South America'];
  const domesticOrder = ['Alaska/Hawaii', 'APO/FPO', 'US Protectorates', 'PO Box'];

  const regions = regionOrder.filter(r => allExcludedDisplayNames.has(r));
  const domestics = domesticOrder.filter(d => allExcludedDisplayNames.has(d));
  const countries = [...allExcludedDisplayNames]
    .filter(n => !regionOrder.includes(n) && !domesticOrder.includes(n))
    .sort();

  const columnNames = [...regions, ...domestics, ...countries];

  // Step 3: Excelを生成
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('除外国設定');

  // ヘッダー
  const headers = ['policy_name', 'policy_id', ...columnNames];
  const headerRow = sheet.addRow(headers);

  // ヘッダースタイル
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } } as any;
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } } as any;

  // 列幅
  sheet.getColumn(1).width = 40; // policy_name
  sheet.getColumn(2).width = 15; // policy_id
  for (let i = 3; i <= headers.length; i++) {
    sheet.getColumn(i).width = 4; // 国/地域列は狭く（xだけなので）
  }

  // リージョン列の背景色（区別しやすく）
  const regionColCount = regions.length;

  // オートフィルター
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } } as any;

  // ヘッダー行を固定、policy_name/policy_id列も固定
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

  // Step 4: データ行
  for (let i = 0; i < allPolicyData.length; i++) {
    const pd = allPolicyData[i];
    const rowData: string[] = [pd.name, pd.id];
    for (const col of columnNames) {
      rowData.push(pd.excludedNames.has(col) ? 'x' : '');
    }
    const row = sheet.addRow(rowData);

    // 交互の背景色
    if (i % 2 === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } } as any;
    }

    // x のセルを中央揃え
    for (let c = 3; c <= headers.length; c++) {
      row.getCell(c).alignment = { horizontal: 'center' } as any;
    }
  }

  // リージョン列ヘッダーに薄い緑背景（リージョンと国を区別）
  for (let c = 3; c < 3 + regionColCount; c++) {
    headerRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } } as any;
  }

  await workbook.xlsx.writeFile(abs);
  console.log(chalk.green(`\n✔ ${abs} に保存しました（${policies.length}ポリシー × ${columnNames.length}列）`));
}
