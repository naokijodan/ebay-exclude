import chalk from 'chalk';
import ora from 'ora';
import pLimit from 'p-limit';
import { getFulfillmentPolicies, getFulfillmentPolicy, updateFulfillmentPolicy } from '../lib/ebay-api';
import { FulfillmentPolicy } from '../types';

export interface ShippingOptions {
  token?: string;
  marketplaceId?: string;
  filter?: string;
  policy?: string;
  service?: string;
  cost?: number;
  shipTo?: string;
  additionalCost?: number;
  dryRun?: boolean;
}

function getMarketplaceId(id?: string) {
  return id || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
}

function fmtCell(s: string, w: number) {
  const v = s ?? '';
  return v.length > w ? v.slice(0, w - 1) + '…' : v.padEnd(w);
}

function findInternationalOption(policy: FulfillmentPolicy): any | undefined {
  const opts = Array.isArray(policy.shippingOptions) ? policy.shippingOptions : [];
  return opts.find((o: any) => o?.optionType === 'INTERNATIONAL');
}

function getCurrencyFromPolicy(policy: FulfillmentPolicy): string {
  const intl = findInternationalOption(policy);
  const services = intl?.shippingServices as any[] | undefined;
  const currency = services?.find((s: any) => s?.shippingCost?.currency)?.shippingCost?.currency;
  return currency || 'USD';
}

export async function shippingListCommand(opts: ShippingOptions) {
  const marketplaceId = getMarketplaceId(opts.marketplaceId);
  try {
    let policies: FulfillmentPolicy[] = [];
    if (opts.policy) {
      const one = await getFulfillmentPolicy(opts.token, opts.policy);
      policies = [one];
    } else {
      const all = await getFulfillmentPolicies(opts.token, marketplaceId);
      const f = (opts.filter || '').toLowerCase();
      policies = f ? all.filter((p) => (p.name || '').toLowerCase().includes(f)) : all;
      if (!opts.filter) {
        console.log(chalk.yellow('No --filter/--policy specified; listing all policies.'));
      }
    }

    if (!policies.length) {
      console.log(chalk.yellow('No matching policies.'));
      return;
    }

    const header = ['policy', 'optionType', 'serviceCode', 'cost', 'freeShipping', 'shipTo'];
    const widths = [32, 13, 36, 8, 12, 40];

    console.log(
      chalk.bold(
        fmtCell(header[0], widths[0]) +
          ' ' +
          fmtCell(header[1], widths[1]) +
          ' ' +
          fmtCell(header[2], widths[2]) +
          ' ' +
          fmtCell(header[3], widths[3]) +
          ' ' +
          fmtCell(header[4], widths[4]) +
          ' ' +
          fmtCell(header[5], widths[5])
      )
    );
    for (const p of policies) {
      const options: any[] = Array.isArray(p.shippingOptions) ? (p.shippingOptions as any[]) : [];
      for (const o of options) {
        const services: any[] = Array.isArray(o?.shippingServices) ? o.shippingServices : [];
        for (const s of services) {
          const costVal = s?.shippingCost?.value;
          const cost = typeof costVal === 'number' || typeof costVal === 'string' ? String(costVal) : '';
          const free = s?.freeShipping ? 'true' : 'false';
          const inc = s?.shipToLocations?.regionIncluded || [];
          const shipTo = Array.isArray(inc) ? inc.map((r: any) => r.regionName).join('; ') : '';
          console.log(
            fmtCell(String(p?.name || ''), widths[0]) +
              ' ' +
              fmtCell(String(o?.optionType || ''), widths[1]) +
              ' ' +
              fmtCell(String(s?.shippingServiceCode || ''), widths[2]) +
              ' ' +
              fmtCell(cost, widths[3]) +
              ' ' +
              fmtCell(free, widths[4]) +
              ' ' +
              fmtCell(shipTo, widths[5])
          );
        }
      }
    }
  } catch (e: any) {
    console.error(chalk.red(`Failed to list shipping services: ${e?.message || e}`));
  }
}

