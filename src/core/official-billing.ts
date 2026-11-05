/** Provider data is intentionally kept separate from local API-equivalent pricing estimates.
 * No API here returns an invoice for a particular Clipforge run on a consumer subscription.
 */
export type ProviderBalance = { currency: string; totalBalance: number };
export type OfficialBilling = {
  provider: 'openai' | 'anthropic' | 'deepseek';
  kind: 'organization_spend' | 'account_balance' | 'unavailable';
  usd?: number;
  balances?: ProviderBalance[];
  periodStart?: string;
  periodEnd?: string;
  note: string;
};
const request = async (
  url: string,
  headers: Record<string, string>,
  fetcher: typeof fetch = fetch,
) => {
  const response = await fetcher(url, {
    headers,
    signal: AbortSignal.timeout(14000),
  });
  if (!response.ok) throw new Error(`Official billing API HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
};

export function parseDeepseekBalance(raw: unknown): ProviderBalance[] {
  if (!raw || typeof raw !== 'object') return [];
  const infos = (raw as { balance_infos?: unknown }).balance_infos;
  if (!Array.isArray(infos)) return [];
  return infos.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const o = item as Record<string, unknown>,
      value = Number(o.total_balance);
    if (
      typeof o.currency !== 'string' ||
      !['USD', 'CNY'].includes(o.currency) ||
      !Number.isFinite(value) ||
      value < 0
    )
      return [];
    return [{ currency: o.currency, totalBalance: value }];
  });
}
export async function deepseekBalance(fetcher: typeof fetch = fetch): Promise<ProviderBalance[]> {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw new Error('DEEPSEEK_API_KEY not set');
  const raw = await request(
    'https://api.deepseek.com/user/balance',
    { Authorization: `Bearer ${key}` },
    fetcher,
  );
  const result = parseDeepseekBalance(raw);
  if (!result.length) throw new Error('DeepSeek did not provide a recognizable currency balance');
  return result;
}

export function parseOpenAICosts(raw: unknown): number {
  const o = raw as {
    data?: Array<{
      results?: Array<{ amount?: { value?: number; currency?: string } }>;
    }>;
  };
  if (!Array.isArray(o?.data)) throw new Error('Unexpected OpenAI costs response');
  return o.data
    .flatMap((x) => x.results ?? [])
    .reduce(
      (sum, result) =>
        sum +
        (result.amount?.currency === 'usd' && Number.isFinite(result.amount?.value)
          ? Number(result.amount?.value)
          : 0),
      0,
    );
}
export function parseAnthropicCosts(raw: unknown): number {
  const o = raw as {
    data?: Array<{ cost?: { amount?: string; currency?: string } }>;
  };
  if (!Array.isArray(o?.data)) throw new Error('Unexpected Anthropic costs response');
  // Anthropic documents `cost.amount` in cents, not USD.
  return o.data.reduce(
    (sum, item) =>
      sum +
      (item.cost?.currency === 'USD' && Number.isFinite(Number(item.cost.amount))
        ? Number(item.cost.amount) / 100
        : 0),
    0,
  );
}
export async function officialBilling(
  provider: 'openai' | 'anthropic' | 'deepseek',
  days = 7,
  fetcher: typeof fetch = fetch,
): Promise<OfficialBilling> {
  if (!Number.isSafeInteger(days) || days < 1 || days > 30) throw new Error('days must be 1-30');
  if (provider === 'deepseek') {
    if (!process.env.DEEPSEEK_API_KEY)
      return {
        provider,
        kind: 'unavailable',
        note: 'Set DEEPSEEK_API_KEY to read account balance.',
      };
    const balances = await deepseekBalance(fetcher);
    return {
      provider,
      kind: 'account_balance',
      balances,
      note: 'Live provider account balance, not Clipforge run cost. Different users, jobs and top-ups can change this number.',
    };
  }
  if (provider === 'openai' && !process.env.OPENAI_ADMIN_KEY && !process.env.OPENAI_ADMIN_API_KEY)
    return {
      provider,
      kind: 'unavailable',
      note: 'OPENAI_ADMIN_KEY required for organization billing. A ChatGPT Plus sign-in does not provide API billing data.',
    };
  if (provider === 'anthropic' && !process.env.ANTHROPIC_ADMIN_KEY)
    return {
      provider,
      kind: 'unavailable',
      note: 'ANTHROPIC_ADMIN_KEY required for the organization analytics endpoint. Claude Code subscriptions may not appear in this API.',
    };
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  if (provider === 'openai') {
    const params = new URLSearchParams({
      start_time: String(Math.floor(start.getTime() / 1000)),
      end_time: String(Math.floor(end.getTime() / 1000)),
      limit: String(days),
      bucket_width: '1d',
    });
    const raw = await request(
      `https://api.openai.com/v1/organization/costs?${params}`,
      {
        Authorization: `Bearer ${process.env.OPENAI_ADMIN_KEY || process.env.OPENAI_ADMIN_API_KEY}`,
      },
      fetcher,
    );
    if (raw.has_more)
      throw new Error('Billing report has more pages; refusing to show a partial amount');
    return {
      provider,
      kind: 'organization_spend',
      usd: parseOpenAICosts(raw),
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      note: 'Provider-reported organization API spending for whole days; not attributable to this Clipforge run or to ChatGPT Plus.',
    };
  }
  const params = new URLSearchParams({
    starting_at: start.toISOString(),
    ending_at: end.toISOString(),
    limit: '100',
  });
  const raw = await request(
    `https://api.anthropic.com/v1/organizations/analytics/cost?${params}`,
    {
      'x-api-key': process.env.ANTHROPIC_ADMIN_KEY!,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'analytics-usage-cost-2026-08-24',
    },
    fetcher,
  );
  if (raw.has_more)
    throw new Error('Billing report has more pages; refusing to show a partial amount');
  return {
    provider,
    kind: 'organization_spend',
    usd: parseAnthropicCosts(raw),
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    note: 'Provider-reported organization spending, not necessarily related to this Clipforge run or Claude Code subscription.',
  };
}
