"use strict";

(() => {
  const SIZE = 320;
  const COLS = 12;
  const ATLAS = __ATLAS__;
  const REACTION_ATLAS = __REACTION_ATLAS__;
  const CLIPS = __CLIPS__;
  const SETTINGS_KEY = "kimi-work-companion.settings.v1";
  const IDLE_SCENES = ["reading", "rock", "tea"];

  function preferences() {
    try {
      const saved = JSON.parse(window.localStorage?.getItem(SETTINGS_KEY) || "{}");
      return { animation: saved?.animation !== false, rotation: saved?.rotation !== false };
    } catch {
      return { animation: true, rotation: true };
    }
  }

  window.DaimonPetThree = {
    mount(canvas, options = {}) {
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d", { alpha: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const image = new Image();
      const reactionImage = new Image();
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      const saved = preferences();

      let ready = false, disposed = false, dragging = false;
      let enabled = saved.animation, rotation = saved.rotation;
      let mode = "loading", clip = "blink", index = 0, hostState = "idle";
      let realCoding = false, ending = null;
      let generation = 0, cancelWait = null, rotationTimer = null;
      let reactionReady = false, held = false, pendingTap = null;
      let taps = [];

      function getState() {
        return { mode, clip, frame: index, ready, enabled, hostState };
      }

      function bounds() {
        const r = canvas.getBoundingClientRect();
        return {
          x: r.left + r.width * .14, y: r.top + r.height * .06,
          width: r.width * .72, height: r.height * .9,
        };
      }

      function draw() {
        ctx.clearRect(0, 0, SIZE, SIZE);
        if (ready) {
          const sequence = CLIPS[clip];
          const tile = sequence.offset + index;
          const atlas = sequence.atlas === "reaction" ? reactionImage : image;
          ctx.drawImage(atlas, (tile % COLS) * SIZE, Math.floor(tile / COLS) * SIZE,
            SIZE, SIZE, 0, 0, SIZE, SIZE);
        }
        document.dispatchEvent(new CustomEvent("kimi-companion:state", { detail: getState() }));
      }

      function cancelRotation() {
        if (rotationTimer !== null) clearTimeout(rotationTimer);
        rotationTimer = null;
      }

      function startToken() {
        generation += 1;
        // Resolve the previous wait as well as clearing its timer so any
        // caller awaiting an interrupted preview can finish.
        cancelWait?.();
        cancelRotation();
        return generation;
      }

      function active(token) {
        return token === generation && ready && enabled && !disposed;
      }

      function waitForFrame(ms, token) {
        return new Promise(resolve => {
          const timer = setTimeout(() => {
            cancelWait = null;
            resolve(active(token));
          }, ms);
          cancelWait = () => {
            clearTimeout(timer);
            cancelWait = null;
            resolve(false);
          };
        });
      }

      async function play(name, token, loop = false, start = 0) {
        if (!active(token)) return false;
        const sequence = CLIPS[name];
        clip = name;
        do {
          for (index = start; index < sequence.count; index += 1) {
            draw();
            if (!active(token)) return false;
            const ms = reducedMotion.matches && !sequence.atlas
              ? Math.max(400, sequence.ms[index]) : sequence.ms[index];
            if (!await waitForFrame(ms, token)) return false;
          }
        } while (loop);
        return true;
      }

      function canPreview() {
        return ready && enabled && !disposed && !dragging && !held &&
          hostState !== "working" && mode === "idle";
      }

      function scheduleRotation() {
        if (!rotation || options.preview || rotationTimer !== null || !canPreview()) return;
        const token = generation;
        rotationTimer = setTimeout(() => {
          rotationTimer = null;
          if (rotation && active(token) && canPreview()) {
            void preview(IDLE_SCENES[Math.floor(Math.random() * IDLE_SCENES.length)]);
          }
        }, 45000 + Math.random() * 45000);
      }

      function enterIdle() {
        const token = startToken();
        mode = "idle";
        clip = "blink";
        index = 0;
        realCoding = false;
        ending = null;
        if (!active(token)) {
          if (ready) draw();
          return;
        }
        scheduleRotation();
        void play("blink", token, true);
      }

      function resumeHost() {
        if (disposed || !ready) return;
        if (enabled && hostState === "working") void work();
        else enterIdle();
      }

      async function work(alreadySeated = false) {
        const token = startToken();
        mode = "working";
        realCoding = true;
        ending = null;
        if (!alreadySeated && !await play("piano_enter", token)) return;
        while (active(token) && ending === null) {
          if (!await play("piano_loop", token)) return;
        }
        if (!active(token)) return;
        mode = "finishing";
        if (await play(ending, token) && active(token)) resumeHost();
      }

      async function preview(name) {
        if (!canPreview() || !IDLE_SCENES.includes(name)) return false;
        const token = startToken();
        mode = name;
        if (name === "tea") {
          if (!await play("duo_tea", token)) return false;
        } else {
          if (!await play(name + "_enter", token)) return false;
          if (hostState !== "working" && !await play(name + "_loop", token)) return false;
          if (!await play(name + "_exit", token)) return false;
        }
        if (active(token)) resumeHost();
        return true;
      }

      async function previewPiano() {
        if (!canPreview()) return false;
        const token = startToken();
        mode = "working";
        if (!await play("piano_enter", token)) return false;
        if (hostState !== "working" && !await play("piano_loop", token)) return false;
        if (hostState === "working") {
          void work(true);
          return true;
        }
        mode = "finishing";
        if (!await play("piano_finish", token)) return false;
        if (active(token)) resumeHost();
        return true;
      }

      function canReact() {
        return ready && reactionReady && enabled && !disposed && !reducedMotion.matches &&
          hostState !== "working" && (mode === "idle" || mode === "reaction");
      }

      async function playReaction(name) {
        const token = startToken();
        mode = "reaction";
        if (!await play(name, token) || !active(token)) return;
        const next = pendingTap;
        pendingTap = null;
        if (!canReact()) resumeHost();
        else if (held) void grab();
        else if (next) void playReaction(next);
        else resumeHost();
      }

      function noteTap() {
        if (!canReact() || held) return;
        const now = performance.now();
        taps = taps.filter(time => now - time <= 5000);
        taps.push(now);
        const angry = taps.length === 3;
        if (angry) taps = [];
        const name = angry ? "reaction_mad" : "reaction_tap";
        if (mode === "idle") void playReaction(name);
        else if (pendingTap !== "reaction_mad") pendingTap = name;
      }

      async function grab() {
        const token = startToken();
        mode = "holding";
        if (await play("grab_enter", token) && active(token)) void play("grab_loop", token, true);
      }

      async function releaseGrab() {
        // The first part of the landing uses the takeoff poses in reverse.
        const start = clip === "grab_enter" ? CLIPS.grab_enter.count - 1 - index : 0;
        const token = startToken();
        mode = "releasing";
        if (await play("grab_exit", token, false, start) && active(token)) resumeHost();
      }

      function setHeld(value) {
        if (!value) {
          held = false;
          if (mode === "holding") void releaseGrab();
          else scheduleRotation();
          return;
        }
        taps = [];
        pendingTap = null;
        if (!canReact()) return;
        held = true;
        cancelRotation();
        if (mode === "idle") void grab();
      }

      function setDragging(value) {
        dragging = Boolean(value);
        if (dragging) cancelRotation();
        else scheduleRotation();
      }

      function setState(next) {
        if (disposed) return;
        if (next === "running_left" || next === "running_right") {
          setDragging(true);
          return;
        }
        if (next === "waiting") next = "working";
        if (next !== "working" && next !== "idle" && next !== "failed" && next !== "cancelled") return;
        const previous = hostState;
        hostState = next;
        dragging = false;
        if (!ready || !enabled) return;
        if (next === "working") {
          cancelRotation();
          taps = [];
          pendingTap = null;
          setHeld(false);
          if (realCoding && mode === "working" && previous !== "working") ending = null;
          if (mode === "idle") void work();
        } else if (realCoding && mode === "working") {
          if (next === "failed" || next === "cancelled") ending = "piano_exit";
          else if (previous === "working" && ending === null) ending = "piano_finish";
        } else if (mode === "idle") {
          scheduleRotation();
        }
      }

      function setEnabled(value) {
        const next = Boolean(value);
        if (disposed || enabled === next) return;
        enabled = next;
        held = false;
        taps = [];
        pendingTap = null;
        if (ready) resumeHost();
      }

      function setRotation(value) {
        if (disposed) return;
        rotation = Boolean(value);
        if (rotation) scheduleRotation();
        else cancelRotation();
      }

      function hitTest(x, y) {
        const r = canvas.getBoundingClientRect();
        if (!ready || x < r.left || x >= r.right || y < r.top || y >= r.bottom) return false;
        const px = Math.floor((x - r.left) / r.width * SIZE);
        const py = Math.floor((y - r.top) / r.height * SIZE);
        try {
          return ctx.getImageData(px, py, 1, 1).data[3] > 24;
        } catch {
          return false;
        }
      }

      const companion = { preview, previewPiano, getState, setEnabled, setRotation };
      window.KimiCompanion = companion;
      image.onload = () => {
        if (disposed) return;
        ready = true;
        options.onBodyBoundsChange?.(bounds());
        resumeHost();
      };
      image.src = ATLAS;
      reactionImage.onload = () => { reactionReady = true; };
      reactionImage.src = REACTION_ATLAS;

      return {
        setState, hitTest, getBodyBounds: bounds, setDragging, setHeld, noteTap,
        noteActivity() {},
        refreshDockLayout() { options.onBodyBoundsChange?.(bounds()); },
        playBoot() {},
        playShutdown() { return Promise.resolve(); },
        dispose() {
          disposed = true;
          startToken();
          if (window.KimiCompanion === companion) delete window.KimiCompanion;
        },
      };
    },
  };
})();