export async function shippingReorderCommand(opts: ShippingOptions) {
  if (!opts.service) {
    throw new Error('Missing --service <code>');
  }
  const marketplaceId = getMarketplaceId(opts.marketplaceId);
  const dryRun = opts.dryRun !== false; // default true
  const spinner = ora();
  try {
    let targets: FulfillmentPolicy[] = [];
    if (opts.policy) {
      targets = [await getFulfillmentPolicy(opts.token, opts.policy)];
    } else {
      const all = await getFulfillmentPolicies(opts.token, marketplaceId);
      const f = (opts.filter || '').toLowerCase();
      targets = f ? all.filter((p) => (p.name || '').toLowerCase().includes(f)) : all;
      if (!opts.filter) {
        console.log(chalk.yellow('No --filter/--policy specified; targeting all policies.'));
      }
    }
    if (!targets.length) {
      console.log(chalk.yellow('No matching policies to process.'));
      return;
    }

    const limit = pLimit(5);
    let success = 0;
    let skipped = 0;
    let failed = 0;

    await Promise.all(
      targets.map((t, i) =>
        limit(async () => {
          const label = `Reordering [${i + 1}/${targets.length}] ${t.name}`;
          spinner.text = label;
          spinner.start();
          try {
            const policy = await getFulfillmentPolicy(opts.token, t.fulfillmentPolicyId);
            const intl = findInternationalOption(policy);
            if (!intl) {
              spinner.succeed(`Skip ${t.name}: no INTERNATIONAL option`);
              skipped++;
              return;
            }
            const services: any[] = Array.isArray(intl.shippingServices) ? intl.shippingServices : [];
            const idx = services.findIndex((s: any) => s?.shippingServiceCode === opts.service);
            if (idx === -1) {
              spinner.succeed(`Skip ${t.name}: service not found`);
              skipped++;
              return;
            }
            if (idx === 0) {
              spinner.succeed(`Skip ${t.name}: already first`);
              skipped++;
              return;
            }
            const [svc] = services.splice(idx, 1);
            services.unshift(svc);
            if (dryRun) {
              spinner.succeed(`Dry-run ${t.name}: would move ${opts.service} to first`);
              skipped++;
              return;
            }
            await updateFulfillmentPolicy(opts.token, t.fulfillmentPolicyId, policy);
            spinner.succeed(`Updated ${t.name}`);
            success++;
          } catch (e: any) {
            failed++;
            spinner.fail(`Error ${t.name}: ${e?.message || e}`);
          }
        })
      )
    );

    console.log(chalk.bold(`Summary: success ${success}, skipped ${skipped}, failed ${failed}`));
  } catch (e: any) {
    spinner.stop();
    console.error(chalk.red(`Reorder failed: ${e?.message || e}`));
  }
}

export async function shippingAddCommand(opts: ShippingOptions) {
  if (!opts.service) throw new Error('Missing --service <code>');
  if (opts.cost === undefined || opts.cost === null) throw new Error('Missing --cost <number>');
  if (!opts.shipTo) throw new Error('Missing --ship-to <region>');
  const marketplaceId = getMarketplaceId(opts.marketplaceId);
  const dryRun = opts.dryRun !== false; // default true
  const spinner = ora();
  try {
    const additionalCost = opts.additionalCost ?? opts.cost;
    let targets: FulfillmentPolicy[] = [];
    if (opts.policy) {
      targets = [await getFulfillmentPolicy(opts.token, opts.policy)];
    } else {
      const all = await getFulfillmentPolicies(opts.token, marketplaceId);
      const f = (opts.filter || '').toLowerCase();
      targets = f ? all.filter((p) => (p.name || '').toLowerCase().includes(f)) : all;
      if (!opts.filter) {
        console.log(chalk.yellow('No --filter/--policy specified; targeting all policies.'));
      }
    }
    if (!targets.length) {
      console.log(chalk.yellow('No matching policies to process.'));
      return;
    }

    const limit = pLimit(5);
    let success = 0;
    let skipped = 0;
    let failed = 0;

    await Promise.all(
      targets.map((t, i) =>
        limit(async () => {
          const label = `Adding [${i + 1}/${targets.length}] ${t.name}`;
          spinner.text = label;
          spinner.start();
          try {
            const policy = await getFulfillmentPolicy(opts.token, t.fulfillmentPolicyId);
            const intl = findInternationalOption(policy);
            if (!intl) {
              spinner.succeed(`Skip ${t.name}: no INTERNATIONAL option`);
              skipped++;
              return;
            }
            const services: any[] = Array.isArray(intl.shippingServices) ? intl.shippingServices : (intl.shippingServices = []);
            if (services.find((s) => s?.shippingServiceCode === opts.service)) {
              spinner.succeed(`Skip ${t.name}: service exists`);
              skipped++;
              return;
            }
            // Determine next sortOrder
            const existingSortOrders = services
              .map((s) => (typeof s?.sortOrder === 'number' ? s.sortOrder : undefined))
              .filter((n) => typeof n === 'number') as number[];
            const maxSortOrder = existingSortOrders.length ? Math.max(...existingSortOrders) : 0;
            const newSvc: any = {
              sortOrder: maxSortOrder + 1,
              shippingCarrierCode: 'eBay',
              shippingServiceCode: opts.service,
              shippingCost: { value: String(opts.cost), currency: 'USD' },
              additionalShippingCost: { value: String(additionalCost), currency: 'USD' },
              freeShipping: false,
              shipToLocations: { regionIncluded: [{ regionName: String(opts.shipTo) }] },
            };
            services.push(newSvc);
            if (dryRun) {
              spinner.succeed(`Dry-run ${t.name}: would add ${opts.service}`);
              skipped++;
              return;
            }
            await updateFulfillmentPolicy(opts.token, t.fulfillmentPolicyId, policy);
            spinner.succeed(`Updated ${t.name}`);
            success++;
          } catch (e: any) {
            failed++;
            spinner.fail(`Error ${t.name}: ${e?.message || e}`);
          }
        })
      )
    );

    console.log(chalk.bold(`Summary: success ${success}, skipped ${skipped}, failed ${failed}`));
  } catch (e: any) {
    spinner.stop();
    console.error(chalk.red(`Add failed: ${e?.message || e}`));
  }
}

