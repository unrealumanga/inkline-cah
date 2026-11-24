import * as THREE from "three"
import { WRITE_IN_CARD_BASE_ID, type BlackCard, type WhiteCard } from "../sim/cards.ts"
import { INKLINE_THEMES, type InklineThemePalette } from "./palette.ts"

const TEX_W = 512
const TEX_H = 716
const MONO_FONT = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'

export interface WhiteCardRenderOpts {
  readonly orderBadge?: number | null
  readonly approved?: boolean
  readonly comboStamp?: boolean
  readonly sealedStamp?: boolean
  readonly authorLabel?: string | null
}

function createCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas")
  canvas.width = TEX_W
  canvas.height = TEX_H
  const ctx = canvas.getContext("2d")!
  return { canvas, ctx }
}

function finalizeTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

function drawCornerTicks(ctx: CanvasRenderingContext2D, pad: number, len: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  const x0 = pad
  const y0 = pad
  const x1 = TEX_W - pad
  const y1 = TEX_H - pad

  ctx.beginPath()
  ctx.moveTo(x0, y0 + len)
  ctx.lineTo(x0, y0)
  ctx.lineTo(x0 + len, y0)
  ctx.moveTo(x1 - len, y0)
  ctx.lineTo(x1, y0)
  ctx.lineTo(x1, y0 + len)
  ctx.moveTo(x0, y1 - len)
  ctx.lineTo(x0, y1)
  ctx.lineTo(x0 + len, y1)
  ctx.moveTo(x1 - len, y1)
  ctx.lineTo(x1, y1)
  ctx.lineTo(x1, y1 - len)
  ctx.stroke()
}

function drawPaperGrain(ctx: CanvasRenderingContext2D, seed: number, dark: boolean) {
  let s = seed >>> 0
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  ctx.fillStyle = dark ? "rgba(240, 242, 236, 0.032)" : "rgba(61, 73, 67, 0.028)"
  for (let i = 0; i < 320; i++) {
    const x = next() * TEX_W
    const y = next() * TEX_H
    const r = 0.8 + next() * 1.3
    ctx.fillRect(x, y, r, r)
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): Array<string> {
  const words = text.split(/\s+/)
  const lines: Array<string> = []
  let current = ""

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate
    } else {
      if (current.length > 0) lines.push(current)
      current = word
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}

function drawIsometricCubeMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  stroke: string,
  fill?: string
) {
  const dx = r * 0.866
  const dy = r * 0.5
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(cx, cy - r)
  ctx.lineTo(cx + dx, cy - dy)
  ctx.lineTo(cx + dx, cy + dy)
  ctx.lineTo(cx, cy + r)
  ctx.lineTo(cx - dx, cy + dy)
  ctx.lineTo(cx - dx, cy - dy)
  ctx.closePath()
  if (fill !== undefined) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  ctx.strokeStyle = stroke
  ctx.lineWidth = 2.2
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx, cy + r)
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + dx, cy - dy)
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx - dx, cy - dy)
  ctx.stroke()
  ctx.restore()
}

function drawRubberStamp(
  ctx: CanvasRenderingContext2D,
  label: string,
  sublabel: string | null,
  color: string,
  cx: number,
  cy: number,
  angleRad: number
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angleRad)

  ctx.font = `800 32px ${MONO_FONT}`
  const w = Math.max(210, ctx.measureText(label).width + 44)
  const h = sublabel !== null ? 86 : 62

  ctx.fillStyle = "rgba(247, 248, 244, 0.86)"
  ctx.fillRect(-w / 2, -h / 2, w, h)

  ctx.strokeStyle = color
  ctx.lineWidth = 5
  ctx.strokeRect(-w / 2, -h / 2, w, h)
  ctx.lineWidth = 2
  ctx.strokeRect(-w / 2 + 7, -h / 2 + 7, w - 14, h - 14)

  ctx.fillStyle = color
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(label, 0, sublabel !== null ? -11 : 1)

  if (sublabel !== null) {
    ctx.font = `700 16px ${MONO_FONT}`
    ctx.fillText(sublabel, 0, 20)
  }

  ctx.restore()
}

export class CardTextureCache {
  private theme: InklineThemePalette = INKLINE_THEMES.sage
  private readonly whiteFronts = new Map<string, THREE.CanvasTexture>()
  private readonly blackFronts = new Map<number, THREE.CanvasTexture>()
  private whiteBackTex: THREE.CanvasTexture | null = null
  private blackBackTex: THREE.CanvasTexture | null = null

  setTheme(theme: InklineThemePalette): void {
    if (this.theme.id === theme.id) return
    this.theme = theme
    this.dispose()
  }

