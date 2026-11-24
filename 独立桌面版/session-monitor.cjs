const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHUNK_SIZE = 1024 * 1024;

async function directories(parent) {
  try {
    return (await fs.promises.readdir(parent, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(parent, entry.name));
  } catch {
    return [];
  }
}

async function readWireInfo(file) {
  try {
    const stat = await fs.promises.stat(file.filePath);
    if (stat.isFile()) return { ...file, mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {}
  return null;
}

async function findLatestWire(root) {
  let latest = null;
  for (const workspace of await directories(root)) {
    for (const session of await directories(workspace)) {
      const wire = await readWireInfo({
        filePath: path.join(session, 'agents', 'main', 'wire.jsonl'),
        workspace: path.basename(workspace),
        sessionId: path.basename(session),
        agent: 'main',
      });
      if (wire && (!latest || wire.mtimeMs > latest.mtimeMs)) latest = wire;
    }
  }
  return latest;
}

function recordTime(record) {
  const value = record.time ?? record.timestamp;
  if (Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function usageTokens(usage = {}) {
  const currentSchema = Number.isFinite(usage.inputOther) || Number.isFinite(usage.inputCacheRead) || Number.isFinite(usage.inputCacheCreation);
  const input = currentSchema
    ? (usage.inputOther || 0) + (usage.inputCacheRead || 0) + (usage.inputCacheCreation || 0)
    : (usage.input_tokens ?? usage.input ?? 0);
  return { input, output: usage.output ?? usage.output_tokens ?? 0 };
}

function createSessionMonitor(root = path.join(process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code'), 'sessions')) {
  let state = null;
  let queue = Promise.resolve();

  function reset(file) {
    state = {
      file,
      offset: 0,
      remainder: '',
      measuredContextTokens: null,
      usageContextTokens: null,
      turns: new Set(),
      completedSteps: new Set(),
      stepCount: 0,
      compactions: 0,
      speedSamples: [],
      cacheSamples: [],
      loadedSkills: new Set(),
      toolCallIds: new Set(),
      toolCallsByTurn: new Map(),
      activeTools: new Map(),
      totalToolCalls: 0,
      activeSteps: new Map(),
      requests: [],
      model: null,
      lastTime: null,
      coding: null,
    };
  }

  function addSpeed(output, duration) {
    if (!Number.isFinite(output) || output < 0 || !Number.isFinite(duration) || duration <= 0 || duration > 3600000) return;
    state.speedSamples.push({ output, duration });
    if (state.speedSamples.length > 5) state.speedSamples.shift();
  }

  function addCacheSample(usage = {}) {
    const hit = usage.inputCacheRead ?? usage.cache_read_input_tokens ?? 0;
    const creation = usage.inputCacheCreation ?? usage.cache_creation_input_tokens ?? 0;
    const uncached = usage.inputOther ?? usage.input_tokens ?? usage.input ?? 0;
    const total = hit + creation + uncached;
    if (!Number.isFinite(total) || total <= 0) return;
    state.cacheSamples.push({ hit, total });
    if (state.cacheSamples.length > 5) state.cacheSamples.shift();
  }

  function updateSkill(record) {
    if (record.type !== 'context.append_message') return;
    const content = record.message?.content;
    const parts = Array.isArray(content) ? content : [{ type: 'text', text: content }];
    for (const part of parts) {
      if (part?.type !== 'text' || typeof part.text !== 'string') continue;
      for (const match of part.text.matchAll(/<skill-loaded\s[^>]*\bname="([^"]+)"/g)) state.loadedSkills.add(match[1]);
    }
  }

  function updateTool(record) {
    if (record.type !== 'context.append_loop_event') return;
    const event = record.event;
    if (event?.type === 'tool.call') {
      const id = String(event.toolCallId ?? event.uuid ?? '');
      if (!id || state.toolCallIds.has(id)) return;
      state.toolCallIds.add(id);
      state.totalToolCalls += 1;
      if (event.turnId !== undefined && event.turnId !== null) {
        const turnId = String(event.turnId);
        state.toolCallsByTurn.set(turnId, (state.toolCallsByTurn.get(turnId) || 0) + 1);
      }
      state.activeTools.set(id, event.name || '未知工具');
    } else if (event?.type === 'tool.result') {
      state.activeTools.delete(String(event.toolCallId ?? event.parentUuid ?? ''));
    }
  }

  function updateCoding(record) {
    const event = record.type === 'context.append_loop_event' ? record.event : record;
    if (event?.turnId === undefined || event.turnId === null) return;
    const turnId = String(event.turnId);
    const sameTurn = state.coding?.turnId === turnId;
    switch (event.type) {
      case 'turn.prompt':
      case 'turn.started':
      case 'agent.turn.started':
      case 'step.begin':
        if (!sameTurn) state.coding = { turnId, status: 'working' };
        break;
      case 'turn.ended':
      case 'agent.turn.ended': {
        // A duplicate ending for an earlier turn must not end the next turn.
        if (state.coding && !sameTurn) return;
        const reason = event.reason ?? event.outcome;
        let status = 'failed';
        if (reason === 'completed' || reason === 'done') status = 'completed';
        if (['cancelled', 'canceled', 'user_cancelled', 'interrupted', 'aborted'].includes(reason)) status = 'cancelled';
        state.coding = { turnId, status };
        break;
      }
    }
  }

  function processRecord(record) {
    const time = recordTime(record);
    if (time !== null) state.lastTime = Math.max(state.lastTime ?? time, time);
    updateCoding(record);
    updateSkill(record);
    updateTool(record);
    if (record.type === 'token_counting.measured' && Number.isFinite(record.tokens)) {
      state.measuredContextTokens = record.tokens;
      return;
    }
    if (record.type === 'llm.request') {
      state.requests.push({ time, model: record.model });
      if (state.requests.length > 20) state.requests.shift();
      return;
    }
    if (record.type === 'usage.record') {
      const usage = usageTokens(record.usage);
      if (Number.isFinite(usage.input) && Number.isFinite(usage.output)) state.usageContextTokens = usage.input + usage.output;
      if (record.usageScope === 'session') {
        state.compactions += 1;
        return;
      }
      addCacheSample(record.usage);
      const request = state.requests.length ? state.requests.pop() : null;
      state.requests.length = 0;
      if (request?.model) state.model = request.model;
      const activeSteps = [...state.activeSteps.values()];
      const step = activeSteps[activeSteps.length - 1];
      const start = request?.time ?? step?.time;
      if (start !== null && start !== undefined && time !== null) addSpeed(usage.output, time - start);
      if (step) step.speedAdded = true;
      return;
    }
    if (record.type !== 'context.append_loop_event') return;
    const event = record.event;
    if (event?.type === 'step.begin') {
      state.activeSteps.set(event.uuid, { time, speedAdded: false });
      return;
    }
    if (event?.type !== 'step.end' || state.completedSteps.has(event.uuid)) return;
    state.completedSteps.add(event.uuid);
    state.stepCount += 1;
    if (event.turnId !== undefined && event.turnId !== null) state.turns.add(String(event.turnId));
    const step = state.activeSteps.get(event.uuid);
    if (step && !step.speedAdded) {
      const usage = usageTokens(event.usage);
      const streamDuration = Number.isFinite(event.llmStreamDurationMs)
        ? (event.llmFirstTokenLatencyMs || 0) + event.llmStreamDurationMs
        : time - step.time;
      addSpeed(usage.output, streamDuration);
    }
    state.activeSteps.delete(event.uuid);
  }

  function consume(text) {
    const lines = (state.remainder + text).split(/\r?\n/);
    state.remainder = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      try { processRecord(JSON.parse(line)); } catch {}
    }
    if (state.remainder) {
      try {
        processRecord(JSON.parse(state.remainder));
        state.remainder = '';
      } catch {}
    }
  }

  async function readAppended(size) {
    if (size < state.offset) reset(state.file);
    if (size === state.offset) return;
    const handle = await fs.promises.open(state.file.filePath, 'r');
    const decoder = new TextDecoder();
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK_SIZE, size - state.offset));
    try {
      while (state.offset < size) {
        const length = Math.min(buffer.length, size - state.offset);
        const { bytesRead } = await handle.read(buffer, 0, length, state.offset);
        if (!bytesRead) break;
        state.offset += bytesRead;
        consume(decoder.decode(buffer.subarray(0, bytesRead), { stream: true }));
      }
      consume(decoder.decode());
    } finally {
      await handle.close();
    }
  }

  function result() {
    const output = state.speedSamples.reduce((sum, sample) => sum + sample.output, 0);
    const duration = state.speedSamples.reduce((sum, sample) => sum + sample.duration, 0);
    const cacheHits = state.cacheSamples.reduce((sum, sample) => sum + sample.hit, 0);
    const cacheInput = state.cacheSamples.reduce((sum, sample) => sum + sample.total, 0);
    const currentTurnId = state.coding?.turnId;
    return {
      ok: true,
      contextTokens: state.measuredContextTokens ?? state.usageContextTokens,
      turns: state.turns.size,
      steps: state.stepCount,
      compactions: state.compactions,
      tokensPerSecond: duration > 0 ? output / (duration / 1000) : null,
      speedSamples: state.speedSamples.length,
      cacheHitPercent: cacheInput > 0 ? cacheHits / cacheInput * 100 : null,
      cacheSamples: state.cacheSamples.length,
      cacheHitTokens: cacheHits,
      cacheInputTokens: cacheInput,
      loadedSkills: [...state.loadedSkills],
      turnToolCalls: currentTurnId === undefined ? 0 : state.toolCallsByTurn.get(currentTurnId) || 0,
      totalToolCalls: state.totalToolCalls,
      activeTools: [...new Set(state.activeTools.values())],
      model: state.model,
      coding: state.coding,
      session: {
        workspace: state.file.workspace,
        id: state.file.sessionId,
        agent: state.file.agent,
      },
      asOf: state.lastTime === null ? null : new Date(state.lastTime).toISOString(),
    };
  }

  async function update() {
    // Follow a running main turn until its outcome, even if another session
    // or a subagent writes to its own log in the meantime.
    const running = state?.coding?.status === 'working' ? await readWireInfo(state.file) : null;
    const latest = running ?? await findLatestWire(root);
    if (!latest) {
      state = null;
      return { ok: false, message: '未发现 Kimi Code 会话日志' };
    }
    if (!state || state.file.filePath !== latest.filePath) reset(latest);
    state.file = latest;
    await readAppended(latest.size);
    return result();
  }

  return () => {
    const pending = queue.then(update, update);
    queue = pending.catch(() => {});
    return pending;
  };
}

module.exports = { createSessionMonitor };
