"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSessionMonitor } = require("../session-monitor.cjs");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-pet-monitor-"));
const jsonl = records => records.map(record => JSON.stringify(record)).join("\n") + "\n";
const wirePath = (root, session = "session_test", agent = "main") => {
  const directory = path.join(root, "workspace", session, "agents", agent);
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, "wire.jsonl");
};

async function checkCodingLifecycle() {
  const root = path.join(temp, "coding");
  const first = wirePath(root);
  const second = wirePath(root, "session_other");
  const subagent = wirePath(root, "side", "agent-0");
  const monitor = createSessionMonitor(root);
  const append = (file, ...records) => fs.appendFileSync(file, jsonl(records));
  const start = turnId => ({ type: "turn.prompt", turnId, time: Date.now() });
  const end = (turnId, reason) => ({ type: "turn.ended", turnId, reason, time: Date.now() });

  append(first, start(1), end(1, "completed"), start(2));
  append(subagent, start(10));
  let result = await monitor();
  assert.equal(result.session.agent, "main");
  assert.deepEqual(result.coding, { turnId: "2", status: "working" });

  append(second, start(23));
  append(first, end(1, "completed"));
  result = await monitor();
  assert.equal(result.session.id, "session_test");
  assert.deepEqual(result.coding, { turnId: "2", status: "working" });

  append(first, end(2, "completed"));
  assert.deepEqual((await monitor()).coding, { turnId: "2", status: "completed" });
  append(first, start(3), end(3, "error"));
  assert.deepEqual((await monitor()).coding, { turnId: "3", status: "failed" });
  append(first, start(4), end(4, "cancelled"));
  assert.deepEqual((await monitor()).coding, { turnId: "4", status: "cancelled" });
}