  getWhiteFront(card: WhiteCard, opts: WhiteCardRenderOpts = {}): THREE.CanvasTexture {
    const orderBadge = opts.orderBadge ?? null
    const approved = opts.approved ?? false
    const comboStamp = opts.comboStamp ?? false
    const sealedStamp = opts.sealedStamp ?? false
    const authorLabel = opts.authorLabel ?? null

    const key = `${this.theme.id}:${card.id}:${card.text}:${orderBadge ?? 0}:${approved ? 1 : 0}:${comboStamp ? 1 : 0}:${sealedStamp ? 1 : 0}:${authorLabel ?? ""}`
    const cached = this.whiteFronts.get(key)
    if (cached !== undefined) return cached

    const t = this.theme
    const { canvas, ctx } = createCanvas()

    // Base warm paper fill
    ctx.fillStyle = t.paperCard
    ctx.fillRect(0, 0, TEX_W, TEX_H)
    drawPaperGrain(ctx, card.id * 97 + 13, t.id === "charcoal")

    // Subtle vertical drafting lines near bottom
    ctx.strokeStyle = t.borderSoft
    ctx.lineWidth = 1
    for (let x = 44; x < TEX_W - 40; x += 36) {
      ctx.beginPath()
      ctx.moveTo(x, TEX_H - 135)
      ctx.lineTo(x, TEX_H - 42)
      ctx.stroke()
    }

    ctx.strokeStyle = approved ? t.accentGreen : sealedStamp ? t.accentBlue : t.borderLine
    ctx.lineWidth = approved ? 5 : 2
    ctx.strokeRect(22, 22, TEX_W - 44, TEX_H - 44)
    drawCornerTicks(ctx, 34, 14, approved ? t.accentGreen : t.inkPrimary)

    // Header row: serial + tag(s)
    ctx.font = `600 19px ${MONO_FONT}`
    ctx.fillStyle = t.inkMuted
    ctx.textBaseline = "top"
    const isWriteIn = card.id >= WRITE_IN_CARD_BASE_ID
    ctx.fillText(isWriteIn ? "W-INK" : card.code, 48, 48)

    const tagStr = isWriteIn
      ? "// WRITE-IN"
      : card.tags
          .slice(0, 2)
          .map((tag) => `// ${tag.toUpperCase()}`)
          .join(" ")
    const tagW = ctx.measureText(tagStr).width
    ctx.fillStyle = isWriteIn ? t.accentBlue : t.inkMuted
    ctx.fillText(tagStr, TEX_W - 48 - tagW, 48)

    ctx.strokeStyle = t.borderSoft
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(48, 84)
    ctx.lineTo(TEX_W - 48, 84)
    ctx.stroke()

    // Optional author nameplate ribbon on RoundResult!
    let textStartY = 114
    if (authorLabel !== null) {
      ctx.fillStyle = approved ? t.accentGreenWash : t.paperRecessed
      ctx.strokeStyle = approved ? t.accentGreen : t.borderLine
      ctx.lineWidth = 2
      ctx.fillRect(48, 98, TEX_W - 96, 36)
      ctx.strokeRect(48, 98, TEX_W - 96, 36)
      ctx.font = `700 18px ${MONO_FONT}`
      ctx.fillStyle = approved ? t.accentGreen : t.inkPrimary
      ctx.fillText(`PLAYED BY ${authorLabel.toUpperCase()}`, 62, 107)
      textStartY = 152
    }

    // Main card copy
    const fontSize = card.text.length > 68 ? 31 : 35
    ctx.font = `700 ${fontSize}px ${MONO_FONT}`
    ctx.fillStyle = isWriteIn ? t.accentBlue : t.inkDeep
    const lines = wrapText(ctx, card.text, TEX_W - 96)
    let y = textStartY
    const lineHeight = fontSize * 1.38
    for (const line of lines) {
      ctx.fillText(line, 48, y)
      y += lineHeight
    }

    // Optional staged order stamp (#1 / #2)
    if (orderBadge !== null) {
      const bx = TEX_W - 116
      const by = TEX_H - 196
      ctx.fillStyle = t.accentBlueWash
      ctx.strokeStyle = t.accentBlue
      ctx.lineWidth = 3
      ctx.fillRect(bx, by, 68, 52)
      ctx.strokeRect(bx, by, 68, 52)
      ctx.font = `700 26px ${MONO_FONT}`
      ctx.fillStyle = t.accentBlue
      ctx.fillText(`#${orderBadge}`, bx + 16, by + 13)
    }

    // Ink Seal badge
    if (sealedStamp && !approved) {
      drawRubberStamp(ctx, "INK SEAL 2×", null, t.accentBlue, TEX_W - 175, TEX_H - 195, -0.14)
    }

    // Dramatic APPROVED rubber stamp on winning card!
    if (approved) {
      const sub = comboStamp ? "×1.5 COMBO!" : sealedStamp ? "2× INK SEALED!" : "POINT AWARDED"
      drawRubberStamp(ctx, "APPROVED", sub, t.accentGreen, TEX_W / 2 + 24, TEX_H - 220, -0.17)
    }

    // Footer divider & mark
    ctx.strokeStyle = t.borderSoft
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(48, TEX_H - 96)
    ctx.lineTo(TEX_W - 48, TEX_H - 96)
    ctx.stroke()

    drawIsometricCubeMark(ctx, 68, TEX_H - 64, 16, t.inkPrimary, t.paperRecessed)
    ctx.font = `600 17px ${MONO_FONT}`
    ctx.fillStyle = t.inkMuted
    ctx.fillText("INKLINE AGAINST HUMANITY", 100, TEX_H - 72)

    const tex = finalizeTexture(canvas)
    this.whiteFronts.set(key, tex)
    return tex
  }

