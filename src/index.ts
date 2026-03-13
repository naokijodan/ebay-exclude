#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init';
import { listCommand } from './commands/list';
import { exportCommand } from './commands/export';
import { diffCommand } from './commands/diff';
import { applyCommand } from './commands/apply';
import { runWizard } from './commands/wizard';
import { exportAllCommand } from './commands/export-all';
import { importAllCommand } from './commands/import-all';
import { shippingListCommand, shippingReorderCommand, shippingAddCommand, shippingRemoveCommand } from './commands/shipping';

const program = new Command();

program
  .name('ebay-exclude')
  .description('Manage eBay fulfillment policy ship-to exclusions via CSV')
  .option('--token <token>', 'eBay OAuth token (overrides EBAY_TOKEN env)')
  .option('--marketplace <id>', 'eBay marketplace id (default EBAY_US)');

program
  .command('init')
  .description('Generate template exclusions CSV (exclusions.csv)')
  .option('-o, --output <path>', 'Output CSV path (default: exclusions.csv)')
  .action(async (cmd) => {
    await initCommand(cmd.output);
  });

program
  .command('list')
  .description('List fulfillment policies with exclusion counts')
  .option('--filter <pattern>', 'Filter policies by name (substring)')
  .action(async (cmd) => {
    const opts = program.opts();
    const tokenOverride = opts.token || undefined;
    if (!tokenOverride && !process.env.EBAY_TOKEN && !process.env.EBAY_REFRESH_TOKEN) {
      console.error(
        chalk.red(
          'Missing credentials. Set EBAY_TOKEN, or EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN in .env'
        )
      );
      process.exit(1);
    }
    await listCommand({ token: tokenOverride, marketplaceId: opts.marketplace, filter: cmd.filter });
  });

program
  .command('export')
  .description('Export exclusions of a policy to CSV (stdout by default)')
  .option('--policy <id>', 'Fulfillment policy ID (default: first policy)')
  .option('-o, --output <path>', 'Output CSV file (default: stdout)')
  .action(async (cmd) => {
    const opts = program.opts();
    const tokenOverride = opts.token || undefined;
    if (!tokenOverride && !process.env.EBAY_TOKEN && !process.env.EBAY_REFRESH_TOKEN) {
      console.error(
        chalk.red(
          'Missing credentials. Set EBAY_TOKEN, or EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN in .env'
        )
      );
      process.exit(1);
    }
    await exportCommand({ token: tokenOverride, marketplaceId: opts.marketplace, policy: cmd.policy, output: cmd.output });
  });

program
  .command('export-all')
  .description('Export all policies exclusions to a single Excel file')
  .option('-o, --output <file>', 'Output file path (default: ebay-policies.xlsx)')
  .action(async (cmd) => {
    const opts = program.opts();
    const tokenOverride = opts.token || undefined;
    if (!tokenOverride && !process.env.EBAY_TOKEN && !process.env.EBAY_REFRESH_TOKEN) {
      console.error(
        chalk.red(
          'Missing credentials. Set EBAY_TOKEN, or EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN in .env'
        )
      );
      process.exit(1);
    }
    await exportAllCommand({ token: tokenOverride, marketplaceId: opts.marketplace, output: cmd.output });
  });

program
  .command('diff <file>')
  .description('Show semantic diff between CSV and current eBay settings')
  .option('--policy <id>', 'Fulfillment policy ID')
  .option('--filter <pattern>', 'Filter policies by name (substring)')
  .action(async (file, cmd) => {
    const opts = program.opts();
    const tokenOverride = opts.token || undefined;
    if (!tokenOverride && !process.env.EBAY_TOKEN && !process.env.EBAY_REFRESH_TOKEN) {
      console.error(
        chalk.red(
          'Missing credentials. Set EBAY_TOKEN, or EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN in .env'
        )
      );
      process.exit(1);
    }
    await diffCommand({ token: tokenOverride, marketplaceId: opts.marketplace, file, policy: cmd.policy, filter: cmd.filter });
  });

program
  .command('apply <file>')
  .description('Apply CSV exclusions to matching fulfillment policies')
  .option('--filter <pattern>', 'Filter policies by name (substring)')
  .option('--force', 'Ignore state file and force update', false)
  .option('--dry-run', 'Show planned changes without updating', false)
  .action(async (file, cmd) => {
    const opts = program.opts();
    const tokenOverride = opts.token || undefined;
    if (!tokenOverride && !process.env.EBAY_TOKEN && !process.env.EBAY_REFRESH_TOKEN) {
      console.error(
        chalk.red(
          'Missing credentials. Set EBAY_TOKEN, or EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN in .env'
        )
      );
      process.exit(1);
    }
    await applyCommand({ token: tokenOverride, marketplaceId: opts.marketplace, file, filter: cmd.filter, force: cmd.force, dryRun: cmd.dryRun });
  });

