"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const runtimePath = process.argv[2] || path.join(__dirname, "..", "桌宠运行包", "pet.js");
const source = fs.readFileSync(runtimePath, "utf8");
const timeline = source.match(/\bCLIPS\s*=\s*(\{[^\r\n]*\});/);
assert.ok(timeline, "runtime contains a timeline");
const clips = JSON.parse(timeline[1]);
const runtime = new vm.Script(source, { filename: runtimePath });
const seenClips = new Set();
const length = name => clips[name].ms.reduce((sum, duration) => sum + duration, 0);

async function flush() {
  for (let step = 0; step < 12; step += 1) await Promise.resolve();
}

function fixture({ saved = {}, preview = false } = {}) {
  let now = 0, timerId = 0;
  const timers = new Map(), draws = [];
  function setTimeoutFake(run, delay = 0) {
    const id = ++timerId;
    timers.set(id, { id, run, time: now + delay });
    return id;
  }
  let imageCount = 0;
  class FakeImage {
    constructor() { this.atlas = imageCount++ === 0 ? undefined : "reaction"; }
    set src(_url) { setTimeoutFake(() => this.onload?.(), 0); }
  }
  const window = { localStorage: { getItem: () => JSON.stringify(saved) } };
  const context = vm.createContext({
    window, Image: FakeImage, setTimeout: setTimeoutFake, clearTimeout: id => timers.delete(id),
    performance: { now: () => now }, matchMedia: () => ({ matches: false }),
    CustomEvent: class {}, document: { dispatchEvent() {} },
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
  }, { codeGeneration: { strings: false, wasm: false } });
  runtime.runInContext(context, { timeout: 5000 });
  const ctx = {
    clearRect() {},
    drawImage(image, sx, sy) {
      const { clip, frame } = window.KimiCompanion.getState();
      const actualTile = sx / 320 + 12 * sy / 320;
      assert.equal(actualTile, clips[clip].offset + frame, clip + " frame " + frame);
      assert.equal(image.atlas, clips[clip].atlas, clip + " draws from the correct atlas");
      seenClips.add(clip);
      draws.push(clip);
    },
    getImageData(x, y) { return { data: [0, 0, 0, x && y ? 255 : 0] }; },
  };
  const handle = window.DaimonPetThree.mount({
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 256, bottom: 256, width: 256, height: 256 }),
  }, { preview });

  async function advance(ms) {
    const end = now + ms;
    await flush();
    for (let count = 0; count < 10000; count += 1) {
      const next = [...timers.values()].sort((a, b) => a.time - b.time || a.id - b.id)[0];
      if (!next || next.time > end) {
        now = end;
        return;
      }
      now = next.time;
      timers.delete(next.id);
      next.run();
      await flush();
    }
    throw new Error("Virtual timer limit exceeded");
  }

  return { handle, pet: window.KimiCompanion, draws, advance };
}

async function previewTests() {
  const { handle, pet, advance } = fixture({ saved: { rotation: false } });
  await advance(0);
  assert.equal(pet.getState().clip, "blink");
  assert.equal(handle.hitTest(100, 100), true);
  assert.equal(handle.hitTest(0, 0), false);
  assert.equal(handle.hitTest(256, 100), false);
  for (const name of ["reading", "rock", "tea"]) {
    const scheduled = name === "tea" ? ["duo_tea"] : ["enter", "loop", "exit"].map(phase => name + "_" + phase);
    const run = pet.preview(name);
    await advance(scheduled.map(length).reduce((a, b) => a + b, 0));
    assert.equal(await run, true);
    assert.equal(pet.getState().clip, "blink");
    assert.equal(pet.getState().frame, 0);
  }
  const playPiano = pet.previewPiano();
  await advance(length("piano_enter") + length("piano_loop") + length("piano_finish"));
  assert.equal(await playPiano, true);
  assert.equal(pet.getState().clip, "blink");
  handle.dispose();
}

async function checkCoding(endEvent, outro) {
  const { handle, pet, advance, draws } = fixture();
  handle.setState("waiting"); // Host state can arrive before the atlas loads.
  await advance(0);
  assert.equal(pet.getState().clip, "piano_enter");
  await advance(length("piano_enter") + 200);
  assert.equal(pet.getState().clip, "piano_loop");
  handle.setState(endEvent);
  assert.equal(pet.getState().clip, "piano_loop", "finish at the phrase boundary");
  await advance(length("piano_loop") - 200);
  assert.equal(pet.getState().clip, outro);
  await advance(length(outro));
  assert.equal(pet.getState().clip, "blink");
  assert.equal(pet.getState().frame, 0);
  if (outro === "piano_exit") assert.ok(!draws.includes("piano_finish"));
  handle.dispose();
}

