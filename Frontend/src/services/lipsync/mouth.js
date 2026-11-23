// Simple Mouth Controller
// When sound plays, the mouth moves with opening size following loudness.
// When sound stops, the mouth closes and stays still.

export function createRng(seed = 1) {
  let a = (seed >>> 0) || 12345;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeRmsDbfs(samples) {
  if (!samples || samples.length === 0) return -100;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    sum += s * s;
  }
  const rms = Math.sqrt(sum / samples.length);
  if (rms < 1e-6) return -100;
  return 20 * Math.log10(rms);
}

export class MouthController {
  constructor(shapes, config = {}) {
    this.config = {
      gateStartDbfs: -46,
      gateEndDbfs: -52,
      gateHoldMs: 120,
      peakRangeDb: 25,
      peakTrackWindowMs: 3000,
      peakFloorDbfs: -25,
      attackMs: 30,
      releaseMs: 80,
      shapeIntervalMinMs: 90,
      shapeIntervalMaxMs: 150,
      openTolerance: 0.15,
      specialRoundProb: 0.1667,
      crossFadeMs: 60,
      silenceTransitionMs: 150,
      blinkMinGapMs: 3000,
      blinkMaxGapMs: 5500,
      blinkSpeakingMinGapMs: 8000,
      blinkSpeakingMaxGapMs: 11000,
      blinkDurationMs: 180,
      halfBlinkMs: 50,
      minBlinkCooldownMs: 1500,
      headMotion: false,
      ...config
    };

    this.rng = config.rng || (config.seed ? createRng(config.seed) : Math.random);

    // Normalize shapes array
    if (Array.isArray(shapes)) {
      this.shapes = shapes;
    } else if (shapes && typeof shapes === "object") {
      this.shapes = Object.entries(shapes).map(([name, entry]) => ({ name, ...entry }));
    } else {
      this.shapes = [];
    }

    // Identify rest shape and maximum open parameter in pack
    this.maxPackOpen = this.shapes.reduce((max, s) => Math.max(max, s.params?.open ?? 0), 0) || 1.0;

    this.restShape =
      this.shapes.find((s) => s.name.toLowerCase() === "rest") ||
      this.shapes.find((s) => s.name === "X") ||
      this.shapes.find((s) => s.params?.closed === true) ||
      this.shapes[0] ||
      { name: "rest", params: { open: 0, round: 0, teeth: 0, closed: true } };

    // State
    this.isSpeaking = false;
    this.timeBelowGateMs = 0;
    this.peakHistory = [];
    this.currentOpening = 0.0;

    this.currentShape = this.restShape;
    this.previousShape = this.restShape;
    this.targetShape = this.restShape;

    this.transitionStartMs = 0;
    this.nextShapeTimeMs = 0;
    this.beatCount = 0;
    this.shapeChangesCount = 0;

    this.activeShapes = [{ ...this.restShape, weight: 1.0 }];

    // Blinks: initial blink in 1.5 - 3.0s, then random every 2.5 to 6.0s
    this.nextBlinkStartMs = 1500 + this.rng() * 1500;
    this.lastBlinkEndMs = 0;
    this.lastTimeMs = 0;
  }

