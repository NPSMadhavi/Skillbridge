export const DEFAULT_PARAMS = Object.freeze({
  X: { open: 0.0, round: 0.0, teeth: 0.0, closed: true },
  A: { open: 0.0, round: 0.0, teeth: 0.0, closed: true },
  B: { open: 0.25, round: 0.0, teeth: 0.5, closed: false },
  C: { open: 0.5, round: -0.2, teeth: 0.6, closed: false },
  D: { open: 0.85, round: -0.1, teeth: 0.3, closed: false },
  E: { open: 0.4, round: 0.8, teeth: 0.0, closed: false },
  F: { open: 0.2, round: 1.0, teeth: 0.0, closed: false },
  G: { open: 0.15, round: -0.3, teeth: 0.9, closed: false },
  H: { open: 0.6, round: -0.1, teeth: 0.4, closed: false },
  SMILE: { open: 0.2, round: -0.8, teeth: 0.7, closed: false },
  EE: { open: 0.3, round: -0.9, teeth: 0.8, closed: false }
});

export function validateAvatarMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    throw new Error("Invalid avatar metadata.");
  }
  if (!metadata.base) {
    throw new Error("Avatar pack is missing a base image.");
  }
  return metadata;
}

export class AvatarRenderer {
  constructor(canvas, assets, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.assets = assets;
    this.options = options;
  }

  draw(state) {
    const { ctx, canvas } = this;
    const dpr = this.options.dpr || (typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1);
    const cssWidth = parseFloat(canvas.style?.width) || (canvas.width ? canvas.width / dpr : 512);
    const cssHeight = parseFloat(canvas.style?.height) || (canvas.height ? canvas.height / dpr : 512);
    const size = Math.min(cssWidth || 512, cssHeight || 512);
    const targetPx = Math.round(size * dpr);

    if (canvas.width !== targetPx || canvas.height !== targetPx) {
      canvas.width = targetPx;
      canvas.height = targetPx;
      if (canvas.style) {
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const baseWidth = this.assets.size?.[0] || 1024;
    const scale = size / baseWidth;

    ctx.save();
    // Head motion is OFF by default (Task 7)
    // If turned on: bounded to max 2px translation, 0.5 deg rotation, 0.3% scale
    if (this.options.headMotion === true && state.head) {
      const hX = Math.max(-2, Math.min(2, state.head.x || 0)) * scale;
      const hY = Math.max(-2, Math.min(2, state.head.y || 0)) * scale;
      const rot = Math.max(-0.5, Math.min(0.5, state.head.rotate || 0));
      const headScale = Math.max(0.997, Math.min(1.003, (state.head.scale || 1) + (state.body?.breath || 0)));

      ctx.translate(size / 2, size * 0.83);
      ctx.translate(hX, hY);
      ctx.rotate(rot * Math.PI / 180);
      ctx.scale(headScale, headScale);
      ctx.translate(-size / 2, -size * 0.83);
    }

    ctx.scale(scale, scale);

    // 1. Draw base face
    if (this.assets.base) {
      ctx.drawImage(this.assets.base, 0, 0);
    }

    // 2. Draw mouth shapes using opacity rule: opacity_k = w_k / (w_1 + ... + w_k)
    const activeShapes = state.activeShapes || [];
    let accumulated = 0;
    for (const shape of activeShapes) {
      const weight = shape.weight || 0;
      if (weight <= 0.001 || !shape.image) continue;
      accumulated += weight;
      ctx.globalAlpha = weight / accumulated;
      const [ox, oy] = shape.origin || [436, 702];
      ctx.drawImage(shape.image, ox, oy);
    }
    ctx.globalAlpha = 1.0;

    // 3. Draw blink patch (with optional halfBlink)
    const blinkVal = state.eyes?.blink || 0;
    if (blinkVal > 0.1) {
      if (this.assets.halfBlink && blinkVal < 0.7) {
        const [bx, by] = this.assets.halfBlink.origin || [407, 494];
        ctx.drawImage(this.assets.halfBlink.image, bx, by);
      } else if (this.assets.blink) {
        const [bx, by] = this.assets.blink.origin || [407, 494];
        ctx.drawImage(this.assets.blink.image, bx, by);
      }
    }

    ctx.restore();
  }
}

export async function loadAssets(assetsUrl) {
  const vQuery = `v=${Date.now()}`;
  let res;
  try {
    res = await fetch(`${assetsUrl}/avatar.json?${vQuery}`);
  } catch (netErr) {
    const err = new Error(`Network failure loading avatar pack metadata from ${assetsUrl}/avatar.json: ${netErr.message}`);
    console.error("[avatar-lipsync]", err);
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Failed to load avatar configuration: HTTP ${res.status} ${res.statusText} from ${assetsUrl}/avatar.json`);
    console.error("[avatar-lipsync]", err);
    throw err;
  }
  const metadata = await res.json();
  validateAvatarMetadata(metadata);

  const jsonStr = JSON.stringify(metadata);
  let hash = 0;
  for (let i = 0; i < jsonStr.length; i += 1) {
    hash = (hash * 31 + jsonStr.charCodeAt(i)) >>> 0;
  }
  const patchVersion = hash.toString(16);

  const loadImage = (relPath) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => {
        const err = new Error(`Failed to load asset image: ${assetsUrl}/${relPath}`);
        console.error("[avatar-lipsync]", err);
        reject(err);
      };
      img.src = `${assetsUrl}/${relPath}?v=${patchVersion}`;
    });

  const base = await loadImage(metadata.base || "base.png");

  // Load blink (top-level or under eyes.blink)
  let blink = null;
  const blinkDef = Array.isArray(metadata.blink) ? metadata.blink[0] : (metadata.blink || metadata.eyes?.blink);
  if (blinkDef) {
    const file = blinkDef.file || blinkDef.patch;
    blink = {
      image: await loadImage(file),
      origin: blinkDef.origin || [407, 494],
      size: blinkDef.size || [429, 188]
    };
  }

  // Load halfBlink (top-level or under eyes.halfBlink)
  let halfBlink = null;
  const halfBlinkDef = metadata.halfBlink || metadata.eyes?.halfBlink;
  if (halfBlinkDef) {
    const file = halfBlinkDef.file || halfBlinkDef.patch;
    halfBlink = {
      image: await loadImage(file),
      origin: halfBlinkDef.origin || [407, 494],
      size: halfBlinkDef.size || [429, 188]
    };
  }

  // Load shapes (version 2: metadata.shapes)
  const shapes = [];
  const rawShapes = metadata.shapes || {};

  for (const [name, entry] of Object.entries(rawShapes)) {
    const file = entry.file || entry.patch;
    if (!file) continue;

    let params = entry.params;
    if (!params) {
      if (name in DEFAULT_PARAMS) {
        params = DEFAULT_PARAMS[name];
      } else {
        console.warn(`[avatar-lipsync] Warning: Shape "${name}" has no params in avatar.json. Using default fallback.`);
        params = { open: 0.0, round: 0.0, teeth: 0.0, closed: false };
      }
    }

    const image = await loadImage(file);
    shapes.push({
      name,
      image,
      origin: entry.origin || [436, 702],
      size: entry.size || [357, 217],
      params
    });
  }

  return {
    base,
    blink,
    halfBlink,
    shapes,
    size: metadata.size || metadata.canvas || [1024, 1024],
    metadata
  };
}
