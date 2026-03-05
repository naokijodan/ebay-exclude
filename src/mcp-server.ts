#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getFulfillmentPolicies, getFulfillmentPolicy, updateFulfillmentPolicy } from './lib/ebay-api';
import { classifyRegionName } from './lib/classify-region';
import { regionMapping, countryToIso, isoToCountry } from './data/definitions';
import { exportAllCommand } from './commands/export-all';
import { importAllCommand } from './commands/import-all';

// Reverse mapping for regions: API internal name -> display name
const reverseRegionMapping: Record<string, string> = Object.fromEntries(
  Object.entries(regionMapping).map(([display, api]) => [api, display])
);

// Helper: Convert API regionName to display name
function toDisplayName(regionName: string): string {
  const t = classifyRegionName(regionName);
  if (t === 'COUNTRY_REGION') {
    return reverseRegionMapping[regionName] || regionName;
  }
  if (t === 'COUNTRY') {
    return isoToCountry[regionName] || regionName;
  }
  return regionName; // domestic/PO Box and others
}

// Helper: Convert display name to API regionName
function toApiName(displayName: string): string {
  if (regionMapping[displayName]) return regionMapping[displayName];
  if (countryToIso[displayName]) return countryToIso[displayName];
  return displayName; // domestic/PO Box/ISO code as-is
}

// Capture console output during a function execution to avoid MCP stdio interference
async function withCapturedConsole<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  let buffer = '';
  const append = (args: any[]) => {
    const msg = args
      .map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
      .join(' ');
    buffer += (buffer ? '\n' : '') + msg;
  };
  // Redirect
  (console as any).log = (...args: any[]) => append(args);
  (console as any).warn = (...args: any[]) => append(args);
  (console as any).error = (...args: any[]) => append(args);
  try {
    const result = await fn();
    return { result, logs: buffer };
  } finally {
    // Restore
    (console as any).log = originalLog;
    (console as any).warn = originalWarn;
    (console as any).error = originalError;
  }
}

