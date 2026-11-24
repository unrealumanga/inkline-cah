import type { CueKind } from "../sim/schema.ts"

export class InklineAudio {
  private ctx: AudioContext | null = null
  private unlocked = false
  private muted = false

  isMuted(): boolean {
    return this.muted
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    return this.muted
  }

  /**
   * Call once on the first real user pointer/key gesture so browsers never emit
   * an AudioContext autoplay warning on initial page load!
   */
  unlock(): void {
    this.unlocked = true
    if (this.muted) return
    if (this.ctx === null && typeof window.AudioContext === "function") {
      this.ctx = new window.AudioContext()
    }
    if (this.ctx !== null && this.ctx.state === "suspended") {
      void this.ctx.resume()
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || !this.unlocked) return null
    if (this.ctx === null && typeof window.AudioContext === "function") {
      this.ctx = new window.AudioContext()
    }
    if (this.ctx !== null && this.ctx.state === "suspended") {
      void this.ctx.resume()
    }
    return this.ctx
  }

  private playNoiseBurst(duration: number, freq: number, q: number, gainPeak: number, delay = 0): void {
    const ctx = this.ensureContext()
    if (ctx === null) return

    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration))
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < sampleCount; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleCount * 0.45))
    }

    const src = ctx.createBufferSource()
    src.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = "bandpass"
    filter.frequency.value = freq
    filter.Q.value = q

    const gain = ctx.createGain()
    const t0 = ctx.currentTime + delay
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    src.start(t0)
    src.stop(t0 + duration + 0.01)
  }

  private playTone(freq: number, duration: number, gainPeak: number, delay = 0, type: OscillatorType = "triangle"): void {
    const ctx = this.ensureContext()
    if (ctx === null) return

    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq

    const gain = ctx.createGain()
    const t0 = ctx.currentTime + delay
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + duration + 0.02)
  }

  playCue(kind: CueKind): void {
    if (this.muted || !this.unlocked) return
    switch (kind) {
      case "select":
        this.playNoiseBurst(0.045, 1900, 1.4, 0.09)
        this.playTone(540, 0.055, 0.035, 0, "sine")
        break
      case "submit":
        this.playNoiseBurst(0.09, 1150, 0.9, 0.14)
        this.playTone(290, 0.08, 0.045, 0.01, "triangle")
        break
      case "seal":
        this.playNoiseBurst(0.08, 620, 0.7, 0.18)
        this.playTone(170, 0.14, 0.09, 0, "sine")
        this.playTone(440, 0.16, 0.05, 0.04, "triangle")
        break
      case "flip":
        this.playNoiseBurst(0.075, 2400, 1.3, 0.13)
        this.playTone(680, 0.07, 0.035, 0.015, "sine")
        break
      case "deal":
        this.playNoiseBurst(0.06, 1500, 1.0, 0.09, 0)
        this.playNoiseBurst(0.06, 1750, 1.0, 0.09, 0.06)
        break
      case "redraw":
        this.playNoiseBurst(0.05, 1400, 1.2, 0.1, 0)
        this.playNoiseBurst(0.05, 1700, 1.2, 0.1, 0.055)
        this.playNoiseBurst(0.06, 2050, 1.2, 0.1, 0.11)
        break
      case "award":
        // Meaty rubber-stamp thud + warm approval chord!
        this.playNoiseBurst(0.09, 520, 0.8, 0.2, 0)
        this.playTone(140, 0.11, 0.09, 0, "sine")
        this.playTone(523.25, 0.22, 0.075, 0.04, "triangle")
        this.playTone(659.25, 0.28, 0.075, 0.12, "triangle")
        break
      case "tick":
        this.playTone(880, 0.035, 0.045, 0, "square")
        break
      case "reaction":
        this.playTone(720, 0.05, 0.04, 0, "sine")
        break
      case "victory":
        this.playTone(523.25, 0.22, 0.08, 0, "triangle")
        this.playTone(659.25, 0.22, 0.08, 0.1, "triangle")
        this.playTone(783.99, 0.25, 0.08, 0.2, "triangle")
        this.playTone(1046.5, 0.45, 0.09, 0.32, "triangle")
        break
    }
  }
}
