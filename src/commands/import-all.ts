import ExcelJS from 'exceljs';
import chalk from 'chalk';
import path from 'path';
import { getFulfillmentPolicy, updateFulfillmentPolicy } from '../lib/ebay-api';
import pLimit from 'p-limit';
import { regionMapping, countryToIso } from '../data/definitions';

// 表示名→eBay APIに送る名前に変換
function displayNameToApiName(displayName: string): string {
  // リージョン: 表示名→eBay内部名
  if (regionMapping[displayName]) {
    return regionMapping[displayName];
  }
  // 国名→ISOコード
  if (countryToIso[displayName]) {
    return countryToIso[displayName];
  }
  // domestic/PO Box/ISOコードはそのまま
  return displayName;
}

export async function importAllCommand(opts: { token?: string; marketplaceId?: string; file: string; dryRun?: boolean }) {
  const abs = path.resolve(opts.file);
  const dryRun = opts.dryRun || false;

  console.log(chalk.cyan(`${abs} を読み込み中...`));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(abs);
  const sheet = workbook.getWorksheet('除外国設定') || workbook.getWorksheet(1);
  if (!sheet) throw new Error('シートが見つかりません');

  // ヘッダー行から列名を取得
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNum) => {
    headers[colNum] = String(cell.value || '');
  });

  // policy_id列を特定
  const policyIdCol = headers.indexOf('policy_id');
  if (policyIdCol === -1) throw new Error('policy_id列が見つかりません');

  // 国/地域列（3列目以降）
  const regionColumns: Array<{ colNum: number; displayName: string }> = [];
  for (let c = 3; c < headers.length + 1; c++) {
    if (headers[c] && headers[c] !== 'policy_name' && headers[c] !== 'policy_id') {
      regionColumns.push({ colNum: c, displayName: headers[c] });
    }
  }

  // 各行を処理（並列化）
  let updatedCount = 0;
  let skippedCount = 0;
  const limit = pLimit(5);
  const tasks: Array<() => Promise<void>> = [];

  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum);
    const policyId = String(row.getCell(policyIdCol).value || '').trim();
    const policyName = String(row.getCell(1).value || '').trim();
    if (!policyId) continue;

    const regionExcluded: Array<{ regionName: string }> = [];
    for (const rc of regionColumns) {
      const cellValue = String(row.getCell(rc.colNum).value || '').trim().toLowerCase();
      if (cellValue === 'x' || cellValue === 'exclude') {
        const apiName = displayNameToApiName(rc.displayName);
        regionExcluded.push({ regionName: apiName });
      }
    }

    tasks.push(() =>
      limit(async () => {
        const currentPolicy = await getFulfillmentPolicy(opts.token, policyId);
        const currentExcluded = currentPolicy.shipToLocations?.regionExcluded || [];
        const currentNames = new Set(currentExcluded.map((r: any) => r.regionName));
        const newNames = new Set(regionExcluded.map((r) => r.regionName));

        const hasChanges =
          currentNames.size !== newNames.size || [...currentNames].some((n) => !newNames.has(n));

        if (!hasChanges) {
          skippedCount++;
          return;
        }

        const added = [...newNames].filter((n) => !currentNames.has(n));
        const removed = [...currentNames].filter((n) => !newNames.has(n));

        console.log(chalk.cyan(`\n  [${policyName || policyId}]`));
        if (added.length > 0) console.log(chalk.red(`    + 除外追加: ${added.join(', ')}`));
        if (removed.length > 0) console.log(chalk.green(`    - 除外解除: ${removed.join(', ')}`));

        if (dryRun) {
          console.log(chalk.yellow('    (ドライラン)'));
          updatedCount++;
          return;
        }

        await updateFulfillmentPolicy(opts.token, policyId, {
          ...currentPolicy,
          shipToLocations: { ...currentPolicy.shipToLocations, regionExcluded },
        } as any);
        console.log(chalk.green('    ✔ 更新完了'));
        updatedCount++;
      })
    );
  }

  await Promise.all(tasks.map((t) => t()));

  console.log('');
  if (dryRun) {
    console.log(chalk.yellow(`ドライラン完了: ${updatedCount}件変更予定、${skippedCount}件変更なし`));
  } else {
    console.log(chalk.green(`✔ 完了: ${updatedCount}件更新、${skippedCount}件変更なし`));
  }
}