export async function shippingRemoveCommand(opts: ShippingOptions) {
  if (!opts.service) throw new Error('Missing --service <code>');
  const marketplaceId = getMarketplaceId(opts.marketplaceId);
  const dryRun = opts.dryRun !== false; // default true
  const spinner = ora();
  try {
    let targets: FulfillmentPolicy[] = [];
    if (opts.policy) {
      targets = [await getFulfillmentPolicy(opts.token, opts.policy)];
    } else {
      const all = await getFulfillmentPolicies(opts.token, marketplaceId);
      const f = (opts.filter || '').toLowerCase();
      targets = f ? all.filter((p) => (p.name || '').toLowerCase().includes(f)) : all;
      if (!opts.filter) {
        console.log(chalk.yellow('No --filter/--policy specified; targeting all policies.'));
      }
    }
    if (!targets.length) {
      console.log(chalk.yellow('No matching policies to process.'));
      return;
    }

    const limit = pLimit(5);
    let success = 0;
    let skipped = 0;
    let failed = 0;

    await Promise.all(
      targets.map((t, i) =>
        limit(async () => {
          const label = `Removing [${i + 1}/${targets.length}] ${t.name}`;
          spinner.text = label;
          spinner.start();
          try {
            const policy = await getFulfillmentPolicy(opts.token, t.fulfillmentPolicyId);
            const intl = findInternationalOption(policy);
            if (!intl) {
              spinner.succeed(`Skip ${t.name}: no INTERNATIONAL option`);
              skipped++;
              return;
            }
            const services: any[] = Array.isArray(intl.shippingServices) ? intl.shippingServices : [];
            const idx = services.findIndex((s) => s?.shippingServiceCode === opts.service);
            if (idx === -1) {
              spinner.succeed(`Skip ${t.name}: service not found`);
              skipped++;
              return;
            }
            if (dryRun) {
              spinner.succeed(`Dry-run ${t.name}: would remove ${opts.service}`);
              skipped++;
              return;
            }
            services.splice(idx, 1);
            await updateFulfillmentPolicy(opts.token, t.fulfillmentPolicyId, policy);
            spinner.succeed(`Updated ${t.name}`);
            success++;
          } catch (e: any) {
            failed++;
            spinner.fail(`Error ${t.name}: ${e?.message || e}`);
          }
        })
      )
    );

    console.log(chalk.bold(`Summary: success ${success}, skipped ${skipped}, failed ${failed}`));
  } catch (e: any) {
    spinner.stop();
    console.error(chalk.red(`Remove failed: ${e?.message || e}`));
  }
}
