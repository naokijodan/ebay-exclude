#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import pLimit from 'p-limit';

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
    { marketplaceId: z.string().optional().describe('eBay marketplace ID (default: EBAY_US)') },
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

  // Tool: bulk_update_exclusions
  server.tool(
    'bulk_update_exclusions',
    'ポリシー名フィルタで一括除外設定更新（部分一致）',
    {
      filter: z.string().optional().describe('ポリシー名の部分一致フィルタ（空なら全ポリシー対象）'),
      addExclusions: z.array(z.string()).optional().describe('追加する除外項目の表示名配列'),
      removeExclusions: z.array(z.string()).optional().describe('解除する除外項目の表示名配列'),
      dryRun: z.boolean().optional().default(true).describe('trueでプレビューのみ、falseで実際に反映'),
    },
    async (args: any) => {
      try {
        const marketplaceId = process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
        const filter = (args?.filter as string | undefined)?.toLowerCase().trim();
        const add: string[] = Array.isArray(args?.addExclusions) ? args.addExclusions : [];
        const remove: string[] = Array.isArray(args?.removeExclusions) ? args.removeExclusions : [];
        const dryRun: boolean = typeof args?.dryRun === 'boolean' ? Boolean(args.dryRun) : true;

        const policies = await getFulfillmentPolicies(undefined, marketplaceId);
        const matched = policies.filter((p: any) => (!filter ? true : String(p.name || '').toLowerCase().includes(filter)));

        const limit = pLimit(5);
        const details: Array<{ name: string; id: string; added: string[]; removed: string[] }> = [];
        let updated = 0;
        let skipped = 0;

        await Promise.all(
          matched.map((p: any) =>
            limit(async () => {
              const currentExcluded = p.shipToLocations?.regionExcluded || [];
              const currentDisplay = new Set<string>(currentExcluded.map((r: any) => toDisplayName(r.regionName)));

              const nextDisplay = new Set<string>(currentDisplay);
              for (const a of add) nextDisplay.add(a);
              for (const rm of remove) nextDisplay.delete(rm);

              const added = [...nextDisplay].filter((n) => !currentDisplay.has(n));
              const removed = [...currentDisplay].filter((n) => !nextDisplay.has(n));

              if (added.length === 0 && removed.length === 0) {
                skipped++;
                return;
              }

              details.push({ name: p.name, id: p.fulfillmentPolicyId, added, removed });

              if (!dryRun) {
                const regionExcluded = [...nextDisplay].map((dn) => ({ regionName: toApiName(dn) }));
                const current = await getFulfillmentPolicy(undefined, p.fulfillmentPolicyId);
                await updateFulfillmentPolicy(undefined, p.fulfillmentPolicyId, {
                  ...current,
                  shipToLocations: { ...current.shipToLocations, regionExcluded },
                } as any);
              }
              updated++;
            })
          )
        );

        const json = { totalMatched: matched.length, updated, skipped, dryRun, details };
        return { content: [{ type: 'json', json }] } as any;
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] } as any;
      }
    }
  );

  // Tool: get_policy_exclusions
  server.tool(
    'get_policy_exclusions',
    '特定ポリシーの除外設定を人間が読める形で取得',
    { policyId: z.string().describe('フルフィルメントポリシーID') },
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
    {
      policyId: z.string().describe('フルフィルメントポリシーID'),
      addExclusions: z.array(z.string()).optional().describe('追加する除外項目の表示名配列。例: ["Africa", "Japan", "PO Box"]'),
      removeExclusions: z.array(z.string()).optional().describe('解除する除外項目の表示名配列'),
      setExclusions: z.array(z.string()).optional().describe('除外リストを丸ごと置き換える表示名配列'),
    },
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
    { outputPath: z.string().optional().describe('出力ファイルパス (default: ebay-policies.xlsx)') },
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
    {
      filePath: z.string().describe('インポートするExcelファイルのパス'),
      dryRun: z.boolean().optional().default(true).describe('trueでプレビューのみ、falseで実際に反映'),
    },
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

  // Tool: list_shipping_services
  server.tool(
    'list_shipping_services',
    'ポリシーのshippingServices一覧を取得',
    {
      policyId: z.string().optional().describe('フルフィルメントポリシーID'),
      filter: z.string().optional().describe('ポリシー名の部分一致フィルタ'),
      marketplaceId: z.string().optional().describe('eBay marketplace ID (default: EBAY_US)'),
    },
    async (args: any) => {
      try {
        const marketplaceId = (args?.marketplaceId as string) || process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
        let policies: any[] = [];
        if (args?.policyId) {
          const p = await getFulfillmentPolicy(undefined, String(args.policyId));
          policies = [p];
        } else {
          const all = await getFulfillmentPolicies(undefined, marketplaceId);
          const f = (args?.filter as string | undefined)?.toLowerCase() || '';
          policies = f ? all.filter((p: any) => String(p.name || '').toLowerCase().includes(f)) : all;
        }

        const out = policies.map((p: any) => {
          const items: any[] = [];
          const options: any[] = Array.isArray(p?.shippingOptions) ? p.shippingOptions : [];
          for (const o of options) {
            const services: any[] = Array.isArray(o?.shippingServices) ? o.shippingServices : [];
            for (const s of services) {
              items.push({
                optionType: o?.optionType,
                shippingServiceCode: s?.shippingServiceCode,
                cost: s?.shippingCost?.value,
                freeShipping: !!s?.freeShipping,
                shipToLocations: (s?.shipToLocations?.regionIncluded || []).map((r: any) => r.regionName),
              });
            }
          }
          return { policyId: p?.fulfillmentPolicyId, name: p?.name, services: items };
        });
        return { content: [{ type: 'json', json: out }] } as any;
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] } as any;
      }
    }
  );

  // Tool: reorder_shipping_services
  server.tool(
    'reorder_shipping_services',
    'INTERNATIONALのshippingServices順序を変更（指定サービスを先頭へ）',
    {
      service: z.string().describe('先頭に移動するサービスコード'),
      filter: z.string().optional().describe('ポリシー名の部分一致フィルタ'),
      policyId: z.string().optional().describe('フルフィルメントポリシーID'),
      dryRun: z.boolean().optional().default(true).describe('trueでプレビュー、falseで更新'),
    },
    async (args: any) => {
      try {
        const service = String(args?.service);
        const dryRun: boolean = typeof args?.dryRun === 'boolean' ? Boolean(args.dryRun) : true;
        const marketplaceId = process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
        let targets: any[] = [];
        if (args?.policyId) {
          const p = await getFulfillmentPolicy(undefined, String(args.policyId));
          targets = [p];
        } else {
          const all = await getFulfillmentPolicies(undefined, marketplaceId);
          const f = (args?.filter as string | undefined)?.toLowerCase() || '';
          targets = f ? all.filter((p: any) => String(p.name || '').toLowerCase().includes(f)) : all;
        }

        const limit = pLimit(5);
        let updated = 0;
        let skipped = 0;
        let failed = 0;
        const details: any[] = [];

        await Promise.all(
          targets.map((t: any) =>
            limit(async () => {
              try {
                const policy = await getFulfillmentPolicy(undefined, t.fulfillmentPolicyId);
                const intl = (policy?.shippingOptions || []).find((o: any) => o?.optionType === 'INTERNATIONAL');
                if (!intl) {
                  skipped++;
                  details.push({ id: t.fulfillmentPolicyId, name: t.name, reason: 'NO_INTERNATIONAL' });
                  return;
                }
                const services: any[] = Array.isArray(intl.shippingServices) ? intl.shippingServices : [];
                const idx = services.findIndex((s) => s?.shippingServiceCode === service);
                if (idx === -1) {
                  skipped++;
                  details.push({ id: t.fulfillmentPolicyId, name: t.name, reason: 'SERVICE_NOT_FOUND' });
                  return;
                }
                if (idx === 0) {
                  skipped++;
                  details.push({ id: t.fulfillmentPolicyId, name: t.name, reason: 'ALREADY_FIRST' });
                  return;
                }
                const [svc] = services.splice(idx, 1);
                services.unshift(svc);
                if (!dryRun) {
                  await updateFulfillmentPolicy(undefined, t.fulfillmentPolicyId, policy);
                }
                updated++;
                details.push({ id: t.fulfillmentPolicyId, name: t.name, status: dryRun ? 'WOULD_UPDATE' : 'UPDATED' });
              } catch (e: any) {
                failed++;
                details.push({ id: t.fulfillmentPolicyId, name: t.name, error: e?.message || String(e) });
              }
            })
          )
        );

        const json = { totalMatched: targets.length, updated, skipped, failed, dryRun, details };
        return { content: [{ type: 'json', json }] } as any;
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] } as any;
      }
    }
  );

  // Tool: add_shipping_service
  server.tool(
    'add_shipping_service',
    'INTERNATIONALにshippingServiceを追加',
    {
      service: z.string().describe('サービスコード'),
      cost: z.number().describe('配送料'),
      shipTo: z.string().describe('配送先（例: Europe）'),
      filter: z.string().optional().describe('ポリシー名の部分一致フィルタ'),
      policyId: z.string().optional().describe('フルフィルメントポリシーID'),
      additionalCost: z.number().optional().describe('追加アイテムのコスト'),
      dryRun: z.boolean().optional().default(true).describe('trueでプレビュー、falseで更新'),
    },
    async (args: any) => {
      try {
        const service = String(args?.service);
        const cost = Number(args?.cost);
        const shipTo = String(args?.shipTo);
        const additionalCost = args?.additionalCost !== undefined ? Number(args.additionalCost) : cost;
        const dryRun: boolean = typeof args?.dryRun === 'boolean' ? Boolean(args.dryRun) : true;
        const marketplaceId = process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';

        let targets: any[] = [];
        if (args?.policyId) {
          const p = await getFulfillmentPolicy(undefined, String(args.policyId));
          targets = [p];
        } else {
          const all = await getFulfillmentPolicies(undefined, marketplaceId);
          const f = (args?.filter as string | undefined)?.toLowerCase() || '';
          targets = f ? all.filter((p: any) => String(p.name || '').toLowerCase().includes(f)) : all;
        }

        const limit = pLimit(5);
        let updated = 0;
        let skipped = 0;
        let failed = 0;
        const details: any[] = [];

        await Promise.all(
          targets.map((t: any) =>
            limit(async () => {
              try {
                const policy = await getFulfillmentPolicy(undefined, t.fulfillmentPolicyId);
                const intl = (policy?.shippingOptions || []).find((o: any) => o?.optionType === 'INTERNATIONAL');
                if (!intl) {
                  skipped++;
                  details.push({ id: t.fulfillmentPolicyId, name: t.name, reason: 'NO_INTERNATIONAL' });
                  return;
                }
                const services: any[] = Array.isArray(intl.shippingServices) ? intl.shippingServices : (intl.shippingServices = []);
                if (services.find((s) => s?.shippingServiceCode === service)) {
                  skipped++;
                  details.push({ id: t.fulfillmentPolicyId, name: t.name, reason: 'ALREADY_EXISTS' });
                  return;
                }
                const currency = services.find((s) => s?.shippingCost?.currency)?.shippingCost?.currency || 'USD';
                const newSvc: any = {
                  shippingServiceCode: service,
                  freeShipping: Number(cost) === 0,
                  shippingCost: { value: Number(cost), currency },
                  additionalShippingCost: { value: Number(additionalCost), currency },
                  shipToLocations: { regionIncluded: [{ regionName: shipTo }] },
                };
                services.push(newSvc);
                if (!dryRun) {
                  await updateFulfillmentPolicy(undefined, t.fulfillmentPolicyId, policy);
                }
                updated++;
                details.push({ id: t.fulfillmentPolicyId, name: t.name, status: dryRun ? 'WOULD_UPDATE' : 'UPDATED' });
              } catch (e: any) {
                failed++;
                details.push({ id: t.fulfillmentPolicyId, name: t.name, error: e?.message || String(e) });
              }
            })
          )
        );

        const json = { totalMatched: targets.length, updated, skipped, failed, dryRun, details };
        return { content: [{ type: 'json', json }] } as any;
      } catch (e: any) {
        return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] } as any;
      }
    }
  );

  // Tool: remove_shipping_service
  server.tool(
    'remove_shipping_service',
    'INTERNATIONALからshippingServiceを削除',
    {
      service: z.string().describe('サービスコード'),
      filter: z.string().optional().describe('ポリシー名の部分一致フィルタ'),
      policyId: z.string().optional().describe('フルフィルメントポリシーID'),
      dryRun: z.boolean().optional().default(true).describe('trueでプレビュー、falseで更新'),
    },
    async (args: any) => {
      try {
        const service = String(args?.service);
        const dryRun: boolean = typeof args?.dryRun === 'boolean' ? Boolean(args.dryRun) : true;
        const marketplaceId = process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
        let targets: any[] = [];
        if (args?.policyId) {
          const p = await getFulfillmentPolicy(undefined, String(args.policyId));
          targets = [p];
        } else {
          const all = await getFulfillmentPolicies(undefined, marketplaceId);
          const f = (args?.filter as string | undefined)?.toLowerCase() || '';
          targets = f ? all.filter((p: any) => String(p.name || '').toLowerCase().includes(f)) : all;
        }

        const limit = pLimit(5);
        let updated = 0;
        let skipped = 0;
        let failed = 0;
        const details: any[] = [];

        await Promise.all(
          targets.map((t: any) =>
            limit(async () => {
              try {
                const policy = await getFulfillmentPolicy(undefined, t.fulfillmentPolicyId);
                const intl = (policy?.shippingOptions || []).find((o: any) => o?.optionType === 'INTERNATIONAL');
                if (!intl) {
                  skipped++;
                  details.push({ id: t.fulfillmentPolicyId, name: t.name, reason: 'NO_INTERNATIONAL' });
                  return;
                }
                const services: any[] = Array.isArray(intl.shippingServices) ? intl.shippingServices : [];
                const idx = services.findIndex((s) => s?.shippingServiceCode === service);
                if (idx === -1) {
                  skipped++;
                  details.push({ id: t.fulfillmentPolicyId, name: t.name, reason: 'NOT_FOUND' });
                  return;
                }
                if (!dryRun) {
                  services.splice(idx, 1);
                  await updateFulfillmentPolicy(undefined, t.fulfillmentPolicyId, policy);
                }
                updated++;
                details.push({ id: t.fulfillmentPolicyId, name: t.name, status: dryRun ? 'WOULD_UPDATE' : 'UPDATED' });
              } catch (e: any) {
                failed++;
                details.push({ id: t.fulfillmentPolicyId, name: t.name, error: e?.message || String(e) });
              }
            })
          )
        );

        const json = { totalMatched: targets.length, updated, skipped, failed, dryRun, details };
        return { content: [{ type: 'json', json }] } as any;
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
