import { MouthController, computeRmsDbfs } from "./mouth.js";
import { AvatarRenderer, loadAssets } from "./renderer.js";

// Cache per HTMLMediaElement: { context, sourceNode }
// In Web Audio, an <audio> element cannot be connected to multiple AudioContexts.
// Caching the source node and its context allows safe reuse across players.
const mediaElementMap = new WeakMap();

export async function createLipSyncAvatar(target, userOptions = {}) {
  let options = { ...userOptions };

  // Load config from config/lipsync.config.json if not provided
  if (!options.config && options.configUrl !== false && typeof fetch !== "undefined") {
    try {
      const cfgUrl = options.configUrl || "./config/lipsync.config.json";
      const cfgRes = await fetch(cfgUrl);
      if (cfgRes.ok) {
        const cfgData = await cfgRes.json();
        options = { ...cfgData, ...userOptions };
      }
    } catch (cfgErr) {
      // Non-fatal if config file not found or running in test runner
    }
  }

  // Accessibility: respect prefers-reduced-motion
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (prefersReducedMotion) {
    options.headMotion = false;
  }

  const canvas =
    target instanceof HTMLCanvasElement
      ? target
      : target?.querySelector?.("canvas") ||
        Object.assign(document.createElement("canvas"), { className: "lip-sync-canvas" });
  if (!(target instanceof HTMLCanvasElement) && target?.appendChild && !canvas.parentNode) {
    target.appendChild(canvas);
  }

  // Ensure accessible label on canvas if not set
  if (!canvas.getAttribute("aria-label")) {
    canvas.setAttribute("aria-label", "Animated avatar speaking with real-time lip sync");
  }
  if (!canvas.getAttribute("role")) {
    canvas.setAttribute("role", "img");
  }

  // Ensure only one engine/player is active on this canvas at any time
  if (canvas._lipsyncPlayer) {
    canvas._lipsyncPlayer.destroy();
  }

  let audio =
    options.source instanceof HTMLAudioElement || options.source instanceof HTMLVideoElement
      ? options.source
      : null;
  if (!audio && typeof options.source === "string") {
    audio = document.createElement("audio");
    audio.src = options.source;
    audio.crossOrigin = "anonymous";
    audio.controls = false;
  }

  // Reuse AudioContext if audio was previously attached to one and not explicitly overridden
  let context = options.audioContext || null;
  if (!context && audio && mediaElementMap.has(audio)) {
    const cached = mediaElementMap.get(audio);
    if (cached.context && cached.context.state !== "closed") {
      context = cached.context;
    }
  }
  if (!context && typeof AudioContext !== "undefined") {
    context = new AudioContext();
  }

  const assets = await loadAssets(options.assetsUrl || "/avatars/male");
  const renderer = new AvatarRenderer(canvas, assets, { headMotion: options.headMotion === true, ...options });
  const mouth = new MouthController(assets.shapes, options);

  let raf = 0;
  let running = true;
  let source = options.source;
  let analyser = null;
  let mediaSource = null;
  let sampleBuffer = null;
  let startPerfTime = performance.now();
  let sourceKind = "none";
  let lastLevelDb = -100;

  // Function to attach audio source to Web Audio
  function attachSource() {
    if (!context) {
      sourceKind = "none";
      return;
    }

    if (audio) {
      const cached = mediaElementMap.get(audio);
      if (cached && cached.context === context) {
        mediaSource = cached.sourceNode;
        sourceKind = "mediaElement";
      } else {
        try {
          mediaSource = context.createMediaElementSource(audio);
          mediaElementMap.set(audio, { context, sourceNode: mediaSource });
          sourceKind = "mediaElement";
        } catch (err) {
          console.error("[avatar-lipsync] createMediaElementSource failed:", err.message);
          // Fallback to audio.captureStream()
          try {
            const stream =
              (typeof audio.captureStream === "function" && audio.captureStream()) ||
              (typeof audio.mozCaptureStream === "function" && audio.mozCaptureStream());
            if (stream) {
              mediaSource = context.createMediaStreamSource(stream);
              sourceKind = "stream";
            } else {
              sourceKind = "none";
            }
          } catch (streamErr) {
            console.error("[avatar-lipsync] captureStream fallback failed:", streamErr.message);
            sourceKind = "none";
          }
        }
      }
    } else if (source instanceof MediaStream) {
      try {
        mediaSource = context.createMediaStreamSource(source);
        sourceKind = "stream";
      } catch (err) {
        console.error("[avatar-lipsync] MediaStream audio connection failed:", err.message);
        sourceKind = "none";
      }
    } else if (typeof AudioNode !== "undefined" && source instanceof AudioNode) {
      mediaSource = source;
      sourceKind = "node";
    } else {
      sourceKind = "none";
    }

    if (sourceKind !== "none" && mediaSource) {
      try {
        analyser = context.createAnalyser();
        analyser.fftSize = 512;
        sampleBuffer = new Float32Array(analyser.fftSize);
        mediaSource.connect(analyser);

        if (sourceKind === "mediaElement") {
          // Route through destination so audio remains audible with unity gain
          analyser.connect(context.destination);
        }
      } catch (connErr) {
        console.error("[avatar-lipsync] Failed connecting audio nodes:", connErr.message);
        sourceKind = "none";
      }
    }
  }

  attachSource();

  // Resume context on user interactions (play event, click, keydown)
  const resumeContext = () => {
    if (context && context.state === "suspended") {
      context.resume().catch((err) => {
        console.error("[avatar-lipsync] Failed to resume AudioContext:", err.message);
      });
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("click", resumeContext, { passive: true });
    window.addEventListener("keydown", resumeContext, { passive: true });
  }

  const onPlay = () => {
    resumeContext();
  };

  if (audio) {
    audio.addEventListener("play", onPlay);
  }

  const stateAt = (timeMs, animTimeMs = timeMs) => {
    let levelOrSamples = -100;
    const isActivelySpeaking = Boolean(
      (typeof options.getIsSpeaking === "function" && options.getIsSpeaking()) ||
      options.isSpeaking === true
    );

    if (analyser && sampleBuffer && sourceKind !== "none") {
      if (audio && (audio.paused || audio.ended)) {
        if (isActivelySpeaking) {
          const t = timeMs / 1000;
          const mod = Math.sin(t * 12) * Math.cos(t * 7) * Math.sin(t * 19);
          const simulatedLevel = -22 + mod * 10;
          levelOrSamples = simulatedLevel;
          lastLevelDb = simulatedLevel;
        } else {
          sampleBuffer.fill(0);
          levelOrSamples = -100;
          lastLevelDb = -100;
        }
      } else {
        analyser.getFloatTimeDomainData(sampleBuffer);
        levelOrSamples = sampleBuffer;
        lastLevelDb = computeRmsDbfs(sampleBuffer);
      }
    } else if (isActivelySpeaking) {
      const t = timeMs / 1000;
      const mod = Math.sin(t * 12) * Math.cos(t * 7) * Math.sin(t * 19);
      const simulatedLevel = -22 + mod * 10;
      levelOrSamples = simulatedLevel;
      lastLevelDb = simulatedLevel;
    } else {
      lastLevelDb = -100;
    }
    return mouth.update(levelOrSamples, timeMs, animTimeMs);
  };

  const state = () => {
    const animTimeMs = performance.now() - startPerfTime;
    let timeMs = 0;
    if (audio && !audio.paused) {
      timeMs = audio.currentTime * 1000;
    } else {
      timeMs = animTimeMs;
    }
    return stateAt(timeMs, animTimeMs);
  };

  const getState = () => {
    const frame = state();
    return {
      ...frame,
      audioContextState: context ? context.state : "none",
      sourceKind,
      levelDb: Math.round(lastLevelDb * 10) / 10,
      speaking: mouth.isSpeaking,
      targetOpen: Math.round(mouth.currentOpening * 1000) / 1000,
      shape: mouth.currentShape?.name || mouth.restShape?.name || "rest"
    };
  };

  // Continuous animation loop that runs from creation until destroy()
  const loop = () => {
    if (!running) return;
    const current = state();
    renderer.draw(current);
    options.onState?.(current);
    raf = requestAnimationFrame(loop);
  };

  loop();

  const instance = {
    start() {
      resumeContext();
      audio?.play().catch((err) => {
        console.error("[avatar-lipsync] audio.play() error:", err.message);
      });
    },
    stop() {
      audio?.pause();
    },
    setSource(val) {
      source = val;
      if (source instanceof HTMLAudioElement || source instanceof HTMLVideoElement) {
        audio = source;
      }
      attachSource();
    },
    renderAt(tMs) {
      const frame = stateAt(tMs);
      renderer.draw(frame);
      return frame;
    },
    getState,
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      if (typeof window !== "undefined") {
        window.removeEventListener("click", resumeContext);
        window.removeEventListener("keydown", resumeContext);
      }
      if (audio) {
        audio.removeEventListener("play", onPlay);
      }
      if (analyser) {
        try {
          analyser.disconnect();
        } catch {}
      }
      if (canvas._lipsyncPlayer === instance) {
        canvas._lipsyncPlayer = null;
      }
    }
  };

  canvas._lipsyncPlayer = instance;
  return instance;
}