  getBlackFront(card: BlackCard): THREE.CanvasTexture {
    const cached = this.blackFronts.get(card.id)
    if (cached !== undefined) return cached

    const t = this.theme
    const { canvas, ctx } = createCanvas()

    ctx.fillStyle = t.blackCardFill
    ctx.fillRect(0, 0, TEX_W, TEX_H)
    drawPaperGrain(ctx, card.id * 131 + 7, true)

    ctx.strokeStyle = "rgba(240, 242, 236, 0.08)"
    ctx.lineWidth = 1
    for (let x = 44; x < TEX_W - 40; x += 36) {
      ctx.beginPath()
      ctx.moveTo(x, TEX_H - 135)
      ctx.lineTo(x, TEX_H - 42)
      ctx.stroke()
    }

    ctx.strokeStyle = t.blackCardInner
    ctx.lineWidth = 2
    ctx.strokeRect(22, 22, TEX_W - 44, TEX_H - 44)
    drawCornerTicks(ctx, 34, 14, "#9aa69f")

    ctx.font = `600 20px ${MONO_FONT}`
    ctx.fillStyle = "#9aa69f"
    ctx.textBaseline = "top"
    ctx.fillText(`${card.code} // ${card.pack.toUpperCase()}`, 48, 48)

    const badgeText = card.pick === 2 ? "PICK 2" : "PICK 1"
    const badgeColor = card.pick === 2 ? "#e38f7e" : "#cfd7d1"
    const badgeBg = card.pick === 2 ? "rgba(176, 74, 57, 0.34)" : "rgba(240, 242, 236, 0.1)"
    ctx.font = `700 18px ${MONO_FONT}`
    const bw = ctx.measureText(badgeText).width + 24
    ctx.fillStyle = badgeBg
    ctx.strokeStyle = badgeColor
    ctx.lineWidth = 2
    ctx.fillRect(TEX_W - 48 - bw, 42, bw, 34)
    ctx.strokeRect(TEX_W - 48 - bw, 42, bw, 34)
    ctx.fillStyle = badgeColor
    ctx.fillText(badgeText, TEX_W - 48 - bw + 12, 49)

    ctx.strokeStyle = "#414e48"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(48, 92)
    ctx.lineTo(TEX_W - 48, 92)
    ctx.stroke()

    const fontSize = card.text.length > 78 ? 30 : 34
    ctx.font = `700 ${fontSize}px ${MONO_FONT}`
    ctx.fillStyle = t.blackCardText
    const lines = wrapText(ctx, card.text, TEX_W - 96)
    let y = 124
    const lineHeight = fontSize * 1.4
    for (const line of lines) {
      ctx.fillText(line, 48, y)
      y += lineHeight
    }

    ctx.strokeStyle = "#414e48"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(48, TEX_H - 96)
    ctx.lineTo(TEX_W - 48, TEX_H - 96)
    ctx.stroke()

    drawIsometricCubeMark(ctx, 68, TEX_H - 64, 16, "#cfd7d1", "#394640")
    ctx.font = `600 17px ${MONO_FONT}`
    ctx.fillStyle = "#a5b0a9"
    ctx.fillText("PROMPT // INKLINE", 100, TEX_H - 72)

    const tex = finalizeTexture(canvas)
    this.blackFronts.set(card.id, tex)
    return tex
  }

