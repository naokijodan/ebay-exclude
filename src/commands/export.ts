import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { getFulfillmentPolicies, getFulfillmentPolicy } from '../lib/ebay-api';
import { writeCSV } from '../lib/csv-handler';
import { ExclusionRule } from '../types';
import { regionMapping } from '../data/definitions';

interface ExportOptions {
  token: string;
  marketplaceId?: string;
  policy?: string;
  output?: string; // if omitted, stdout
}

const reverseRegionMapping: Record<string, string> = Object.fromEntries(
  Object.entries(regionMapping).map(([k, v]) => [v, k])
);

function regionExcludedToRules(regionExcluded: Array<{ regionName: string; regionType: string }>): ExclusionRule[] {
  const rules: ExclusionRule[] = [];
  for (const r of regionExcluded || []) {
    if (r.regionType === 'COUNTRY_REGION') {
      const regionDisplay = reverseRegionMapping[r.regionName] || r.regionName;
      rules.push({ type: 'region', value: regionDisplay, action: 'exclude', note: '' });
    } else if (r.regionType === 'COUNTRY') {
      rules.push({ type: 'country', value: r.regionName, action: 'exclude', note: '' });
    } else if (r.regionType === 'STATE_OR_PROVINCE') {
      rules.push({ type: 'domestic', value: r.regionName, action: 'exclude', note: '' });
    } else if (r.regionType === 'PO_BOX') {
      rules.push({ type: 'other', value: 'PO Box', action: 'exclude', note: '' });
    }
  }
  return rules;
}

export async function exportCommand(opts: ExportOptions) {
  const marketplaceId = opts.marketplaceId || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
  try {
    let policyId = opts.policy;
    if (!policyId) {
      const all = await getFulfillmentPolicies(opts.token, marketplaceId);
      if (!all.length) throw new Error('No fulfillment policies found');
      policyId = all[0].fulfillmentPolicyId;
    }
    const policy = await getFulfillmentPolicy(opts.token, policyId!);
    const rules = regionExcludedToRules(policy.shipToLocations?.regionExcluded || []);
    if (opts.output) {
      const abs = path.resolve(opts.output);
      writeCSV(abs, rules);
      console.log(chalk.green(`Exported exclusions to ${abs}`));
    } else {
      // stdout
      const lines = ['type,value,action,note', ...rules.map((r) => `${r.type},${r.value},${r.action},${r.note || ''}`)];
      process.stdout.write(lines.join('\n') + '\n');
    }
  } catch (e: any) {
    console.error(chalk.red(`Failed to export: ${e?.message || e}`));
    throw e;
  }
}

