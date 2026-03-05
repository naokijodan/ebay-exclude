import chalk from 'chalk';
import { parseCSV } from '../lib/csv-handler';
import { resolveExclusions } from '../lib/expansion-engine';
import { getFulfillmentPolicies, getFulfillmentPolicy } from '../lib/ebay-api';
import { regionMapping } from '../data/definitions';

interface DiffOptions {
  token: string;
  marketplaceId?: string;
  file: string;
  policy?: string;
  filter?: string;
}

const reverseRegionMapping: Record<string, string> = Object.fromEntries(
  Object.entries(regionMapping).map(([k, v]) => [v, k])
);

export async function diffCommand(opts: DiffOptions) {
  const marketplaceId = opts.marketplaceId || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
  const rules = parseCSV(opts.file);
  const desired = resolveExclusions(rules);
  try {
    let targetPolicyId = opts.policy;
    if (!targetPolicyId) {
      const all = await getFulfillmentPolicies(opts.token, marketplaceId);
      let list = all;
      if (opts.filter) {
        const f = String(opts.filter).toLowerCase();
        list = all.filter((p) => p.name?.toLowerCase().includes(f));
      }
      if (!list.length) throw new Error('No matching fulfillment policies');
      targetPolicyId = list[0].fulfillmentPolicyId;
    }
    const policy = await getFulfillmentPolicy(opts.token, targetPolicyId!);
    const current = policy.shipToLocations?.regionExcluded || [];

    const currentRegions = new Set(current.filter((x) => x.regionType === 'COUNTRY_REGION').map((x) => x.regionName));
    const desiredRegions = new Set(
      desired.regionExcluded.filter((x) => x.regionType === 'COUNTRY_REGION').map((x) => x.regionName)
    );
    const currentCountries = new Set(current.filter((x) => x.regionType === 'COUNTRY').map((x) => x.regionName));
    const desiredCountries = new Set(
      desired.regionExcluded.filter((x) => x.regionType === 'COUNTRY').map((x) => x.regionName)
    );

    console.log(chalk.bold(`Policy: "${policy.name}"`));
    // Regions removed
    for (const r of Array.from(currentRegions).sort()) {
      if (!desiredRegions.has(r)) {
        const display = reverseRegionMapping[r] || r;
        console.log(chalk.red(`  [-] Region: ${display}`));
      }
    }
    // Regions added
    for (const r of Array.from(desiredRegions).sort()) {
      if (!currentRegions.has(r)) {
        const display = reverseRegionMapping[r] || r;
        console.log(chalk.green(`  [+] Region: ${display}`));
      } else {
        const display = reverseRegionMapping[r] || r;
        console.log(chalk.gray(`  [=] Region: ${display} - no change`));
      }
    }
    // Countries
    for (const c of Array.from(currentCountries).sort()) {
      if (!desiredCountries.has(c)) {
        console.log(chalk.red(`  [-] Country: ${c} - will be included`));
      }
    }
    for (const c of Array.from(desiredCountries).sort()) {
      if (!currentCountries.has(c)) {
        console.log(chalk.green(`  [+] Country: ${c} - will be excluded`));
      }
    }
    const total = desiredCountries.size;
    console.log(chalk.bold(`  Result: ${total} countries will be excluded (by country; regions compressed separately)`));
  } catch (e: any) {
    console.error(chalk.red(`Failed to diff: ${e?.message || e}`));
    throw e;
  }
}

