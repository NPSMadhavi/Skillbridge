import confetti from 'canvas-confetti'

/**
 * Plays a cheerful celebratory fanfare sound using the Web Audio API (no external mp3 files required).
 */
export const playVictoryFanfare = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    const ctx = new AudioContext()

    const notes = [
      { freq: 523.25, time: 0.0, duration: 0.15 }, // C5
      { freq: 659.25, time: 0.15, duration: 0.15 }, // E5
      { freq: 783.99, time: 0.30, duration: 0.2 }, // G5
      { freq: 1046.50, time: 0.50, duration: 0.55 }, // C6
      { freq: 880.00, time: 0.70, duration: 0.15 }, // A5
      { freq: 1046.50, time: 0.85, duration: 0.70 }, // C6
    ]

    notes.forEach(({ freq, time, duration }) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, ctx.currentTime + time)

      gain.gain.setValueAtTime(0.001, ctx.currentTime + time)
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + time + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + time + duration)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(ctx.currentTime + time)
      osc.stop(ctx.currentTime + time + duration)
    })
  } catch (e) {
    console.warn('[Confetti] Web Audio API playback notice:', e)
  }
}

/**
 * Triggers a multi-stage celebration blast with cannons, golden stars, and confetti showers.
 */
export const triggerCertificateBlast = () => {
  // Play celebration audio fanfare
  playVictoryFanfare()

  const colors = ['#ff7a00', '#ffb703', '#2563eb', '#22c55e', '#a855f7', '#ec4899', '#f59e0b']

  // Wave 1: Immediate Center Super Blast
  confetti({
    particleCount: 80,
    spread: 100,
    origin: { y: 0.6 },
    colors,
    startVelocity: 45,
    scalar: 1.2,
    ticks: 300,
    zIndex: 9999
  })

  // Wave 2: Left & Right Crossfire Cannons (250ms delay)
  setTimeout(() => {
    confetti({
      particleCount: 50,
      angle: 60,
      spread: 65,
      origin: { x: 0, y: 0.65 },
      colors,
      zIndex: 9999
    })
    confetti({
      particleCount: 50,
      angle: 120,
      spread: 65,
      origin: { x: 1, y: 0.65 },
      colors,
      zIndex: 9999
    })
  }, 250)

  // Wave 3: Golden Sparkles Rain (600ms delay)
  setTimeout(() => {
    confetti({
      particleCount: 60,
      spread: 120,
      origin: { y: 0.4 },
      colors: ['#ffd700', '#ffb703', '#ffa200', '#ffffff'],
      shapes: ['star', 'circle'],
      scalar: 1.1,
      zIndex: 9999
    })
  }, 600)

  // Wave 4: Grand Finale Left & Right burst (1100ms delay)
  setTimeout(() => {
    confetti({
      particleCount: 60,
      angle: 55,
      spread: 75,
      origin: { x: 0.1, y: 0.7 },
      colors,
      zIndex: 9999
    })
    confetti({
      particleCount: 60,
      angle: 125,
      spread: 75,
      origin: { x: 0.9, y: 0.7 },
      colors,
      zIndex: 9999
    })
  }, 1100)
}