async function main() {
  const root = path.join(temp, "current");
  const file = wirePath(root);
  const monitor = createSessionMonitor(root);
  const base = 1700000000000;
  fs.writeFileSync(file, jsonl([
    { type: "context.append_loop_event", event: { type: "step.begin", uuid: "step-1", turnId: "0", step: 1 }, time: base },
    { type: "usage.record", model: "alias", usage: { inputOther: 100, output: 50, inputCacheRead: 900, inputCacheCreation: 0 }, usageScope: "turn", time: base + 3000 },
    { type: "token_counting.measured", tokens: 1050, time: base + 3001 },
    { type: "context.append_loop_event", event: { type: "step.end", uuid: "step-1", turnId: "0", step: 1, usage: { inputOther: 100, output: 50, inputCacheRead: 900 } }, time: base + 3002 },
  ]));

  let result = await monitor();
  assert.equal(result.ok, true);
  assert.equal(result.contextTokens, 1050);
  assert.equal(result.turns, 1);
  assert.equal(result.steps, 1);
  assert.equal(result.compactions, 0);
  assert.ok(Math.abs(result.tokensPerSecond - 50 / 3) < 1e-9);
  assert.equal(result.speedSamples, 1);
  assert.equal(result.cacheHitPercent, 90);
  assert.equal(result.cacheSamples, 1);
  assert.deepEqual(result.loadedSkills, []);
  assert.equal(result.turnToolCalls, 0);
  assert.equal(result.totalToolCalls, 0);
  assert.deepEqual(result.activeTools, []);
  assert.equal(result.session.id, "session_test");

  fs.appendFileSync(file, jsonl([
    { type: "context.append_loop_event", event: { type: "step.begin", uuid: "step-2", turnId: "1", step: 1 }, time: base + 10000 },
    { type: "usage.record", usage: { inputOther: 200, output: 100, inputCacheRead: 1000 }, usageScope: "turn", time: base + 15000 },
    { type: "token_counting.measured", tokens: 1350, time: base + 15001 },
    { type: "context.append_loop_event", event: { type: "step.end", uuid: "step-2", turnId: "1", step: 1 }, time: base + 15002 },
    { type: "context.append_loop_event", event: { type: "tool.call", uuid: "tool-1", toolCallId: "call-1", turnId: "1", name: "Grep" }, time: base + 15003 },
    { type: "context.append_message", message: { role: "user", content: [{ type: "text", text: "<skill-loaded name=\"check-kimi-code-docs\">instructions</skill-loaded>" }] }, time: base + 15004 },
    { type: "usage.record", usage: { inputOther: 500, output: 20 }, usageScope: "session", time: base + 16000 },
  ]));
  result = await monitor();
  assert.equal(result.contextTokens, 1350);
  assert.equal(result.turns, 2);
  assert.equal(result.steps, 2);
  assert.equal(result.compactions, 1);
  assert.equal(result.tokensPerSecond, 150 / 8);
  assert.equal(result.speedSamples, 2);
  assert.ok(Math.abs(result.cacheHitPercent - 1900 / 2200 * 100) < 1e-9);
  assert.equal(result.cacheSamples, 2);
  assert.deepEqual(result.loadedSkills, ["check-kimi-code-docs"]);
  assert.equal(result.turnToolCalls, 1);
  assert.equal(result.totalToolCalls, 1);
  assert.deepEqual(result.activeTools, ["Grep"]);

  fs.appendFileSync(file, jsonl([
    { type: "context.append_loop_event", event: { type: "tool.result", parentUuid: "tool-1", toolCallId: "call-1", result: { output: "done" } }, time: base + 17000 },
    { type: "context.append_loop_event", event: { type: "tool.call", uuid: "tool-2", toolCallId: "call-2", turnId: "1", name: "Read" }, time: base + 17001 },
    { type: "context.append_loop_event", event: { type: "tool.result", parentUuid: "tool-2", toolCallId: "call-2", result: { output: "done" } }, time: base + 17002 },
    { type: "context.append_message", message: { role: "user", content: [{ type: "text", text: "<skill-loaded name=\"check-kimi-code-docs\">instructions</skill-loaded>" }] }, time: base + 17003 },
  ]));
  result = await monitor();
  assert.equal(result.turnToolCalls, 2);
  assert.equal(result.totalToolCalls, 2);
  assert.deepEqual(result.activeTools, []);
  assert.deepEqual(result.loadedSkills, ["check-kimi-code-docs"]);

  fs.writeFileSync(file, jsonl([{ type: "token_counting.measured", tokens: 50, time: base + 20000 }]));
  result = await monitor();
  assert.equal(result.contextTokens, 50);
  assert.equal(result.turns, 0);
  assert.equal(result.steps, 0);
  assert.equal(result.compactions, 0);
  assert.equal(result.tokensPerSecond, null);
  assert.equal(result.cacheHitPercent, null);
  assert.deepEqual(result.loadedSkills, []);
  assert.equal(result.totalToolCalls, 0);
  assert.deepEqual(result.activeTools, []);

  const legacyRoot = path.join(temp, "legacy");
  fs.writeFileSync(wirePath(legacyRoot), jsonl([
    { type: "llm.request", model: "actual-model", timestamp: base / 1000 },
    { type: "usage.record", usage: { input_tokens: 1000, output_tokens: 40 }, usageScope: "turn", timestamp: (base + 2000) / 1000 },
  ]));
  result = await createSessionMonitor(legacyRoot)();
  assert.equal(result.contextTokens, 1040);
  assert.equal(result.tokensPerSecond, 20);
  assert.equal(result.model, "actual-model");

  result = await createSessionMonitor(path.join(temp, "empty"))();
  assert.equal(result.ok, false);
  await checkCodingLifecycle();
  console.log("PASS: current wire schema, current context measurement and turn/step counting");
  console.log("PASS: incremental reads, truncation reset, compaction counting and five-sample speed data");
  console.log("PASS: legacy token fields, request timestamps, actual model IDs and missing logs");
  console.log("PASS: active main turn, session pinning, duplicate prior terminal event, and three outcomes");
  console.log("PASS: cache hit rate, loaded skill deduplication, turn/total tools and active tool completion");
}

main().finally(() => fs.rmSync(temp, { recursive: true, force: true })).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