async function checkToggles() {
  const { handle, pet, draws, advance } = fixture({ saved: { animation: false, rotation: false } });
  handle.setState("working");
  await advance(91000);
  assert.deepEqual(draws, ["blink"]);
  assert.equal(await pet.preview("rock"), false);
  assert.equal(await pet.previewPiano(), false);
  pet.setEnabled(true);
  assert.equal(pet.getState().clip, "piano_enter", "restoring animations honours the current Coding state");
  await advance(200);
  pet.setEnabled(false);
  const drawsWhenDisabled = draws.length;
  handle.setState("idle");
  handle.setState("working");
  handle.setState("idle");
  await advance(91000);
  assert.equal(draws.length, drawsWhenDisabled);
  pet.setEnabled(true);
  const interrupted = pet.preview("tea");
  await advance(200);
  pet.setEnabled(false);
  assert.equal(await interrupted, false, "a cancelled preview resolves");
  pet.setEnabled(true);
  pet.setRotation(true);
  pet.setRotation(false);
  await advance(91000);
  assert.equal(pet.getState().clip, "blink", "turning off rotation cancels the pending timer");
  pet.setRotation(true);
  await advance(20000);
  handle.setState("idle");
  await advance(25000);
  assert.equal(pet.getState().clip, "reading_enter", "repeating idle messages do not defer the timer");
  await advance(length("reading_enter") + length("reading_loop") + length("reading_exit"));
  assert.equal(pet.getState().clip, "blink");
  await advance(45000);
  assert.equal(pet.getState().mode, "reading", "rotation is scheduled again when a scene ends");
  handle.dispose();
}

async function checkHandoff() {
  const { handle, pet, advance, draws } = fixture({ saved: { rotation: false } });
  await advance(0);
  const reading = pet.preview("reading");
  await advance(200);
  handle.setState("working");
  await advance(length("reading_enter") - 200);
  assert.equal(pet.getState().clip, "reading_exit");
  await advance(length("reading_exit"));
  assert.equal(await reading, true);
  assert.equal(pet.getState().clip, "piano_enter");
  assert.ok(!draws.includes("reading_loop"));
  await advance(length("piano_enter") + 100);
  handle.setState("idle");
  await advance(length("piano_loop") - 100);
  assert.equal(pet.getState().clip, "piano_finish");
  handle.setState("working");
  await advance(length("piano_finish"));
  assert.equal(pet.getState().clip, "piano_enter", "a new task starts after the previous outro");
  handle.dispose();
}

async function checkReactions() {
  const { handle, pet, advance, draws } = fixture({ saved: { rotation: false } });
  const state = () => pet.getState().clip;
  await advance(0);
  handle.noteTap();
  assert.equal(state(), "reaction_tap");
  await advance(45);
  handle.noteTap();
  await advance(45);
  handle.noteTap();
  await advance(length("reaction_tap") - 90);
  assert.equal(state(), "reaction_mad", "third tap takes priority over a queued second tap");
  await advance(length("reaction_mad"));
  assert.equal(state(), "blink");
  handle.noteTap();
  await advance(4500);
  handle.noteTap();
  await advance(501);
  handle.noteTap();
  await advance(1200);
  assert.equal(draws.filter(name => name === "reaction_mad").length, clips.reaction_mad.count,
    "taps older than five seconds do not count");
  handle.setHeld(true);
  assert.equal(state(), "grab_enter");
  await advance(72);
  handle.setHeld(false);
  assert.equal(state(), "grab_exit");
  assert.equal(pet.getState().frame, clips.grab_enter.count - 1 - 2);
  await advance(length("grab_exit"));
  assert.equal(state(), "blink");
  handle.setHeld(true);
  await advance(length("grab_enter") + length("grab_loop") + 100);
  assert.equal(state(), "grab_loop");
  handle.setState("working");
  assert.equal(state(), "grab_exit", "land before starting Coding");
  await advance(length("grab_exit"));
  assert.equal(state(), "piano_enter");
  handle.noteTap();
  handle.setHeld(true);
  assert.equal(state(), "piano_enter");
  handle.dispose();
}

async function main() {
  await previewTests();
  await checkCoding("idle", "piano_finish");
  await checkCoding("failed", "piano_exit");
  await checkCoding("cancelled", "piano_exit");
  await checkToggles();
  await checkHandoff();
  await checkReactions();
  assert.deepEqual([...seenClips].sort(), Object.keys(clips).sort());
  console.log("PASS: all 17 clips use their own atlas tiles");
  console.log("PASS: manual preview, saved settings, animation pause, rotation cancellation and rescheduling");
  console.log("PASS: coding entry, phrase-boundary finish, failure, cancellation, and back-to-back tasks");
  console.log("PASS: tap window, rapid third-tap priority, release while rising, swing, and Coding handoff");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