  update(levelOrSamples, timeMs, animTimeMs = timeMs) {
    const dtMs = Math.max(1, Math.min(100, this.lastTimeMs > 0 ? timeMs - this.lastTimeMs : 20));
    this.lastTimeMs = timeMs;

    const levelDbfs = typeof levelOrSamples === "number" ? levelOrSamples : computeRmsDbfs(levelOrSamples);

    // 1. Sound detector with hysteresis
    if (!this.isSpeaking) {
      if (levelDbfs >= this.config.gateStartDbfs) {
        this.isSpeaking = true;
        this.timeBelowGateMs = 0;
        this.nextShapeTimeMs = timeMs; // pick shape immediately upon speech
      }
    } else {
      if (levelDbfs < this.config.gateEndDbfs) {
        this.timeBelowGateMs += dtMs;
        if (this.timeBelowGateMs >= this.config.gateHoldMs) {
          this.isSpeaking = false;
        }
      } else {
        this.timeBelowGateMs = 0;
      }
    }

    // 2. Loudness to opening
    if (levelDbfs > -70) {
      this.peakHistory.push({ t: timeMs, level: levelDbfs });
    }
    const cutoff = timeMs - this.config.peakTrackWindowMs;
    while (this.peakHistory.length > 0 && this.peakHistory[0].t < cutoff) {
      this.peakHistory.shift();
    }

    let recentPeak = this.config.peakFloorDbfs ?? -25;
    for (let i = 0; i < this.peakHistory.length; i += 1) {
      if (this.peakHistory[i].level > recentPeak) {
        recentPeak = this.peakHistory[i].level;
      }
    }

    let rawTargetOpening = 0.0;
    if (this.isSpeaking && levelDbfs >= this.config.gateEndDbfs) {
      const minDb = recentPeak - this.config.peakRangeDb;
      const ratio = Math.max(0.0, Math.min(1.0, (levelDbfs - minDb) / this.config.peakRangeDb));
      rawTargetOpening = ratio * this.maxPackOpen;
    }

    // Fast attack (30 ms), release (80 ms)
    const tau = rawTargetOpening > this.currentOpening ? this.config.attackMs : this.config.releaseMs;
    const alpha = 1 - Math.exp(-dtMs / Math.max(1, tau));
    this.currentOpening += alpha * (rawTargetOpening - this.currentOpening);

    // 3. Shape selection & transition
    const shouldSpeak = this.isSpeaking && levelDbfs >= this.config.gateEndDbfs;

    if (shouldSpeak) {
      if (timeMs >= this.nextShapeTimeMs) {
        this.beatCount += 1;
        const targetOpen = this.currentOpening;
        let candidates = [];

        // 1 beat in 6 prefers rounded or spread (|round| > 0.5) of similar opening
        if (this.beatCount % 6 === 0) {
          candidates = this.shapes.filter(
            (s) => Math.abs(s.params?.round ?? 0) > 0.5 && Math.abs((s.params?.open ?? 0) - targetOpen) <= 0.35
          );
        }

        // Standard candidates: params.open within openTolerance (0.15)
        if (candidates.length === 0) {
          candidates = this.shapes.filter(
            (s) => Math.abs((s.params?.open ?? 0) - targetOpen) <= this.config.openTolerance
          );
        }

        // Fallback / variety expansion if candidates < 2
        if (candidates.length < 2) {
          const sorted = [...this.shapes].sort(
            (a, b) => Math.abs((a.params?.open ?? 0) - targetOpen) - Math.abs((b.params?.open ?? 0) - targetOpen)
          );
          candidates = sorted.slice(0, Math.min(4, sorted.length));
        }

        // Never the same shape twice in a row
        let filtered = candidates.filter(
          (s) => s.name !== this.targetShape?.name && s.name !== this.currentShape?.name
        );
        if (filtered.length === 0) {
          filtered = this.shapes.filter(
            (s) => s.name !== this.targetShape?.name && s.name !== this.currentShape?.name
          );
        }
        if (filtered.length === 0) {
          filtered = candidates;
        }

        const picked = filtered[Math.floor(this.rng() * filtered.length)];
        if (picked && picked.name !== this.targetShape?.name) {
          this.previousShape = this.currentShape;
          this.targetShape = picked;
          this.transitionStartMs = timeMs;
          this.shapeChangesCount += 1;
        }

        const interval =
          this.config.shapeIntervalMinMs +
          this.rng() * (this.config.shapeIntervalMaxMs - this.config.shapeIntervalMinMs);
        this.nextShapeTimeMs = timeMs + interval;
      }

      // Cross-fade over 60 ms
      const elapsed = timeMs - this.transitionStartMs;
      const progress = Math.min(1.0, Math.max(0.0, elapsed / Math.max(1, this.config.crossFadeMs)));
      if (progress >= 1.0) {
        this.currentShape = this.targetShape;
        this.activeShapes = [{ ...this.targetShape, weight: 1.0 }];
      } else {
        const wTarget = progress;
        const wPrev = 1.0 - progress;
        if (this.previousShape && this.previousShape.name !== this.targetShape.name) {
          this.activeShapes = [
            { ...this.previousShape, weight: wPrev },
            { ...this.targetShape, weight: wTarget }
          ];
        } else {
          this.activeShapes = [{ ...this.targetShape, weight: 1.0 }];
        }
      }
    } else {
      // 4. Silence: target is rest, reached within 150 ms, then no movement
      if (this.targetShape.name !== this.restShape.name) {
        this.previousShape = this.currentShape;
        this.targetShape = this.restShape;
        this.transitionStartMs = timeMs;
        this.shapeChangesCount += 1;
      }

      const elapsed = timeMs - this.transitionStartMs;
      const progress = Math.min(1.0, Math.max(0.0, elapsed / Math.max(1, this.config.silenceTransitionMs)));
      if (progress >= 1.0) {
        this.currentShape = this.restShape;
        this.previousShape = this.restShape;
        this.activeShapes = [{ ...this.restShape, weight: 1.0 }];
        this.currentOpening = 0.0;
      } else {
        const wTarget = progress;
        const wPrev = 1.0 - progress;
        if (this.previousShape && this.previousShape.name !== this.restShape.name) {
          this.activeShapes = [
            { ...this.previousShape, weight: wPrev },
            { ...this.restShape, weight: wTarget }
          ];
        } else {
          this.activeShapes = [{ ...this.restShape, weight: 1.0 }];
        }
      }
    }

    // 5. Blinks: natural cadence at rest (3-5.5s) and during reading/speaking (~once every 8-10s)
    let blink = 0.0;
    if (animTimeMs >= this.nextBlinkStartMs) {
      const bElapsed = animTimeMs - this.nextBlinkStartMs;
      if (bElapsed < this.config.blinkDurationMs) {
        if (bElapsed < this.config.halfBlinkMs || bElapsed >= this.config.blinkDurationMs - this.config.halfBlinkMs) {
          blink = 0.5; // triggers halfBlink
        } else {
          blink = 1.0; // triggers full blink
        }
      } else {
        blink = 0.0;
        this.lastBlinkEndMs = this.nextBlinkStartMs + this.config.blinkDurationMs;
        const minGap = this.isSpeaking ? this.config.blinkSpeakingMinGapMs : this.config.blinkMinGapMs;
        const maxGap = this.isSpeaking ? this.config.blinkSpeakingMaxGapMs : this.config.blinkMaxGapMs;
        const gap = minGap + this.rng() * (maxGap - minGap);
        this.nextBlinkStartMs = Math.max(this.lastBlinkEndMs + this.config.minBlinkCooldownMs, this.lastBlinkEndMs + gap);
      }
    }

    const mouth = Object.fromEntries(this.activeShapes.map((s) => [s.name, s.weight]));
    mouth.dominant = this.activeShapes[0]?.name || this.restShape.name;

    return {
      tMs: timeMs,
      params: {
        open: this.currentOpening,
        round: this.currentShape?.params?.round ?? 0,
        teeth: this.currentShape?.params?.teeth ?? 0,
        closed: !this.isSpeaking
      },
      mouth,
      activeShapes: this.activeShapes,
      eyes: { blink },
      head: { x: 0, y: 0, rotate: 0, scale: 1 },
      body: { breath: 0 }
    };
  }
}
