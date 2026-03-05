import { FulfillmentPolicy } from '../types';
import { runWithRateLimit } from './rate-limiter';

const BASE_URL = 'https://api.ebay.com';

type FetchLike = (input: any, init?: any) => Promise<any>;

async function getFetch(): Promise<FetchLike> {
  if (typeof (global as any).fetch === 'function') return (global as any).fetch.bind(global);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('node-fetch');
  return mod.default || mod;
}

async function request(path: string, options: any, token: string) {
  const fetch = await getFetch();
  const url = `${BASE_URL}${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  return runWithRateLimit(async () => {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const retryAfter = res.headers?.get ? res.headers.get('Retry-After') : undefined;
      const err: any = new Error(`eBay API ${res.status} ${res.statusText}: ${text}`);
      (err.status = res.status), (err.retryAfter = retryAfter ? Number(retryAfter) : undefined);
      throw err;
    }
    const ct = res.headers?.get ? res.headers.get('content-type') : res.headers['content-type'];
    if (ct && String(ct).includes('application/json')) return res.json();
    return res.text();
  });
}

export async function getFulfillmentPolicies(token: string, marketplaceId: string): Promise<FulfillmentPolicy[]> {
  const q = encodeURIComponent(marketplaceId);
  const data = await request(`/sell/account/v1/fulfillment_policy?marketplace_id=${q}`, { method: 'GET' }, token);
  const arr = (data?.fulfillmentPolicies || data?.fulfillmentPolicy || data?.policies || []) as any[];
  return arr as FulfillmentPolicy[];
}

export async function getFulfillmentPolicy(token: string, policyId: string): Promise<FulfillmentPolicy> {
  const data = await request(`/sell/account/v1/fulfillment_policy/${encodeURIComponent(policyId)}`, { method: 'GET' }, token);
  return data as FulfillmentPolicy;
}

export async function updateFulfillmentPolicy(
  token: string,
  policyId: string,
  policyData: FulfillmentPolicy
): Promise<FulfillmentPolicy> {
  const data = await request(
    `/sell/account/v1/fulfillment_policy/${encodeURIComponent(policyId)}`,
    { method: 'PUT', body: JSON.stringify(policyData) },
    token
  );
  return data as FulfillmentPolicy;
}