  /**
   * Bottom-face texture oriented so that flipping a card face-down (rotation.z = PI)
   * renders "INKLINE // WHITE" right-side up to the camera!
   */
  getWhiteBack(uprightForDeckTop = false): THREE.CanvasTexture {
    if (!uprightForDeckTop && this.whiteBackTex !== null) return this.whiteBackTex
    const t = this.theme
    const { canvas, ctx } = createCanvas()

    if (!uprightForDeckTop) {
      // Three.js BoxGeometry -Y face UVs flip vertically when rotated PI around Z;
      // mirroring vertically here keeps face-down table cards 100% right-side up!
      ctx.translate(0, TEX_H)
      ctx.scale(1, -1)
    }

    ctx.fillStyle = t.paperRecessed
    ctx.fillRect(0, 0, TEX_W, TEX_H)

    ctx.strokeStyle = t.paperGrid
    ctx.lineWidth = 1.5
    for (let i = -TEX_H; i < TEX_W + TEX_H; i += 24) {
      ctx.beginPath()
      ctx.moveTo(i, 28)
      ctx.lineTo(i + TEX_H, TEX_H - 28)
      ctx.stroke()
    }

    ctx.fillStyle = t.paperCard
    ctx.fillRect(72, 160, TEX_W - 144, TEX_H - 320)
    ctx.strokeStyle = t.inkPrimary
    ctx.lineWidth = 2.5
    ctx.strokeRect(26, 26, TEX_W - 52, TEX_H - 52)
    ctx.strokeStyle = t.borderLine
    ctx.lineWidth = 2
    ctx.strokeRect(72, 160, TEX_W - 144, TEX_H - 320)
    drawCornerTicks(ctx, 40, 14, t.inkPrimary)

    drawIsometricCubeMark(ctx, TEX_W / 2, TEX_H / 2 - 22, 56, t.inkPrimary, t.paperRecessed)
    ctx.font = `700 22px ${MONO_FONT}`
    ctx.fillStyle = t.inkPrimary
    ctx.textAlign = "center"
    ctx.fillText("INKLINE", TEX_W / 2, TEX_H / 2 + 64)
    ctx.font = `600 16px ${MONO_FONT}`
    ctx.fillStyle = t.inkMuted
    ctx.fillText("WHITE // RESPONSE", TEX_W / 2, TEX_H / 2 + 96)

    const tex = finalizeTexture(canvas)
    if (!uprightForDeckTop) this.whiteBackTex = tex
    return tex
  }

  getBlackBack(): THREE.CanvasTexture {
    if (this.blackBackTex !== null) return this.blackBackTex
    const t = this.theme
    const { canvas, ctx } = createCanvas()

    ctx.fillStyle = t.blackCardBack
    ctx.fillRect(0, 0, TEX_W, TEX_H)

    ctx.strokeStyle = "#343f3a"
    ctx.lineWidth = 1.5
    for (let i = -TEX_H; i < TEX_W + TEX_H; i += 24) {
      ctx.beginPath()
      ctx.moveTo(i, 28)
      ctx.lineTo(i + TEX_H, TEX_H - 28)
      ctx.stroke()
    }

    ctx.fillStyle = t.blackCardFill
    ctx.fillRect(72, 160, TEX_W - 144, TEX_H - 320)
    ctx.strokeStyle = "#6c7a72"
    ctx.lineWidth = 2.5
    ctx.strokeRect(26, 26, TEX_W - 52, TEX_H - 52)
    ctx.strokeStyle = "#4d5a53"
    ctx.lineWidth = 2
    ctx.strokeRect(72, 160, TEX_W - 144, TEX_H - 320)
    drawCornerTicks(ctx, 40, 14, "#9aa69f")

    drawIsometricCubeMark(ctx, TEX_W / 2, TEX_H / 2 - 22, 56, "#e6eae2", "#35413b")
    ctx.font = `700 22px ${MONO_FONT}`
    ctx.fillStyle = t.blackCardText
    ctx.textAlign = "center"
    ctx.fillText("INKLINE", TEX_W / 2, TEX_H / 2 + 64)
    ctx.font = `600 16px ${MONO_FONT}`
    ctx.fillStyle = "#9aa69f"
    ctx.fillText("BLACK // PROMPT", TEX_W / 2, TEX_H / 2 + 96)

    this.blackBackTex = finalizeTexture(canvas)
    return this.blackBackTex
  }

  dispose(): void {
    for (const tex of this.whiteFronts.values()) tex.dispose()
    for (const tex of this.blackFronts.values()) tex.dispose()
    this.whiteFronts.clear()
    this.blackFronts.clear()
    this.whiteBackTex?.dispose()
    this.whiteBackTex = null
    this.blackBackTex?.dispose()
    this.blackBackTex = null
  }
}
