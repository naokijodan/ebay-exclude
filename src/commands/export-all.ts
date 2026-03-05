import ExcelJS from 'exceljs';
import chalk from 'chalk';
import path from 'path';
import { getFulfillmentPolicies } from '../lib/ebay-api';
import { classifyRegionName } from '../lib/classify-region';
import { regionMapping, countryToIso } from '../data/definitions';

interface ExportAllOptions {
  token?: string;
  marketplaceId?: string;
  output?: string;
}

// ISOコード→国名の逆引き
const isoToCountry: Record<string, string> = {};
for (const [name, iso] of Object.entries(countryToIso)) {
  isoToCountry[iso] = name;
}

// regionMapping逆引き
const reverseRegionMapping: Record<string, string> = Object.fromEntries(
  Object.entries(regionMapping).map(([k, v]) => [v, k])
);

export async function exportAllCommand(opts: ExportAllOptions) {
  const marketplaceId = opts.marketplaceId || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
  const outputFile = opts.output || 'ebay-policies.xlsx';
  const abs = path.resolve(outputFile);

  try {
    console.log(chalk.cyan('全ポリシーを取得中...'));
    const policies = await getFulfillmentPolicies(opts.token, marketplaceId);
    console.log(chalk.gray(`${policies.length}件のポリシーを取得しました`));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('除外国設定');

    // ヘッダー行
    sheet.columns = [
      { header: 'policy_name', key: 'policy_name', width: 40 },
      { header: 'policy_id', key: 'policy_id', width: 15 },
      { header: 'type', key: 'type', width: 12 },
      { header: 'value', key: 'value', width: 30 },
      { header: 'action', key: 'action', width: 10 },
      { header: 'note', key: 'note', width: 20 },
    ];

    // ヘッダー行のスタイル
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    } as any;
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // オートフィルター設定
    (sheet as any).autoFilter = 'A1:F1';

    // 各ポリシーのデータを取得してシートに追加
    let totalRows = 0;
    for (let i = 0; i < policies.length; i++) {
      const p = policies[i];
      console.log(chalk.gray(`  [${i + 1}/${policies.length}] ${p.name}`));

      const excluded = p.shipToLocations?.regionExcluded || [];

      if (excluded.length === 0) {
        // 除外設定なしのポリシーも1行追加（空の状態を示す）
        sheet.addRow({
          policy_name: p.name,
          policy_id: p.fulfillmentPolicyId,
          type: '',
          value: '(除外なし)',
          action: '',
          note: '',
        });
        totalRows++;
        continue;
      }

      for (const r of excluded) {
        const rType = classifyRegionName(r.regionName);
        let type = '';
        let value = r.regionName;

        if (rType === 'COUNTRY_REGION') {
          type = 'region';
          value = reverseRegionMapping[r.regionName] || r.regionName;
        } else if (rType === 'COUNTRY') {
          type = 'country';
          value = isoToCountry[r.regionName] || r.regionName;
        } else if (rType === 'STATE_OR_PROVINCE') {
          type = 'domestic';
        } else if (rType === 'PO_BOX') {
          type = 'other';
          value = 'PO Box';
        }

        sheet.addRow({
          policy_name: p.name,
          policy_id: p.fulfillmentPolicyId,
          type,
          value,
          action: 'exclude',
          note: '',
        });
        totalRows++;
      }
    }

    // ポリシーごとに交互の背景色（見やすさのため）
    let currentPolicy = '';
    let colorIndex = 0;
    const colors = ['FFFFFFFF', 'FFF2F2F2']; // 白と薄灰色
    for (let rowNum = 2; rowNum <= totalRows + 1; rowNum++) {
      const row = sheet.getRow(rowNum);
      const policyName = row.getCell(1).value as string;
      if (policyName !== currentPolicy) {
        currentPolicy = policyName;
        colorIndex = (colorIndex + 1) % 2;
      }
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: colors[colorIndex] },
      } as any;
    }

    // 先頭行を固定
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    await workbook.xlsx.writeFile(abs);
    console.log(chalk.green(`\n✔ ${abs} に保存しました（${policies.length}ポリシー、${totalRows}行）`));
  } catch (e: any) {
    console.error(chalk.red(`エクスポート失敗: ${e?.message || e}`));
    throw e;
  }
}