async function main() {
  const server = new McpServer({ name: 'ebay-exclude-mcp', version: '1.0.0' });

  // Tool: list_policies
  server.tool(
    'list_policies',
    'eBayの全フルフィルメントポリシー一覧を取得',
    async (args: any) => {
      try {
        const marketplaceId = (args?.marketplaceId as string) || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
        const policies = await getFulfillmentPolicies(undefined, marketplaceId);
        const out = policies.map((p: any) => ({
          name: p.name,
          id: p.fulfillmentPolicyId,
          excludedCount: (p.shipToLocations?.regionExcluded || []).length,
        }));
        return { content: [{ type: 'json', json: out }] } as any;
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] } as any;
      }
    }
  );

  // Tool: get_policy_exclusions
  server.tool(
    'get_policy_exclusions',
    '特定ポリシーの除外設定を人間が読める形で取得',
    async (args: any) => {
      try {
        const policyId = args?.policyId as string;
        const policy = await getFulfillmentPolicy(undefined, policyId);
        const excluded = policy.shipToLocations?.regionExcluded || [];
        const regions: string[] = [];
        const domestics: string[] = [];
        const countries: string[] = [];

        for (const r of excluded) {
          const dn = toDisplayName(r.regionName);
          const t = classifyRegionName(r.regionName);
          if (t === 'COUNTRY_REGION') regions.push(dn);
          else if (t === 'COUNTRY') countries.push(dn);
          else domestics.push(dn);
        }

        const json = {
          policyName: policy.name,
          policyId: policy.fulfillmentPolicyId,
          exclusions: { regions, domestics, countries },
        };
        return { content: [{ type: 'json', json }] } as any;
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] } as any;
      }
    }
  );

  // Tool: update_exclusions
  server.tool(
    'update_exclusions',
    '特定ポリシーの除外設定を更新',
    async (args: any) => {
      try {
        const policyId = args?.policyId as string;
        const add: string[] = Array.isArray(args?.addExclusions) ? args.addExclusions : [];
        const remove: string[] = Array.isArray(args?.removeExclusions) ? args.removeExclusions : [];
        const set: string[] | undefined = Array.isArray(args?.setExclusions) ? args.setExclusions : undefined;

        const current = await getFulfillmentPolicy(undefined, policyId);
        const currentExcluded = current.shipToLocations?.regionExcluded || [];

        // Current display-name set
        const currentDisplay = new Set<string>(currentExcluded.map((r: any) => toDisplayName(r.regionName)));

        let nextDisplay: Set<string>;
        if (set) {
          nextDisplay = new Set<string>(set);
        } else {
          nextDisplay = new Set<string>(currentDisplay);
          for (const a of add) nextDisplay.add(a);
          for (const rm of remove) nextDisplay.delete(rm);
        }

        // Compute diffs
        const added = [...nextDisplay].filter((n) => !currentDisplay.has(n));
        const removed = [...currentDisplay].filter((n) => !nextDisplay.has(n));

        // Convert to API names
        const regionExcluded = [...nextDisplay].map((dn) => ({ regionName: toApiName(dn) }));

        const updated = await updateFulfillmentPolicy(undefined, policyId, {
          ...current,
          shipToLocations: { ...current.shipToLocations, regionExcluded },
        } as any);

        const totalExclusions = (updated.shipToLocations?.regionExcluded || []).length;

        const json = {
          success: true,
          policyName: updated.name,
          added,
          removed,
          totalExclusions,
        };
        return { content: [{ type: 'json', json }] } as any;
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] } as any;
      }
    }
  );

  // Tool: export_all_excel
  server.tool(
    'export_all_excel',
    '全ポリシーの除外設定をピボット形式のExcelに出力',
    async (args: any) => {
      try {
        const outputPath = (args?.outputPath as string) || 'ebay-policies.xlsx';
        const { logs } = await withCapturedConsole(async () => {
          await exportAllCommand({ token: undefined, marketplaceId: process.env.EBAY_MARKETPLACE_ID, output: outputPath });
          return true;
        });

        let policyCount: number | undefined;
        let columnCount: number | undefined;
        const m = logs.match(/（(\d+)ポリシー × (\d+)列）/);
        if (m) {
          policyCount = Number(m[1]);
          columnCount = Number(m[2]);
        }

        const json: any = { success: true, filePath: outputPath };
        if (policyCount !== undefined) json.policyCount = policyCount;
        if (columnCount !== undefined) json.columnCount = columnCount;

        return { content: [{ type: 'json', json }, ...(logs ? [{ type: 'text', text: logs }] : [])] } as any;
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] } as any;
      }
    }
  );

  // Tool: import_excel
  server.tool(
    'import_excel',
    'ピボット形式のExcelからeBayに除外設定を反映',
    async (args: any) => {
      try {
        const filePath = args?.filePath as string;
        const dryRun = typeof args?.dryRun === 'boolean' ? Boolean(args.dryRun) : true;
        const { logs } = await withCapturedConsole(async () => {
          await importAllCommand({ token: undefined, marketplaceId: process.env.EBAY_MARKETPLACE_ID, file: filePath, dryRun });
          return true;
        });

        // Parse counts from logs
        let updatedCount: number | undefined;
        let skippedCount: number | undefined;
        let m = logs.match(/ドライラン完了: (\d+)件変更予定、(\d+)件変更なし/);
        if (m) {
          updatedCount = Number(m[1]);
          skippedCount = Number(m[2]);
        } else {
          m = logs.match(/完了: (\d+)件更新、(\d+)件変更なし/);
          if (m) {
            updatedCount = Number(m[1]);
            skippedCount = Number(m[2]);
          }
        }

        const json: any = { success: true, dryRun };
        if (updatedCount !== undefined) json.updatedCount = updatedCount;
        if (skippedCount !== undefined) json.skippedCount = skippedCount;

        return { content: [{ type: 'json', json }, ...(logs ? [{ type: 'text', text: logs }] : [])] } as any;
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] } as any;
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  // Last-resort error to stderr; avoid interfering with stdio protocol
  try {
    const msg = e?.message || String(e);
    process.stderr.write(msg + '\n');
  } catch {}
  process.exit(1);
});
