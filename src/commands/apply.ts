import chalk from 'chalk';
import ora from 'ora';
import { parseCSV } from '../lib/csv-handler';
import { resolveExclusions } from '../lib/expansion-engine';
import { getFulfillmentPolicies, getFulfillmentPolicy, updateFulfillmentPolicy } from '../lib/ebay-api';
import { computeRulesHash, loadState, recordPolicyState, saveState } from '../lib/state-manager';

interface ApplyOptions {
  token: string;
  marketplaceId?: string;
  file: string;
  filter?: string;
  force?: boolean;
  dryRun?: boolean;
}

function canonRegionExcluded(arr: Array<{ regionName: string; regionType: string }>) {
  return (arr || [])
    .map((x) => ({ regionName: x.regionName, regionType: x.regionType }))
    .sort((a, b) => `${a.regionType}:${a.regionName}`.localeCompare(`${b.regionType}:${b.regionName}`));
}

function equalRegionExcluded(a: Array<{ regionName: string; regionType: string }>, b: Array<{ regionName: string; regionType: string }>) {
  const ca = canonRegionExcluded(a);
  const cb = canonRegionExcluded(b);
  if (ca.length !== cb.length) return false;
  for (let i = 0; i < ca.length; i++) {
    if (ca[i].regionName !== cb[i].regionName || ca[i].regionType !== cb[i].regionType) return false;
  }
  return true;
}

export async function applyCommand(opts: ApplyOptions) {
  const marketplaceId = opts.marketplaceId || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
  const spinner = ora();
  try {
    // 1. CSV読み込み＆バリデーション
    const rules = parseCSV(opts.file);
    const rulesHash = computeRulesHash(rules);
    const resolved = resolveExclusions(rules);

    // 2. eBay APIから全ポリシー取得
    const allPolicies = await getFulfillmentPolicies(opts.token, marketplaceId);
    let policies = allPolicies;
    // 3. --filter があれば名前でフィルタ
    if (opts.filter) {
      const f = String(opts.filter).toLowerCase();
      policies = allPolicies.filter((p) => p.name?.toLowerCase().includes(f));
    }
    if (!policies.length) {
      console.log(chalk.yellow('No matching policies to apply.'));
      return;
    }

    const state = loadState();
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // 4. 各ポリシー適用
    for (let i = 0; i < policies.length; i++) {
      const p = policies[i];
      const label = `Processing [${i + 1}/${policies.length}] ${p.name}`;
      spinner.text = label;
      spinner.start();
      try {
        // a. 現在の除外設定を取得
        const full = await getFulfillmentPolicy(opts.token, p.fulfillmentPolicyId);
        const currentExcluded = full.shipToLocations?.regionExcluded || [];

        // c. ステートファイル確認
        const prev = state.policies[p.fulfillmentPolicyId];
        if (!opts.force && prev && prev.hash === rulesHash && prev.success) {
          // Still check if current is equal; if so skip
          if (equalRegionExcluded(currentExcluded, resolved.regionExcluded)) {
            spinner.succeed(`Skipped (no change) ${p.name}`);
            skipped++;
            continue;
          }
        }

        // b. CSVから生成した除外設定と比較
        const hasDiff = !equalRegionExcluded(currentExcluded, resolved.regionExcluded);
        if (!hasDiff) {
          spinner.succeed(`Skipped (no change) ${p.name}`);
          skipped++;
          continue;
        }

        // d. --dry-run なら差分表示のみ
        if (opts.dryRun) {
          spinner.stop();
          console.log(chalk.cyan(`Dry-run: would update ${p.name}`));
          console.log(`  From: ${currentExcluded.length} entries -> To: ${resolved.regionExcluded.length} entries`);
          skipped++;
          continue;
        }

        // e. 差分があれば更新API呼び出し (PUT needs full payload)
        const updatedPolicy = {
          ...full,
          shipToLocations: {
            ...(full.shipToLocations || {}),
            regionExcluded: resolved.regionExcluded,
          },
        };
        await updateFulfillmentPolicy(opts.token, p.fulfillmentPolicyId, updatedPolicy);
        recordPolicyState(state, p.fulfillmentPolicyId, rulesHash, true);
        spinner.succeed(`Updated ${p.name}`);
        updated++;
      } catch (e: any) {
        errors++;
        recordPolicyState(state, p.fulfillmentPolicyId, rulesHash, false);
        if (e?.status === 429) {
          state.resumeFrom = p.fulfillmentPolicyId;
        }
        spinner.fail(`Error ${p.name}: ${e?.message || e}`);
      } finally {
        saveState(state);
      }
    }

    console.log(
      chalk.bold(`Summary: updated ${updated}, skipped ${skipped}, errors ${errors} (policies: ${policies.length})`)
    );
  } catch (e: any) {
    spinner.stop();
    console.error(chalk.red(`Apply failed: ${e?.message || e}`));
    throw e;
  }
}

