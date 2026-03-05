import ExcelJS from 'exceljs';
import chalk from 'chalk';
import path from 'path';
import { getFulfillmentPolicy, updateFulfillmentPolicy } from '../lib/ebay-api';
import { regionMapping, countryToIso } from '../data/definitions';
import { classifyRegionName } from '../lib/classify-region';

interface ImportAllOptions {
  token?: string;
  marketplaceId?: string;
  file: string;
  dryRun?: boolean;
}

// 国名→ISOコード
// regionDisplay→eBay内部名
const regionDisplayToInternal: Record<string, string> = regionMapping;

export async function importAllCommand(opts: ImportAllOptions) {
  const abs = path.resolve(opts.file);
  const dryRun = opts.dryRun || false;

  try {
    console.log(chalk.cyan(`${abs} を読み込み中...`));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(abs);
    const sheet = workbook.getWorksheet('除外国設定') || workbook.getWorksheet(1);

    if (!sheet) {
      throw new Error('シートが見つかりません');
    }

    // ヘッダー行からカラムインデックスを取得
    const headerRow = sheet.getRow(1);
    const headers: Record<string, number> = {};
    headerRow.eachCell((cell, colNum) => {
      headers[String(cell.value).toLowerCase()] = colNum;
    });

    const requiredCols = ['policy_id', 'type', 'value', 'action'];
    for (const col of requiredCols) {
      if (!headers[col]) {
        throw new Error(`必須列 '${col}' が見つかりません`);
      }
    }

    // 行を読み取り、policy_idごとにグループ化
    const policiesMap = new Map<string, Array<{ type: string; value: string; action: string }>>();

    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // ヘッダーをスキップ

      const policyId = String(row.getCell(headers['policy_id']).value || '').trim();
      const type = String(row.getCell(headers['type']).value || '').trim().toLowerCase();
      const value = String(row.getCell(headers['value']).value || '').trim();
      const action = String(row.getCell(headers['action']).value || '').trim().toLowerCase();

      if (!policyId || !type || !value || !action) return; // 空行やヘッダーのみ行をスキップ
      if (value === '(除外なし)') return; // プレースホルダーをスキップ

      if (!policiesMap.has(policyId)) {
        policiesMap.set(policyId, []);
      }
      policiesMap.get(policyId)!.push({ type, value, action });
    });

    console.log(chalk.gray(`${policiesMap.size}件のポリシーを検出しました`));

    // 各ポリシーに対して更新を適用
    let updatedCount = 0;
    let skippedCount = 0;

    for (const [policyId, rules] of policiesMap) {
      // excludeアクションのルールからregionExcludedを構築
      const regionExcluded: Array<{ regionName: string; regionType: string }> = [];

      for (const rule of rules) {
        if (rule.action !== 'exclude') continue; // includeはスキップ（除外リストに含めない）

        if (rule.type === 'region') {
          // リージョン名をeBay内部名に変換
          const internalName = regionDisplayToInternal[rule.value] || rule.value;
          regionExcluded.push({ regionName: internalName, regionType: 'COUNTRY_REGION' });
        } else if (rule.type === 'country') {
          // 国名をISOコードに変換
          const iso = countryToIso[rule.value] || rule.value;
          regionExcluded.push({ regionName: iso, regionType: 'COUNTRY' });
        } else if (rule.type === 'domestic') {
          regionExcluded.push({ regionName: rule.value, regionType: 'STATE_OR_PROVINCE' });
        } else if (rule.type === 'other' && rule.value === 'PO Box') {
          regionExcluded.push({ regionName: 'PO Box', regionType: 'PO_BOX' });
        }
      }

      // 現在のポリシーを取得して比較
      const currentPolicy = await getFulfillmentPolicy(opts.token, policyId);
      const currentExcluded = currentPolicy.shipToLocations?.regionExcluded || [];
      const currentNames = new Set(currentExcluded.map((r: any) => r.regionName));
      const newNames = new Set(regionExcluded.map((r) => r.regionName));

      // 変更があるかチェック
      const hasChanges =
        currentNames.size !== newNames.size || [...currentNames].some((n) => !newNames.has(n));

      if (!hasChanges) {
        console.log(chalk.gray(`  [スキップ] ${currentPolicy.name} - 変更なし`));
        skippedCount++;
        continue;
      }

      // 変更内容を表示
      const added = [...newNames].filter((n) => !currentNames.has(n));
      const removed = [...currentNames].filter((n) => !newNames.has(n));

      console.log(chalk.cyan(`\n  [${currentPolicy.name}]`));
      if (added.length > 0) {
        console.log(chalk.red(`    + 除外追加: ${added.join(', ')}`));
      }
      if (removed.length > 0) {
        console.log(chalk.green(`    - 除外解除: ${removed.join(', ')}`));
      }

      if (dryRun) {
        console.log(chalk.yellow('    (ドライラン - 実際には変更しません)'));
        updatedCount++;
        continue;
      }

      // 更新を実行
      const updatedShipTo = {
        ...(currentPolicy.shipToLocations || {}),
        regionExcluded,
      };
      await updateFulfillmentPolicy(opts.token, policyId, {
        ...currentPolicy,
        shipToLocations: updatedShipTo,
      } as any);
      console.log(chalk.green('    ✔ 更新完了'));
      updatedCount++;
    }

    console.log('');
    if (dryRun) {
      console.log(chalk.yellow(`ドライラン完了: ${updatedCount}件変更予定、${skippedCount}件変更なし`));
    } else {
      console.log(chalk.green(`✔ 完了: ${updatedCount}件更新、${skippedCount}件変更なし`));
    }
  } catch (e: any) {
    console.error(chalk.red(`インポート失敗: ${e?.message || e}`));
    throw e;
  }
}

