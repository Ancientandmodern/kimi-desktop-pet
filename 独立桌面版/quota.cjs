const { readFile, readdir } = require('node:fs/promises');
const { homedir } = require('node:os');
const path = require('node:path');

const OFFICIAL_USAGE = 'https://api.kimi.com/coding/v1/usages';
const QUOTA_WINDOWS = {
  limit_5h: 'limit5h',
  limit_7d: 'limit7d',
  limit_month_total: 'monthTotal',
  limit_month_code: 'monthCode',
};
const LOOPBACK = { '127.0.0.1': '127.0.0.1', localhost: '127.0.0.1', '::1': '[::1]' };

const failure = message => ({ ok: false, message });
const result = (source, windows) => ({ ok: true, source, windows, asOf: new Date().toISOString() });

function normalize(usage, local) {
  const windows = {};
  for (const [key, localKey] of Object.entries(QUOTA_WINDOWS)) {
    const item = usage?.[local ? localKey : key];
    const ratio = local ? item?.usedRatio : item?.used_ratio;
    if (!Number.isFinite(ratio)) continue;
    const reset = local ? item.resetAt : item.reset_time;
    windows[key] = { remainingPercent: Math.min(100, Math.max(0, (1 - ratio) * 100)) };
    if (typeof reset === 'string' && Number.isFinite(Date.parse(reset))) windows[key].resetTime = reset;
  }
  return windows;
}

async function registeredInstances(home) {
  const directory = path.join(home, 'server', 'instances');
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const instances = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const row = JSON.parse(await readFile(path.join(directory, entry.name), 'utf8'));
      if (!Object.hasOwn(LOOPBACK, row.host) || !Number.isInteger(row.port) ||
          row.port < 1 || row.port > 65535 || typeof row.server_id !== 'string' || !row.server_id) continue;
      instances.push(row);
    } catch {
      // An instance may be removed while Kimi Code is closing.
    }
  }
  return instances.sort((a, b) =>
    Number(b.product === 'kimi-code-desktop') - Number(a.product === 'kimi-code-desktop'));
}

async function getJson(fetcher, url, token, timeoutMs) {
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: response.ok ? await response.json() : null };
}

async function readLocalQuota(home, fetcher) {
  const instances = await registeredInstances(home);
  if (!instances.length) return failure('请打开已登录的 Kimi Code，或配置 Coding API Key');

  const token = (await readFile(path.join(home, 'server.token'), 'utf8').catch(() => '')).trim();
  if (!token) return failure('找不到 Kimi Code 本地服务凭据，可配置 Coding API Key');

  let message = 'Kimi Code 本地额度服务暂不可用';
  for (const instance of instances) {
    const origin = `http://${LOOPBACK[instance.host]}:${instance.port}`;
    try {
      const meta = await getJson(fetcher, origin + '/api/v1/meta', token, 2000);
      if (meta.status === 401) message = 'Kimi Code 本地服务认证失败';
      if (meta.body?.code !== 0 || meta.body?.data?.server_id !== instance.server_id) continue;

      const { body } = await getJson(fetcher, origin + '/api/v1/oauth/usage', token, 10000);
      if (body?.code !== 0 || body?.data?.kind !== 'ok') {
        const status = body?.data?.status;
        message = status === 401 || status === 403
          ? 'Kimi Code 账号未授权读取额度，请检查登录'
          : 'Kimi Code 暂时无法读取额度';
        continue;
      }
      const windows = normalize(body.data.quota?.usages, true);
      if (Object.keys(windows).length) return result('kimi-code', windows);
      message = 'Kimi Code 未返回可显示的额度';
    } catch {
      // Try another registered loopback instance or the configured API Key.
    }
  }
  return failure(message);
}

async function readQuota({ env = process.env, fetcher = fetch } = {}) {
  if (env.KIMI_PET_DEMO === '1') {
    return result('demo', {
      limit_5h: { remainingPercent: 100 },
      limit_month_total: { remainingPercent: 78.2 },
      limit_month_code: { remainingPercent: 100 },
    });
  }

  const local = await readLocalQuota(env.KIMI_CODE_HOME || path.join(homedir(), '.kimi-code'), fetcher);
  if (local.ok) return local;

  const key = env.KIMI_API_KEY?.trim() || env.KIMI_CODE_API_KEY?.trim();
  if (!key) return local;
  try {
    const { status, body } = await getJson(fetcher, OFFICIAL_USAGE, key, 10000);
    if (status !== 200) return failure(`额度接口返回 ${status}`);
    const windows = normalize(body?.usages, false);
    return Object.keys(windows).length ? result('api-key', windows) : failure('额度接口未返回可显示的额度');
  } catch {
    return failure('额度暂时读取失败');
  }
}

module.exports = { readQuota };
