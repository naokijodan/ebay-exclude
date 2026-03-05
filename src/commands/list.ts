import chalk from 'chalk';
import { getFulfillmentPolicies } from '../lib/ebay-api';
import { classifyRegionName } from '../lib/classify-region';

interface ListOptions {
  token?: string;
  marketplaceId?: string;
  filter?: string;
}

export async function listCommand(opts: ListOptions) {
  const marketplaceId = opts.marketplaceId || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
  try {
    const policies = await getFulfillmentPolicies(opts.token, marketplaceId);
    const filtered = opts.filter
      ? policies.filter((p) => p.name && p.name.toLowerCase().includes(String(opts.filter).toLowerCase()))
      : policies;

    const rows = filtered.map((p) => {
      const excluded = p.shipToLocations?.regionExcluded || [];
      const regions = excluded
        .filter((e) => classifyRegionName(e.regionName) === 'COUNTRY_REGION')
        .map((e) => e.regionName);
      const countries = excluded.filter((e) => classifyRegionName(e.regionName) === 'COUNTRY').length;
      return {
        policyId: p.fulfillmentPolicyId,
        name: p.name,
        excludedRegions: regions.join('; '),
        excludedCountries: countries,
      };
    });

    // Print table
    const header = ['Policy ID', 'Name', 'Excluded Regions', 'Excluded Countries'];
    const widths = [20, 30, 40, 18];
    const fmt = (s: string, w: number) => (s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w));
    console.log(
      chalk.bold(
        fmt(header[0], widths[0]) +
          ' ' +
          fmt(header[1], widths[1]) +
          ' ' +
          fmt(header[2], widths[2]) +
          ' ' +
          fmt(header[3], widths[3])
      )
    );
    for (const r of rows) {
      console.log(
        fmt(r.policyId || '', widths[0]) +
          ' ' +
          fmt(r.name || '', widths[1]) +
          ' ' +
          fmt(r.excludedRegions || '', widths[2]) +
          ' ' +
          fmt(String(r.excludedCountries), widths[3])
      );
    }
  } catch (e: any) {
    console.error(chalk.red(`Failed to list fulfillment policies: ${e?.message || e}`));
    throw e;
  }
}
