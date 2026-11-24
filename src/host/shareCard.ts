import { buildCompletedSentence } from "../sim/cards.ts"
import { INKLINE_THEMES, type InklineThemeId } from "../render/palette.ts"

export interface ShareCardInput {
  readonly promptText: string
  readonly answerTexts: ReadonlyArray<string>
  readonly winnerName: string
  readonly czarName: string
  readonly remark: string
  readonly winReasons: ReadonlyArray<string>
  readonly badgeText?: string
  readonly themeId?: InklineThemeId
}

const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'

/**
 * Exports a crisp 1080×680 Inkline architectural postcard PNG of a winning Black+White combo!
 */
export function downloadComboPng(input: ShareCardInput): void {
  const theme = INKLINE_THEMES[input.themeId ?? "sage"]
  const w = 1080
  const h = 680
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!

  // Paper background
  ctx.fillStyle = theme.paperBg
  ctx.fillRect(0, 0, w, h)

  // Subtle architectural grid
  ctx.strokeStyle = theme.paperGrid
  ctx.lineWidth = 1
  for (let x = 0; x <= w; x += 36) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  for (let y = 0; y <= h; y += 36) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  // Main Inkline sheet card with crisp offset shadow
  ctx.fillStyle = theme.paperShadow
  ctx.fillRect(54, 56, w - 96, h - 96)
  ctx.fillStyle = theme.paperCard
  ctx.fillRect(46, 46, w - 96, h - 96)
  ctx.strokeStyle = theme.inkPrimary
  ctx.lineWidth = 3
  ctx.strokeRect(46, 46, w - 96, h - 96)

  // Header strip
  ctx.font = `700 20px ${MONO}`
  ctx.fillStyle = theme.inkMuted
  ctx.textBaseline = "top"
  ctx.fillText("INKLINE AGAINST HUMANITY // CHRONICLE CARD", 84, 78)

  if (input.badgeText) {
    const bw = ctx.measureText(input.badgeText).width + 26
    ctx.fillStyle = theme.accentGreenWash
    ctx.strokeStyle = theme.accentGreen
    ctx.lineWidth = 2
    ctx.fillRect(w - 84 - bw, 72, bw, 36)
    ctx.strokeRect(w - 84 - bw, 72, bw, 36)
    ctx.fillStyle = theme.accentGreen
    ctx.fillText(input.badgeText, w - 84 - bw + 13, 80)
  }

  ctx.strokeStyle = theme.borderSoft
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(84, 124)
  ctx.lineTo(w - 84, 124)
  ctx.stroke()

  // Dark prompt + highlighted answer completed sentence block
  const segments = buildCompletedSentence(input.promptText, input.answerTexts)
  ctx.fillStyle = theme.blackCardFill
  ctx.fillRect(84, 150, w - 168, 290)
  ctx.strokeStyle = theme.blackCardEdge
  ctx.lineWidth = 2
  ctx.strokeRect(84, 150, w - 168, 290)

  // Word-by-word highlighted wrap inside the dark block
  const maxX = w - 120
  let curX = 118
  let curY = 186
  const lineH = 48
  ctx.font = `700 30px ${MONO}`

  for (const seg of segments) {
    const words = seg.text.split(/(\s+)/)
    for (const token of words) {
      if (token.length === 0) continue
      const tw = ctx.measureText(token).width
      if (curX + tw > maxX && token.trim().length > 0) {
        curX = 118
        curY += lineH
      }
      if (seg.isFill && token.trim().length > 0) {
        ctx.fillStyle = "rgba(126, 196, 108, 0.26)"
        ctx.fillRect(curX - 3, curY - 4, tw + 6, 38)
        ctx.fillStyle = "#c9f2bd"
      } else {
        ctx.fillStyle = theme.blackCardText
      }
      ctx.fillText(token, curX, curY)
      curX += tw
    }
  }

  // Reason pills
  let pillX = 84
  const pillY = 468
  ctx.font = `700 18px ${MONO}`
  for (const reason of input.winReasons.slice(0, 4)) {
    const rw = ctx.measureText(reason).width + 22
    ctx.fillStyle = theme.accentBlueWash
    ctx.strokeStyle = theme.accentBlueBorder
    ctx.lineWidth = 2
    ctx.fillRect(pillX, pillY, rw, 34)
    ctx.strokeRect(pillX, pillY, rw, 34)
    ctx.fillStyle = theme.accentBlue
    ctx.fillText(reason, pillX + 11, pillY + 8)
    pillX += rw + 10
  }

  // Footer credit & Czar remark
  ctx.font = `700 22px ${MONO}`
  ctx.fillStyle = theme.inkDeep
  ctx.fillText(`WINNER: ${input.winnerName.toUpperCase()}  ·  CZAR: ${input.czarName.toUpperCase()}`, 84, 526)

  ctx.font = `italic 20px ${MONO}`
  ctx.fillStyle = theme.accentGreen
  ctx.fillText(`“${input.remark}”`, 84, 564)

  const link = document.createElement("a")
  link.download = `inkline-cah-${Date.now()}.png`
  link.href = canvas.toDataURL("image/png")
  link.click()
}
