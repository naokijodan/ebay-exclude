// OAuth token refresh and caching for eBay APIs

const TOKEN_URL = {
  sandbox: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
  production: 'https://api.ebay.com/identity/v1/oauth2/token',
};

let cachedToken: { token: string; expiresAt: number } | null = null;
let refreshing: Promise<string> | null = null;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // 5 minutes buffer

  // 1. Return cached token if still valid (with buffer)
  if (cachedToken && now + bufferMs < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  // 2. Backward compatibility: EBAY_TOKEN provided directly
  if (process.env.EBAY_TOKEN) {
    return process.env.EBAY_TOKEN;
  }

  // 3. Refresh via client credentials + refresh token
  if (process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET && process.env.EBAY_REFRESH_TOKEN) {
    if (!refreshing) {
      refreshing = (async () => {
        const { accessToken, expiresIn } = await refreshToken();
        cachedToken = {
          token: accessToken,
          expiresAt: Date.now() + (expiresIn || 7200) * 1000,
        };
        return accessToken;
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  // 4. No credentials available
  throw new Error(
    'Missing credentials. Set EBAY_TOKEN, or EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN.'
  );
}

async function refreshToken(): Promise<{ accessToken: string; expiresIn: number }> {
  const env = process.env.EBAY_ENV || 'sandbox';
  const url = (TOKEN_URL as any)[env] || TOKEN_URL.sandbox;
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const refreshToken = process.env.EBAY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN are required to refresh token');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'https://api.ebay.com/oauth/api_scope/sell.account',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data: any = await res.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 7200,
  };
}