program
  .command('import-all <file>')
  .description('Import and apply exclusions from an Excel file to eBay')
  .option('--dry-run', 'Preview changes without applying')
  .action(async (file, cmd) => {
    const opts = program.opts();
    const tokenOverride = opts.token || undefined;
    if (!tokenOverride && !process.env.EBAY_TOKEN && !process.env.EBAY_REFRESH_TOKEN) {
      console.error(
        chalk.red(
          'Missing credentials. Set EBAY_TOKEN, or EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN in .env'
        )
      );
      process.exit(1);
    }
    await importAllCommand({ token: tokenOverride, marketplaceId: opts.marketplace, file, dryRun: cmd.dryRun });
  });

program
  .command('wizard')
  .description('Interactive wizard mode (対話式ウィザード)')
  .action(async () => {
    await runWizard();
  });

// Shipping subcommands group
const shipping = program.command('shipping').description('Manage shipping services in fulfillment policies');

shipping
  .command('list')
  .description('List shippingOptions of policies')
  .option('--filter <pattern>', 'Filter policies by name (substring)')
  .option('--policy <id>', 'Fulfillment policy ID')
  .action(async (cmd) => {
    const opts = program.opts();
    const tokenOverride = opts.token || undefined;
    if (!tokenOverride && !process.env.EBAY_TOKEN && !process.env.EBAY_REFRESH_TOKEN) {
      console.error(
        chalk.red(
          'Missing credentials. Set EBAY_TOKEN, or EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN in .env'
        )
      );
      process.exit(1);
    }
    await shippingListCommand({ token: tokenOverride, marketplaceId: opts.marketplace, filter: cmd.filter, policy: cmd.policy });
  });

shipping
  .command('reorder')
  .description('Reorder INTERNATIONAL shipping services (move service to first)')
  .option('--service <code>', 'Service code to move to first (e.g., US_IntlExpeditedSppedPAK)')
  .option('--filter <pattern>', 'Filter policies by name (substring)')
  .option('--policy <id>', 'Fulfillment policy ID')
  .option('--dry-run', 'Preview only (default: true)')
  .action(async (cmd) => {
    const opts = program.opts();
    const tokenOverride = opts.token || undefined;
    if (!tokenOverride && !process.env.EBAY_TOKEN && !process.env.EBAY_REFRESH_TOKEN) {
      console.error(
        chalk.red(
          'Missing credentials. Set EBAY_TOKEN, or EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN in .env'
        )
      );
      process.exit(1);
    }
    await shippingReorderCommand({ token: tokenOverride, marketplaceId: opts.marketplace, service: cmd.service, filter: cmd.filter, policy: cmd.policy, dryRun: cmd.dryRun });
  });

shipping
  .command('add')
  .description('Add a shippingService to INTERNATIONAL')
  .option('--service <code>', 'Service code (e.g., US_IntlExpeditedSppedPAK)')
  .option('--cost <number>', 'Shipping cost', (v) => Number(v))
  .option('--ship-to <region>', 'Ship-to region name (e.g., Europe)')
  .option('--additional-cost <number>', 'Additional item cost (default: same as --cost)', (v) => Number(v))
  .option('--filter <pattern>', 'Filter policies by name (substring)')
  .option('--policy <id>', 'Fulfillment policy ID')
  .option('--dry-run', 'Preview only (default: true)')
  .action(async (cmd) => {
    const opts = program.opts();
    const tokenOverride = opts.token || undefined;
    if (!tokenOverride && !process.env.EBAY_TOKEN && !process.env.EBAY_REFRESH_TOKEN) {
      console.error(
        chalk.red(
          'Missing credentials. Set EBAY_TOKEN, or EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN in .env'
        )
      );
      process.exit(1);
    }
    await shippingAddCommand({
      token: tokenOverride,
      marketplaceId: opts.marketplace,
      service: cmd.service,
      cost: cmd.cost,
      shipTo: cmd.shipTo,
      additionalCost: cmd.additionalCost,
      filter: cmd.filter,
      policy: cmd.policy,
      dryRun: cmd.dryRun,
    });
  });

shipping
  .command('remove')
  .description('Remove a shippingService from INTERNATIONAL')
  .option('--service <code>', 'Service code to remove')
  .option('--filter <pattern>', 'Filter policies by name (substring)')
  .option('--policy <id>', 'Fulfillment policy ID')
  .option('--dry-run', 'Preview only (default: true)')
  .action(async (cmd) => {
    const opts = program.opts();
    const tokenOverride = opts.token || undefined;
    if (!tokenOverride && !process.env.EBAY_TOKEN && !process.env.EBAY_REFRESH_TOKEN) {
      console.error(
        chalk.red(
          'Missing credentials. Set EBAY_TOKEN, or EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN in .env'
        )
      );
      process.exit(1);
    }
    await shippingRemoveCommand({ token: tokenOverride, marketplaceId: opts.marketplace, service: cmd.service, filter: cmd.filter, policy: cmd.policy, dryRun: cmd.dryRun });
  });

program.parseAsync().catch((e) => {
  console.error(chalk.red(e?.message || e));
  process.exit(1);
});
