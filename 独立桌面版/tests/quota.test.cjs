const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { readQuota } = require('../quota.cjs');

async function fixture(t, rows = []) {
  const home = await mkdtemp(path.join(tmpdir(), 'kimi-pet-quota-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const registry = path.join(home, 'server', 'instances');
  await mkdir(registry, { recursive: true });
  await writeFile(path.join(home, 'server.token'), 'fixture-local-token\n');
  for (const [i, row] of rows.entries()) {
    await writeFile(path.join(registry, `${i}.json`), JSON.stringify(row));
  }
  return { KIMI_CODE_HOME: home };
}

function desktop(changes = {}) {
  return { server_id: 'example', host: '127.0.0.1', port: 58627,
    product: 'kimi-code-desktop', ...changes };
}

test('reads only available quota windows from an authenticated local desktop', async t => {
  const env = await fixture(t, [desktop(), desktop({ host: 'example.invalid', port: 2 })]);
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer fixture-local-token');
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/meta')) return Response.json({ code: 0, data: { server_id: 'example' } });
    return Response.json({ code: 0, data: { kind: 'ok', quota: { usages: {
      limit5h: { usedRatio: 0.25, resetAt: '2026-11-24T00:00:00Z' },
      monthCode: { usedRatio: 1 },
    } } } });
  };
  const result = await readQuota({ env, fetcher });
  assert.equal(result.source, 'kimi-code');
  assert.deepEqual(result.windows, {
    limit_5h: { remainingPercent: 75, resetTime: '2026-11-24T00:00:00Z' },
    limit_month_code: { remainingPercent: 0 },
  });
  assert.deepEqual(calls, ['http://127.0.0.1:58627/api/v1/meta', 'http://127.0.0.1:58627/api/v1/oauth/usage']);
  assert.ok(!JSON.stringify(result).includes('fixture-local-token'));
});

test('falls back to the official API and displays a weekly window when returned', async t => {
  const env = { ...await fixture(t, [desktop()]), KIMI_CODE_API_KEY: 'fixture-api-key' };
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    if (url.endsWith('/meta')) return Response.json({ code: 0, data: { server_id: 'different-instance' } });
    assert.equal(url, 'https://api.kimi.com/coding/v1/usages');
    assert.equal(options.headers.Authorization, 'Bearer fixture-api-key');
    return Response.json({ usages: { limit_7d: { used_ratio: 0.5 } } });
  };
  const result = await readQuota({ env, fetcher });
  assert.equal(result.source, 'api-key');
  assert.deepEqual(result.windows, { limit_7d: { remainingPercent: 50 } });
  assert.deepEqual(calls, ['http://127.0.0.1:58627/api/v1/meta', 'https://api.kimi.com/coding/v1/usages']);
});

test('demo and disconnected states work without credentials or network requests', async t => {
  const env = await fixture(t, [desktop({ host: '192.0.2.1' })]);
  const fetcher = () => assert.fail('unexpected quota request');
  assert.equal((await readQuota({ env, fetcher })).ok, false);
  assert.equal((await readQuota({ env: { ...env, KIMI_PET_DEMO: '1' }, fetcher })).source, 'demo');
});
