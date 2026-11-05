import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDeepseekBalance,
  parseAnthropicCosts,
  parseOpenAICosts,
  officialBilling,
} from '../dist/core/official-billing.js';

test('DeepSeek exposes currency-denominated balance (not a cost)', () => {
  assert.deepEqual(
    parseDeepseekBalance({
      balance_infos: [
        { currency: 'USD', total_balance: '12.50' },
        { currency: 'CNY', total_balance: '6.00' },
      ],
    }),
    [
      { currency: 'USD', totalBalance: 12.5 },
      { currency: 'CNY', totalBalance: 6 },
    ],
  );
});
test('Official cost parsers use correct USD versus cents units', () => {
  assert.equal(
    parseOpenAICosts({
      data: [{ results: [{ amount: { value: 0.42, currency: 'usd' } }] }],
    }),
    0.42,
  );
  assert.equal(
    parseAnthropicCosts({
      data: [{ cost: { amount: '42.000000', currency: 'USD' } }],
    }),
    0.42,
  );
});
test('Admin API absent never returns fabricated zero dollars', async () => {
  const old = process.env.OPENAI_ADMIN_KEY,
    old2 = process.env.OPENAI_ADMIN_API_KEY;
  delete process.env.OPENAI_ADMIN_KEY;
  delete process.env.OPENAI_ADMIN_API_KEY;
  try {
    const result = await officialBilling('openai');
    assert.equal(result.kind, 'unavailable');
    assert.equal(result.usd, undefined);
  } finally {
    if (old !== undefined) process.env.OPENAI_ADMIN_KEY = old;
    if (old2 !== undefined) process.env.OPENAI_ADMIN_API_KEY = old2;
  }
});

test('OpenAI official API cost uses daily organization totals, never a run price', async () => {
  const old = process.env.OPENAI_ADMIN_KEY;
  process.env.OPENAI_ADMIN_KEY = 'mock-key';
  try {
    const { officialBilling } = await import('../dist/core/official-billing.js');
    const report = await officialBilling('openai', 7, async (url) => {
      assert.match(url, /\/organization\/costs\?/);
      return {
        ok: true,
        json: async () => ({
          data: [{ results: [{ amount: { value: 2.44, currency: 'usd' } }] }],
          has_more: false,
        }),
      };
    });
    assert.equal(report.kind, 'organization_spend');
    assert.equal(report.usd, 2.44);
    assert.match(report.note, /not attributable/);
  } finally {
    if (old === undefined) delete process.env.OPENAI_ADMIN_KEY;
    else process.env.OPENAI_ADMIN_KEY = old;
  }
});

test('SQLite balance delta is marked as account-wide, never an invoice', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { Store } = await import('../dist/core/db.js');
  const { initWorkspace } = await import('../dist/core/paths.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'clipforge-balance-test-'));
  try {
    await initWorkspace(dir);
    const db = new Store(dir);
    try {
      db.startRun('run-123', 'deepseek', 0);
      db.saveBalanceSnapshot('run-123', 'deepseek', 'before', [
        { currency: 'USD', totalBalance: 10.0 },
      ]);
      db.saveBalanceSnapshot('run-123', 'deepseek', 'after', [
        { currency: 'USD', totalBalance: 9.5 },
      ]);
      assert.deepEqual(db.balanceChanges('run-123'), [
        {
          provider: 'deepseek',
          currency: 'USD',
          openingBalance: 10,
          closingBalance: 9.5,
          change: 0.5,
          scope: 'account-wide balance change; not a per-run invoice',
        },
      ]);
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
