import {
  ALL_PACK_IDS,
  buildCompletedSentence,
  CARD_PACKS,
  formatCompletedSentencePlain,
  getBlackCard,
  type CardPackId
} from "../sim/cards.ts"
import type { TableView } from "../sim/inspectors.ts"
import type { GameMode, PlayerIntent } from "../sim/schema.ts"
import { INKLINE_THEMES, type InklineThemeId } from "../render/palette.ts"
import type { CameraPreset, PickedCardTarget } from "../render/tableScene.ts"
import { downloadComboPng } from "./shareCard.ts"
import {
  ACHIEVEMENTS,
  getNemesis,
  getPlayerLevel,
  getTodayDateString,
  type CareerProfile
} from "./storage.ts"

export interface LanRoomUiState {
  readonly connected: boolean
  readonly roomCode: string | null
  readonly isHost: boolean
  readonly seatIndex: number | null
  readonly members: ReadonlyArray<{ readonly name: string; readonly seat: number }>
  readonly statusMessage: string
  readonly lanUrls: ReadonlyArray<string>
}

export interface HudCallbacks {
  readonly sendIntent: (intent: PlayerIntent) => void
  readonly onCameraPreset: (preset: CameraPreset) => void
  readonly onZoomDelta: (delta: number) => void
  readonly getZoomPercent: () => number
  readonly onToggleMute: () => boolean
  readonly onHighlightSlot: (slotIndex: number | null) => void
  readonly getProfile: () => CareerProfile
  readonly onUpdateProfile: (mutate: (p: CareerProfile) => void) => void
  readonly onThemeChange: (themeId: InklineThemeId) => void
  readonly onStartDaily: () => void
  readonly getLanState: () => LanRoomUiState
  readonly onHostLanRoom: (nickname: string, maxPlayers: number, targetPoints: number, fillBots: boolean) => void
  readonly onJoinLanRoom: (roomCode: string, nickname: string) => void
  readonly onStartLanMatch: () => void
  readonly onLeaveLanRoom: () => void
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function renderCompletedSentenceHtml(promptText: string, answerTexts: ReadonlyArray<string>): string {
  return buildCompletedSentence(promptText, answerTexts)
    .map((seg) =>
      seg.isFill
        ? `<span class="joke-fill">${escapeHtml(seg.text)}</span>`
        : escapeHtml(seg.text)
    )
    .join("")
}

function shorten(text: string, max = 30): string {
  const clean = text.replace(/\.$/, "")
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export class InklineHud {
  private readonly root: HTMLElement
  private readonly callbacks: HudCallbacks

  private readonly hudLeft: HTMLDivElement
  private readonly hudRight: HTMLDivElement
  private readonly camControls: HTMLDivElement
  private readonly toolbarWrap: HTMLDivElement
  private readonly mobileHandTray: HTMLDivElement
  private readonly toolbar: HTMLDivElement
  private readonly toastEl: HTMLDivElement
  private readonly hoverPreview: HTMLDivElement
  private readonly handoffCurtain: HTMLDivElement

  private readonly newMatchDialog: HTMLDialogElement
  private readonly chronicleDialog: HTMLDialogElement
  private readonly profileDialog: HTMLDialogElement
  private readonly writeInDialog: HTMLDialogElement
  private readonly lanDialog: HTMLDialogElement
  private readonly rulesDialog: HTMLDialogElement
  private readonly matchOverDialog: HTMLDialogElement

  private currentPreset: CameraPreset = "table"
  private mobileMenuOpen = false
  private toastTimeout: number | null = null
  private lastView: TableView | null = null
  private hoveredTarget: PickedCardTarget | null = null
  private shownMatchOverKey = ""

  // Pass & Play privacy handoff tracking
  private lastHandoffKey = ""
  private handoffAcknowledgedKey = ""

  // New match charter draft state
  private draftPlayers = 4
  private draftTarget = 5
  private draftMode: GameMode = "bots"
  private draftTwists = true
  private draftTimer = 0
  private draftPacks: Array<CardPackId> = [...ALL_PACK_IDS]
  private draftNames: Array<string> = ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6", "Player 7", "Player 8"]

  constructor(root: HTMLElement, callbacks: HudCallbacks) {
    this.root = root
    this.callbacks = callbacks

    this.hudLeft = document.createElement("div")
    this.hudLeft.className = "hud left"

    this.hudRight = document.createElement("div")
    this.hudRight.className = "hud right"

    this.camControls = document.createElement("div")
    this.camControls.className = "camera-controls"

    this.toolbarWrap = document.createElement("div")
    this.toolbarWrap.className = "toolbar-wrap"

    this.toastEl = document.createElement("div")
    this.toastEl.className = "toast"
    this.toastEl.setAttribute("role", "status")

    this.mobileHandTray = document.createElement("div")
    this.mobileHandTray.className = "mobile-hand-tray"

    this.toolbar = document.createElement("div")
    this.toolbar.className = "toolbar"
    this.toolbarWrap.append(this.toastEl, this.mobileHandTray, this.toolbar)

    this.hoverPreview = document.createElement("div")
    this.hoverPreview.className = "hover-preview"

    this.handoffCurtain = document.createElement("div")
    this.handoffCurtain.className = "handoff-curtain"

    this.newMatchDialog = this.createDialog("new-match-dialog")
    this.chronicleDialog = this.createDialog("chronicle-dialog")
    this.profileDialog = this.createDialog("profile-dialog")
    this.writeInDialog = this.createDialog("write-in-dialog")
    this.lanDialog = this.createDialog("lan-dialog")
    this.rulesDialog = this.createDialog("rules-dialog")
    this.matchOverDialog = this.createDialog("match-over-dialog")

    this.root.append(
      this.hudLeft,
      this.hudRight,
      this.camControls,
      this.toolbarWrap,
      this.hoverPreview,
      this.handoffCurtain,
      this.newMatchDialog,
      this.chronicleDialog,
      this.profileDialog,
      this.writeInDialog,
      this.lanDialog,
      this.rulesDialog,
      this.matchOverDialog
    )

    this.renderTopRight(false)
    this.renderCameraControls()
    this.renderRulesDialog()
  }

  private createDialog(id: string): HTMLDialogElement {
    const dialog = document.createElement("dialog")
    dialog.id = id
    dialog.className = "ink-dialog"
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close()
    })
    return dialog
  }

  hasOpenDialog(): boolean {
    return (
      this.newMatchDialog.open ||
      this.chronicleDialog.open ||
      this.profileDialog.open ||
      this.writeInDialog.open ||
      this.lanDialog.open ||
      this.rulesDialog.open ||
      this.matchOverDialog.open ||
      this.handoffCurtain.classList.contains("open")
    )
  }

  showToast(message: string): void {
    this.toastEl.textContent = message
    this.toastEl.classList.add("show")
    if (this.toastTimeout !== null) {
      window.clearTimeout(this.toastTimeout)
    }
    this.toastTimeout = window.setTimeout(() => {
      this.toastEl.classList.remove("show")
      this.toastTimeout = null
    }, 2600)
  }

  showHoverCard(target: PickedCardTarget | null): void {
    this.hoveredTarget = target
    // Refresh the live completed-sentence stage immediately when hovering cards!
    if (this.lastView !== null) {
      this.renderHudLeft(this.lastView)
    }

    if (target === null) {
      this.hoverPreview.classList.remove("show")
      return
    }

    if (target.kind === "black") {
      this.hoverPreview.className = "hover-preview black show"
      this.hoverPreview.innerHTML = `
        <div class="hp-head"><span>${escapeHtml(target.card.code)} // ${target.card.pack.toUpperCase()}</span><span>PICK ${target.card.pick}</span></div>
        <div class="hp-body">${escapeHtml(target.card.text)}</div>
      `
      return
    }

    if (target.kind === "hand") {
      const staged = this.lastView?.viewerStagedIds.includes(target.cardId) ?? false
      const tags = target.card.tags.map((t) => `// ${t.toUpperCase()}`).join(" ")
      this.hoverPreview.className = "hover-preview show"
      this.hoverPreview.innerHTML = `
        <div class="hp-head"><span>${escapeHtml(target.card.code)} ${escapeHtml(tags)}</span><span>${staged ? "SELECTED ✓" : "CLICK TO SELECT"}</span></div>
        <div class="hp-body">${escapeHtml(target.card.text)}</div>
        <div class="hp-sub">${staged ? "Selected — click Confirm Play or click again to unselect" : "Double-click on Pick 1 to submit immediately"}</div>
      `
      return
    }

    if (!target.revealed) {
      this.hoverPreview.className = "hover-preview show"
      this.hoverPreview.innerHTML = `
        <div class="hp-head"><span>SUBMISSION #${target.slotIndex + 1}</span><span>FACE DOWN</span></div>
        <div class="hp-body">Anonymous white card bundle waiting to be flipped.</div>
        <div class="hp-sub">Click card on table to flip face-up</div>
      `
      return
    }

    const combinedText = target.cards.map((c, idx) => (target.cards.length > 1 ? `[#${idx + 1}] ${c.text}` : c.text)).join(" / ")
    const canPick = this.lastView?.canViewerPickWinner ?? false
    const showAuthor = this.lastView?.phase === "RoundResult" || this.lastView?.phase === "MatchOver"
    this.hoverPreview.className = "hover-preview show"
    this.hoverPreview.innerHTML = `
      <div class="hp-head"><span>${showAuthor ? escapeHtml(target.ownerName.toUpperCase()) : `ENTRY #${target.slotIndex + 1}`}</span><span>${target.winner ? "APPROVED ✓" : "REVEALED"}</span></div>
      <div class="hp-body">${escapeHtml(combinedText)}</div>
      ${canPick ? '<div class="hp-sub">Click to stamp APPROVED & award point</div>' : ""}
    `
  }

  private renderTopRight(muted: boolean): void {
    const profile = this.callbacks.getProfile()
    const { level } = getPlayerLevel(profile.xp)
    const today = getTodayDateString()
    const dailyDone = profile.dailyResults[today] !== undefined
    const lan = this.callbacks.getLanState()

    this.hudRight.innerHTML = ""

    const menuBtn = document.createElement("button")
    menuBtn.type = "button"
    menuBtn.className = "ink-btn mobile-menu-btn"
    menuBtn.textContent = this.mobileMenuOpen ? "Close" : "Menu"
    menuBtn.addEventListener("click", () => {
      this.mobileMenuOpen = !this.mobileMenuOpen
      this.renderTopRight(muted)
    })

    const actions = document.createElement("div")
    actions.className = `top-actions${this.mobileMenuOpen ? " mobile-open" : ""}`

    const dailyBtn = document.createElement("button")
    dailyBtn.type = "button"
    dailyBtn.className = dailyDone ? "ink-btn" : "ink-btn primary"
    dailyBtn.textContent = dailyDone ? "Daily ✓" : "Daily Sheet"
    dailyBtn.addEventListener("click", () => {
      this.mobileMenuOpen = false
      this.callbacks.onStartDaily()
    })

    const lanBtn = document.createElement("button")
    lanBtn.type = "button"
    lanBtn.className = lan.connected ? "ink-btn confirm" : "ink-btn"
    lanBtn.textContent = lan.roomCode ? `LAN: ${lan.roomCode}` : "LAN Party"
    lanBtn.addEventListener("click", () => {
      this.mobileMenuOpen = false
      this.openLanDialog()
    })

    const profBtn = document.createElement("button")
    profBtn.type = "button"
    profBtn.className = "ink-btn"
    profBtn.textContent = `Lv.${level} ${shorten(profile.nickname, 12)}`
    profBtn.addEventListener("click", () => {
      this.mobileMenuOpen = false
      this.openProfileDialog()
    })

    const chronBtn = document.createElement("button")
    chronBtn.type = "button"
    chronBtn.className = "ink-btn"
    chronBtn.textContent = "Chronicle"
    chronBtn.addEventListener("click", () => {
      this.mobileMenuOpen = false
      this.openChronicle()
    })

    const rulesBtn = document.createElement("button")
    rulesBtn.type = "button"
    rulesBtn.className = "ink-btn"
    rulesBtn.textContent = "Rules"
    rulesBtn.addEventListener("click", () => {
      this.mobileMenuOpen = false
      this.rulesDialog.showModal()
    })

    const soundBtn = document.createElement("button")
    soundBtn.type = "button"
    soundBtn.className = "ink-btn"
    soundBtn.textContent = muted ? "Sound: Off" : "Sound: On"
    soundBtn.addEventListener("click", () => {
      const nextMuted = this.callbacks.onToggleMute()
      this.renderTopRight(nextMuted)
    })

    const newBtn = document.createElement("button")
    newBtn.type = "button"
    newBtn.className = "ink-btn"
    newBtn.textContent = "New Match"
    newBtn.addEventListener("click", () => {
      this.mobileMenuOpen = false
      this.openNewMatch()
    })

    actions.append(dailyBtn, lanBtn, profBtn, chronBtn, rulesBtn, soundBtn, newBtn)
    this.hudRight.append(menuBtn, actions)
  }

  refreshTopBar(muted: boolean): void {
    this.renderTopRight(muted)
  }

  renderCameraControls(): void {
    this.camControls.innerHTML = ""
    const presets: ReadonlyArray<{ readonly id: CameraPreset; readonly label: string }> = [
      { id: "table", label: "Table" },
      { id: "hand", label: "Hand" },
      { id: "judge", label: "Judge" },
      { id: "top", label: "Top" }
    ]

    for (const preset of presets) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.textContent = preset.label
      btn.setAttribute("aria-pressed", String(this.currentPreset === preset.id))
      btn.addEventListener("click", () => {
        this.currentPreset = preset.id
        this.callbacks.onCameraPreset(preset.id)
        this.renderCameraControls()
      })
      this.camControls.append(btn)
    }

    const sep = document.createElement("span")
    sep.className = "sep"
    this.camControls.append(sep)

    const zoomOut = document.createElement("button")
    zoomOut.type = "button"
    zoomOut.textContent = "−"
    zoomOut.title = "Zoom out"
    zoomOut.addEventListener("click", () => {
      this.callbacks.onZoomDelta(0.1)
      zoomOut.nextElementSibling!.textContent = `${this.callbacks.getZoomPercent()}%`
    })

    const readout = document.createElement("output")
    readout.textContent = `${this.callbacks.getZoomPercent()}%`

    const zoomIn = document.createElement("button")
    zoomIn.type = "button"
    zoomIn.textContent = "+"
    zoomIn.title = "Zoom in"
    zoomIn.addEventListener("click", () => {
      this.callbacks.onZoomDelta(-0.1)
      readout.textContent = `${this.callbacks.getZoomPercent()}%`
    })

    this.camControls.append(zoomOut, readout, zoomIn)
  }

  syncCameraPreset(preset: CameraPreset): void {
    this.currentPreset = preset
    this.renderCameraControls()
  }

  render(view: TableView): void {
    this.lastView = view
    this.checkPassAndPlayHandoff(view)
    this.renderHudLeft(view)
    this.renderMobileHandTray(view)
    this.renderToolbar(view)

    const overKey = `${view.roundNumber}:${view.config.dailyDate ?? ""}:${view.chronicle.length}`
    if (view.phase === "MatchOver" && this.shownMatchOverKey !== overKey) {
      this.shownMatchOverKey = overKey
      this.openMatchOver(view)
    } else if (view.phase !== "MatchOver") {
      this.shownMatchOverKey = ""
    }
  }

  private checkPassAndPlayHandoff(view: TableView): void {
    if (view.config.mode !== "hotseat" || view.phase !== "Submitting") {
      this.handoffCurtain.classList.remove("open")
      return
    }
    const viewer = view.players.find((p) => p.seatIndex === view.viewerSeat)
    if (viewer === undefined || viewer.hasSubmitted || viewer.seatIndex === view.czarSeat) {
      this.handoffCurtain.classList.remove("open")
      return
    }

    const key = `r${view.roundNumber}:s${viewer.seatIndex}`
    if (key !== this.lastHandoffKey) {
      this.lastHandoffKey = key
      if (key !== this.handoffAcknowledgedKey) {
        this.handoffCurtain.innerHTML = `
          <div class="handoff-box">
            <h2>Pass Device to ${escapeHtml(viewer.name)}</h2>
            <p>Round #${view.roundNumber} · Make sure other players aren't peeking at your 7 white cards before revealing your hand.</p>
            <button type="button" class="ink-btn primary" data-reveal-hand>I am ${escapeHtml(viewer.name)} — Reveal Hand</button>
          </div>
        `
        this.handoffCurtain.querySelector("[data-reveal-hand]")?.addEventListener("click", () => {
          this.handoffAcknowledgedKey = key
          this.handoffCurtain.classList.remove("open")
        })
        this.handoffCurtain.classList.add("open")
      }
    }
  }

  private getStagePreviewAnswers(view: TableView): {
    readonly label: string
    readonly answers: ReadonlyArray<string>
  } {
    // 1. RoundResult: always feature the winning complete joke!
    if (view.phase === "RoundResult" || view.phase === "MatchOver") {
      const winnerSub = view.submissions.find((s) => s.winner)
      if (winnerSub !== undefined) {
        return {
          label: `APPROVED // ${winnerSub.ownerName.toUpperCase()}`,
          answers: winnerSub.cards.map((c) => c.text)
        }
      }
    }

    // 2. Judging: show hovered revealed submission OR the most recently revealed submission!
    if (view.phase === "Judging") {
      if (this.hoveredTarget?.kind === "submission" && this.hoveredTarget.revealed) {
        return {
          label: `ENTRY #${this.hoveredTarget.slotIndex + 1} // COMPLETE JOKE`,
          answers: this.hoveredTarget.cards.map((c) => c.text)
        }
      }
      const revealedSubs = view.submissions.filter((s) => s.revealed)
      const latest = revealedSubs[revealedSubs.length - 1]
      if (latest !== undefined) {
        return {
          label: `REVEALED #${latest.slotIndex + 1} OF ${view.submissions.length}`,
          answers: latest.cards.map((c) => c.text)
        }
      }
      return { label: "WAITING TO FLIP SUBMISSIONS", answers: [] }
    }

    // 3. Submitting: live preview of staged cards + currently hovered hand card!
    const stagedTexts = view.viewerStagedIds
      .map((id) => view.viewerHand.find((c) => c.id === id)?.text)
      .filter((t): t is string => t !== undefined)

    const pickCount = view.activeBlackCard?.pick ?? 1
    if (
      this.hoveredTarget?.kind === "hand" &&
      !view.viewerStagedIds.includes(this.hoveredTarget.cardId)
    ) {
      if (pickCount === 1) {
        return { label: "LIVE PREVIEW", answers: [this.hoveredTarget.card.text] }
      }
      if (stagedTexts.length < pickCount) {
        return { label: "LIVE PREVIEW", answers: [...stagedTexts, this.hoveredTarget.card.text] }
      }
    }

    if (stagedTexts.length > 0) {
      return { label: "YOUR PLAY PREVIEW", answers: stagedTexts }
    }

    return { label: `${view.activeBlackCard?.code ?? "PROMPT"} // PICK ${pickCount}`, answers: [] }
  }

  private renderHudLeft(view: TableView): void {
    const profile = this.callbacks.getProfile()
    const nemesis = getNemesis(profile)

    const phaseLabel =
      view.phase === "Submitting"
        ? "Submitting"
        : view.phase === "Judging"
          ? "Judging"
          : view.phase === "RoundResult"
            ? "Approved!"
            : view.phase === "MatchOver"
              ? "Match Complete"
              : "Setup"

    const phaseClass =
      view.phase === "RoundResult"
        ? "phase-badge result"
        : view.phase === "MatchOver"
          ? "phase-badge over"
          : "phase-badge"

    const timerHtml =
      view.timerRemainingSeconds !== null && view.phase === "Submitting"
        ? `<div class="cell"><span class="timer-pill ${view.timerRemainingSeconds <= 5 ? "urgent" : ""}">⏱ ${view.timerRemainingSeconds}s</span></div>`
        : ""

    const rosterHtml = view.players
      .map((p) => {
        const isCzar = p.seatIndex === view.czarSeat
        const isWinner = view.phase === "RoundResult" && view.winnerSeat === p.seatIndex
        const isViewer = p.seatIndex === view.viewerSeat
        const isNemesis = p.isBot && nemesis !== null && nemesis.name === p.name
        const classes = ["seat-chip", isViewer ? "viewer" : "", isCzar ? "czar" : "", isWinner ? "winner" : ""]
          .filter(Boolean)
          .join(" ")

        const statusHtml = isCzar
          ? `<span class="seat-role">CZAR</span>`
          : view.phase === "Submitting"
            ? p.hasSubmitted
              ? `<span class="seat-status ready">✓</span>`
              : `<span class="seat-status">…</span>`
            : ""
        const streakHtml = p.streak >= 2 ? `<span class="seat-streak">🔥${p.streak}</span>` : ""
        const nemesisHtml = isNemesis ? `<span class="seat-nemesis" title="Your Nemesis">NEM</span>` : ""

        return `
          <div class="${classes}">
            <span class="seat-name">${escapeHtml(p.name)}</span>
            ${nemesisHtml}
            ${streakHtml}
            ${statusHtml}
            <span class="seat-score">${p.score}/${view.config.targetPoints}</span>
          </div>
        `
      })
      .join("")

    // Czar Taste Banner + Completed Sentence Stage
    const tasteHtml = view.czarTaste.isBot
      ? `
        <span class="taste-banner">
          <span>${escapeHtml(view.czarTaste.name.toUpperCase())} LOVES:</span>
          ${view.czarTaste.loves.map((t) => `<span class="taste-tag">${t.toUpperCase()}</span>`).join("")}
          ${view.czarTaste.dislikes !== null ? `<span class="taste-tag dislike">− ${view.czarTaste.dislikes.toUpperCase()}</span>` : ""}
        </span>
      `
      : `<span class="taste-banner"><span>CZAR: ${escapeHtml(view.czarTaste.name.toUpperCase())} (HUMAN)</span></span>`

    const twistBadge =
      view.twist !== "none"
        ? `<span class="twist-pill">DIRECTIVE: ${view.twist.toUpperCase()}</span>`
        : ""

    const preview = this.getStagePreviewAnswers(view)
    const sentenceHtml =
      view.activeBlackCard !== null
        ? renderCompletedSentenceHtml(view.activeBlackCard.text, preview.answers)
        : ""

    const verdictHtml =
      view.phase === "RoundResult"
        ? `
          <div class="verdict-row">
            ${view.winReasons
              .map((r) => `<span class="reason-pill ${r.includes("COMBO") || r.includes("SEAL") ? "combo" : ""}">${escapeHtml(r)}</span>`)
              .join("")}
            <span class="verdict-note">“${escapeHtml(view.czarRemark)}”${view.loserReaction ? ` · ${escapeHtml(view.loserReaction)}` : ""}</span>
          </div>
        `
        : ""

    this.hudLeft.innerHTML = `
      <div class="topline">
        <div class="card">
          <div class="cell">
            <span class="brand-mark"><span class="brand-cube"></span>${view.config.mode === "daily" ? "DAILY SHEET" : "INKLINE CAH"}</span>
          </div>
          <div class="cell">
            <div class="stack">
              <small>Round</small>
              <b>#${view.roundNumber}</b>
            </div>
          </div>
          <div class="cell">
            <span class="${phaseClass}">${phaseLabel}</span>
          </div>
          ${timerHtml}
        </div>
      </div>
      <div class="card roster">${rosterHtml}</div>
      ${
        view.activeBlackCard !== null
          ? `
        <div class="joke-stage ${view.phase === "RoundResult" ? "winner-stage" : ""}">
          <div class="stage-meta">
            ${tasteHtml}
            <span>${escapeHtml(preview.label)}</span>
            ${twistBadge}
          </div>
          <div class="joke-sentence">${sentenceHtml}</div>
          ${verdictHtml}
        </div>
      `
          : ""
      }
    `
  }

  private renderMobileHandTray(view: TableView): void {
    const viewer = view.players.find((p) => p.seatIndex === view.viewerSeat)
    const canPickCards =
      view.phase === "Submitting" &&
      viewer !== undefined &&
      !viewer.isBot &&
      viewer.seatIndex !== view.czarSeat &&
      !viewer.hasSubmitted

    if (!canPickCards || view.viewerHand.length === 0) {
      this.mobileHandTray.classList.remove("show")
      this.mobileHandTray.innerHTML = ""
      return
    }

    this.mobileHandTray.classList.add("show")
    this.mobileHandTray.innerHTML = ""
    view.viewerHand.forEach((card, idx) => {
      const stagedIdx = view.viewerStagedIds.indexOf(card.id)
      const isStaged = stagedIdx !== -1
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = `mobile-card${isStaged ? " staged" : ""}`
      btn.innerHTML = `
        <div class="mc-meta">
          <span>${idx + 1}/${view.viewerHand.length} · ${card.tags[0]?.toUpperCase() ?? "NOTE"}</span>
          <span>${isStaged ? `#${stagedIdx + 1} ✓` : card.code}</span>
        </div>
        <div class="mc-text">${escapeHtml(card.text)}</div>
      `
      btn.addEventListener("click", () => {
        this.callbacks.sendIntent({ _tag: "ToggleCard", seat: view.viewerSeat, cardId: card.id })
      })
      this.mobileHandTray.append(btn)
    })
  }

  private renderToolbar(view: TableView): void {
    this.toolbar.innerHTML = ""
    const czarName = view.players.find((p) => p.seatIndex === view.czarSeat)?.name ?? "Czar"
    const viewer = view.players.find((p) => p.seatIndex === view.viewerSeat)

    if (view.phase === "Submitting") {
      if (viewer !== undefined && viewer.seatIndex === view.czarSeat) {
        const hint = document.createElement("span")
        hint.className = "hint"
        hint.innerHTML = `<b>You are Card Czar</b> — waiting for everyone to place their cards…`
        this.toolbar.append(hint)
        return
      }

      if (viewer !== undefined && viewer.hasSubmitted) {
        const hint = document.createElement("span")
        hint.className = "hint"
        hint.innerHTML = `Play locked in. Waiting for the rest of the table…`
        this.toolbar.append(hint)
        return
      }

      const pickCount = view.activeBlackCard?.pick ?? 1
      const stagedCount = view.viewerStagedIds.length

      const submitBtn = document.createElement("button")
      submitBtn.type = "button"
      submitBtn.className = "ink-btn primary"
      submitBtn.textContent = pickCount === 2 ? `Confirm Play (${stagedCount}/2)` : "Confirm Play"
      submitBtn.disabled = !view.canViewerSubmit
      submitBtn.addEventListener("click", () => {
        this.callbacks.sendIntent({ _tag: "SubmitStaged", seat: view.viewerSeat })
      })

      const sealBtn = document.createElement("button")
      sealBtn.type = "button"
      sealBtn.className = `ink-btn${view.viewerSealArmed ? " seal-armed" : ""}`
      sealBtn.textContent = view.viewerSealArmed
        ? "Ink Seal 2× Armed ✓"
        : view.viewerInkSealsLeft > 0
          ? `Ink Seal 2× (${view.viewerInkSealsLeft})`
          : "Seal Used"
      sealBtn.disabled = view.viewerInkSealsLeft <= 0
      sealBtn.title = "Gamble your Ink Seal: +2 points if you win this round!"
      sealBtn.addEventListener("click", () => {
        this.callbacks.sendIntent({ _tag: "ToggleInkSeal", seat: view.viewerSeat })
      })

      const writeInBtn = document.createElement("button")
      writeInBtn.type = "button"
      writeInBtn.className = "ink-btn"
      writeInBtn.textContent = view.viewerWriteInUsed ? "Write-In Used" : "Write-In (1)"
      writeInBtn.disabled = view.viewerWriteInUsed
      writeInBtn.title = "Inscribe your own custom punchline directly onto a 3D white card"
      writeInBtn.addEventListener("click", () => this.openWriteInDialog(view.viewerSeat))

      const redrawBtn = document.createElement("button")
      redrawBtn.type = "button"
      redrawBtn.className = "ink-btn"
      redrawBtn.textContent = viewer?.mulliganUsed ? "Redraw Used" : "Redraw (1)"
      redrawBtn.disabled = !view.canViewerRedraw
      redrawBtn.addEventListener("click", () => {
        this.callbacks.sendIntent({ _tag: "RedrawHand", seat: view.viewerSeat })
      })

      this.toolbar.append(submitBtn, sealBtn, writeInBtn, redrawBtn)
      return
    }

    if (view.phase === "Judging") {
      const czarPlayer = view.players.find((p) => p.seatIndex === view.czarSeat)
      const humanCzar = czarPlayer !== undefined && !czarPlayer.isBot

      if (!humanCzar) {
        const pace = view.config.revealPace
        const hint = document.createElement("span")
        hint.className = "hint"
        hint.innerHTML = view.allRevealed
          ? `<b>${escapeHtml(czarName)}</b> is choosing the winner…`
          : `<b>${escapeHtml(czarName)}</b> revealing (${view.submissions.filter((s) => s.revealed).length}/${view.submissions.length})`

        const nextRevealBtn = document.createElement("button")
        nextRevealBtn.type = "button"
        nextRevealBtn.className = "ink-btn primary"
        nextRevealBtn.textContent = view.allRevealed ? "Judge Now →" : "Next Reveal →"
        nextRevealBtn.addEventListener("click", () => {
          this.callbacks.sendIntent({ _tag: "AdvanceRound", fastForward: true })
        })

        const paceBtn = document.createElement("button")
        paceBtn.type = "button"
        paceBtn.className = "ink-btn"
        paceBtn.textContent = `Pace: ${pace === "normal" ? "1×" : pace === "fast" ? "2×" : "Manual"}`
        paceBtn.addEventListener("click", () => {
          const next = pace === "normal" ? "fast" : pace === "fast" ? "manual" : "normal"
          this.callbacks.sendIntent({ _tag: "SetRevealPace", pace: next })
        })

        // Quick Inkline reaction stamps!
        const reactBar = document.createElement("div")
        reactBar.className = "reaction-bar"
        for (const stamp of ["HA!", "YIKES", "STOLEN", "CHEF'S KISS"]) {
          const rb = document.createElement("button")
          rb.type = "button"
          rb.className = "ink-btn small"
          rb.textContent = stamp
          rb.addEventListener("click", () => {
            this.callbacks.sendIntent({ _tag: "SendReaction", seat: view.viewerSeat, label: stamp })
          })
          reactBar.append(rb)
        }

        this.toolbar.append(hint, nextRevealBtn, paceBtn, reactBar)
        return
      }

      if (!view.canViewerPickWinner && view.allRevealed) {
        const hint = document.createElement("span")
        hint.className = "hint"
        hint.innerHTML = `<b>${escapeHtml(czarName)}</b> is picking the winning card…`
        this.toolbar.append(hint)
        return
      }

      if (!view.allRevealed) {
        const nextBtn = document.createElement("button")
        nextBtn.type = "button"
        nextBtn.className = "ink-btn primary"
        nextBtn.textContent = "Flip Next Card"
        nextBtn.addEventListener("click", () => {
          this.callbacks.sendIntent({ _tag: "RevealSubmission", slotIndex: -2 })
        })

        const revealAll = document.createElement("button")
        revealAll.type = "button"
        revealAll.className = "ink-btn"
        revealAll.textContent = "Reveal All"
        revealAll.addEventListener("click", () => {
          this.callbacks.sendIntent({ _tag: "RevealSubmission", slotIndex: -1 })
        })

        this.toolbar.append(nextBtn, revealAll)
        return
      }

      // Human Czar Award buttons WITH actual card text + live 3D highlight on hover!
      const picks = document.createElement("div")
      picks.className = "judge-picks"
      for (const sub of view.submissions) {
        const previewText = sub.cards.map((c) => shorten(c.text, 28)).join(" / ")
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "ink-btn confirm award-btn"
        btn.textContent = `Award: ${previewText}`
        btn.title = sub.cards.map((c) => c.text).join(" / ")
        btn.addEventListener("mouseenter", () => {
          this.callbacks.onHighlightSlot(sub.slotIndex)
          this.showHoverCard({
            kind: "submission",
            slotIndex: sub.slotIndex,
            revealed: true,
            ownerName: sub.ownerName,
            winner: sub.winner,
            cards: sub.cards
          })
        })
        btn.addEventListener("mouseleave", () => {
          this.callbacks.onHighlightSlot(null)
          this.showHoverCard(null)
        })
        btn.addEventListener("click", () => {
          this.callbacks.onHighlightSlot(null)
          this.callbacks.sendIntent({ _tag: "PickWinner", slotIndex: sub.slotIndex })
        })
        picks.append(btn)
      }

      this.toolbar.append(picks)
      return
    }

    if (view.phase === "RoundResult") {
      const someoneReachedTarget =
        view.config.mode === "daily" || view.players.some((p) => p.score >= view.config.targetPoints)

      const nextBtn = document.createElement("button")
      nextBtn.type = "button"
      nextBtn.className = "ink-btn confirm"
      nextBtn.textContent = someoneReachedTarget ? "View Standings →" : "Deal Next Round →"
      nextBtn.addEventListener("click", () => {
        this.callbacks.sendIntent({ _tag: "AdvanceRound", fastForward: false })
      })

      const latest = view.chronicle[view.chronicle.length - 1]
      if (latest !== undefined) {
        const shareBtn = document.createElement("button")
        shareBtn.type = "button"
        shareBtn.className = "ink-btn"
        shareBtn.textContent = "Export PNG"
        shareBtn.addEventListener("click", () => {
          const black = getBlackCard(latest.blackCardId)
          downloadComboPng({
            promptText: black.text,
            answerTexts: latest.winningCardTexts,
            winnerName: latest.winnerName,
            czarName: latest.czarName,
            remark: latest.remark,
            winReasons: latest.winReasons,
            badgeText: latest.isComboWin ? "×1.5 COMBO!" : "APPROVED",
            themeId: this.callbacks.getProfile().theme
          })
        })
        this.toolbar.append(shareBtn)
      }

      this.toolbar.append(nextBtn)
      return
    }

    if (view.phase === "MatchOver") {
      const standingsBtn = document.createElement("button")
      standingsBtn.type = "button"
      standingsBtn.className = "ink-btn primary"
      standingsBtn.textContent = "Show Standings"
      standingsBtn.addEventListener("click", () => this.openMatchOver(view))
      this.toolbar.append(standingsBtn)
    }
  }

  private openWriteInDialog(seat: number): void {
    this.writeInDialog.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>Blank Drafting Card // Write-In</h2>
          <button type="button" class="ink-btn" data-close>Close</button>
        </div>
        <div class="sheet-body">
          <p style="margin:0;">Inscribe your own punchline directly onto a 3D white card (1 per match). In Solo mode it earns a wildcard <b>+1.4 ORIGINAL INK</b> bonus.</p>
          <input type="text" class="ink-input" maxlength="92" placeholder="Type your custom white card punchline…" data-writein-input />
        </div>
        <div class="sheet-actions">
          <button type="button" class="ink-btn" data-close>Cancel</button>
          <button type="button" class="ink-btn primary" data-commit>Ink Card onto Hand</button>
        </div>
      </div>
    `
    const input = this.writeInDialog.querySelector<HTMLInputElement>("[data-writein-input]")!
    this.writeInDialog.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => this.writeInDialog.close())
    })
    const commit = () => {
      const text = input.value.trim()
      if (text.length < 2) return
      this.callbacks.sendIntent({ _tag: "PlayWriteIn", seat, text })
      this.writeInDialog.close()
    }
    this.writeInDialog.querySelector("[data-commit]")?.addEventListener("click", commit)
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        commit()
      }
    })
    this.writeInDialog.showModal()
    input.focus()
  }

  private openNewMatch(): void {
    const profile = this.callbacks.getProfile()
    if (this.lastView !== null) {
      this.draftPlayers = this.lastView.config.playerCount
      this.draftTarget = this.lastView.config.targetPoints
      this.draftMode = this.lastView.config.mode === "hotseat" ? "hotseat" : "bots"
      this.draftTwists = this.lastView.config.twistsEnabled
      this.draftTimer = this.lastView.config.timerSeconds
      this.draftPacks = [...this.lastView.config.packs]
    } else {
      this.draftPacks = [...profile.selectedPacks]
    }
    this.draftNames[0] = profile.nickname || "You"
    this.renderNewMatchDialog()
    this.newMatchDialog.showModal()
  }

  private renderNewMatchDialog(): void {
    const nameInputsHtml =
      this.draftMode === "hotseat"
        ? `
          <div class="option-group">
            <label>Player Nicknames (${this.draftPlayers} seats)</label>
            <div class="names-grid">
              ${Array.from({ length: this.draftPlayers }, (_, idx) => `
                <input type="text" class="ink-input" maxlength="16" value="${escapeHtml(this.draftNames[idx] ?? `Player ${idx + 1}`)}" data-seat-name="${idx}" placeholder="Player ${idx + 1}" />
              `).join("")}
            </div>
          </div>
        `
        : `
          <div class="option-group">
            <label>Your Nickname</label>
            <input type="text" class="ink-input" maxlength="16" value="${escapeHtml(this.draftNames[0] ?? "You")}" data-seat-name="0" placeholder="Enter your nickname…" />
          </div>
        `

    this.newMatchDialog.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>Match Charter // Configure Table</h2>
          <button type="button" class="ink-btn" data-close>Close</button>
        </div>
        <div class="sheet-body">
          <div class="option-group">
            <label>Mode</label>
            <div class="choices">
              <button type="button" class="ink-btn ${this.draftMode === "bots" ? "active" : ""}" data-mode="bots">Solo vs Bots</button>
              <button type="button" class="ink-btn ${this.draftMode === "hotseat" ? "active" : ""}" data-mode="hotseat">Pass &amp; Play (3–8)</button>
            </div>
          </div>
          ${nameInputsHtml}
          <div class="option-group">
            <label>Players Around Table (3 to 8)</label>
            <div class="choices">
              ${[3, 4, 5, 6, 7, 8].map((n) => `<button type="button" class="ink-btn ${this.draftPlayers === n ? "active" : ""}" data-players="${n}">${n}</button>`).join("")}
            </div>
          </div>
          <div class="option-group">
            <label>Target Trophy Points</label>
            <div class="choices">
              ${[3, 5, 7, 10].map((t) => `<button type="button" class="ink-btn ${this.draftTarget === t ? "active" : ""}" data-target="${t}">${t} pts</button>`).join("")}
            </div>
          </div>
          <div class="option-group">
            <label>Themed Card Packs (200 Black / 560 White · Toggle 18+ Packs On/Off)</label>
            <div class="choices">
              ${CARD_PACKS.map((pack) => `
                <button type="button" class="ink-btn ${this.draftPacks.includes(pack.id) ? (pack.mature ? "active mature-pack" : "active") : ""}" data-pack="${pack.id}" title="${escapeHtml(pack.description)}">${escapeHtml(pack.label)}</button>
              `).join("")}
            </div>
          </div>
          <div class="option-group">
            <label>Table Rules &amp; Pacing</label>
            <div class="choices">
              <button type="button" class="ink-btn ${this.draftTwists ? "active" : ""}" data-twists>Drafting Directives: ${this.draftTwists ? "On" : "Off"}</button>
              <button type="button" class="ink-btn ${this.draftTimer > 0 ? "active" : ""}" data-timer>Round Timer: ${this.draftTimer > 0 ? `${this.draftTimer}s` : "Off"}</button>
            </div>
          </div>
        </div>
        <div class="sheet-actions">
          <button type="button" class="ink-btn" data-close>Cancel</button>
          <button type="button" class="ink-btn primary" data-start>Deal Fresh Table</button>
        </div>
      </div>
    `

    this.newMatchDialog.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => this.newMatchDialog.close())
    })
    this.newMatchDialog.querySelectorAll<HTMLInputElement>("[data-seat-name]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = Number(inp.dataset.seatName ?? 0)
        this.draftNames[idx] = inp.value
      })
    })
    this.newMatchDialog.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.draftMode = btn.dataset.mode === "hotseat" ? "hotseat" : "bots"
        this.renderNewMatchDialog()
      })
    })
    this.newMatchDialog.querySelectorAll<HTMLButtonElement>("[data-players]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.draftPlayers = Number(btn.dataset.players ?? 4)
        this.renderNewMatchDialog()
      })
    })
    this.newMatchDialog.querySelectorAll<HTMLButtonElement>("[data-target]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.draftTarget = Number(btn.dataset.target ?? 5)
        this.renderNewMatchDialog()
      })
    })
    this.newMatchDialog.querySelectorAll<HTMLButtonElement>("[data-pack]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.pack as CardPackId
        if (this.draftPacks.includes(id)) {
          if (this.draftPacks.length > 1) {
            this.draftPacks = this.draftPacks.filter((p) => p !== id)
          }
        } else {
          this.draftPacks = [...this.draftPacks, id]
        }
        this.renderNewMatchDialog()
      })
    })
    this.newMatchDialog.querySelector("[data-twists]")?.addEventListener("click", () => {
      this.draftTwists = !this.draftTwists
      this.renderNewMatchDialog()
    })
    this.newMatchDialog.querySelector("[data-timer]")?.addEventListener("click", () => {
      this.draftTimer = this.draftTimer === 0 ? 20 : 0
      this.renderNewMatchDialog()
    })
    this.newMatchDialog.querySelector("[data-start]")?.addEventListener("click", () => {
      const cleanNick = (this.draftNames[0] ?? "You").trim() || "You"
      this.callbacks.onUpdateProfile((p) => {
        p.nickname = cleanNick
        p.selectedPacks = [...this.draftPacks]
      })
      const names = Array.from({ length: this.draftPlayers }, (_, i) =>
        (this.draftNames[i] ?? (i === 0 ? cleanNick : `Player ${i + 1}`)).trim() || `Player ${i + 1}`
      )
      const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
      this.lastHandoffKey = ""
      this.handoffAcknowledgedKey = ""
      this.callbacks.sendIntent({
        _tag: "NewMatch",
        playerCount: this.draftPlayers,
        targetPoints: this.draftTarget,
        mode: this.draftMode,
        seed,
        packs: this.draftPacks,
        playerNames: names,
        twistsEnabled: this.draftTwists,
        timerSeconds: this.draftTimer,
        dailyDate: null,
        customWhitePool: this.callbacks.getProfile().customWhiteCards
      })
      this.newMatchDialog.close()
    })
  }

  private openProfileDialog(): void {
    const profile = this.callbacks.getProfile()
    const { level, currentXp, neededXp } = getPlayerLevel(profile.xp)
    const nemesis = getNemesis(profile)

    const themesHtml = Object.values(INKLINE_THEMES)
      .map((theme) => {
        const unlocked = level >= theme.unlockLevel
        const active = profile.theme === theme.id
        return `
          <button type="button" class="ink-btn ${active ? "active" : ""}" data-theme="${theme.id}" ${unlocked ? "" : "disabled"}>
            ${escapeHtml(theme.name)}${unlocked ? "" : ` (Lv.${theme.unlockLevel})`}
          </button>
        `
      })
      .join("")

    const achHtml = ACHIEVEMENTS.map((a) => {
      const done = profile.achievements.includes(a.id)
      return `
        <div class="standing-row ${done ? "top" : ""}">
          <span><b>${done ? "✓" : "○"} ${escapeHtml(a.title)}</b> — ${escapeHtml(a.description)}</span>
        </div>
      `
    }).join("")

    const customListHtml =
      profile.customWhiteCards.length === 0
        ? `<span style="color:var(--ink-muted)">No custom cards yet. Add inside jokes below!</span>`
        : profile.customWhiteCards
            .map(
              (text, idx) => `
              <div class="standing-row">
                <span>${escapeHtml(text)}</span>
                <button type="button" class="ink-btn small" data-del-custom="${idx}">Remove</button>
              </div>
            `
            )
            .join("")

    this.profileDialog.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>Draftsman Profile // Lv.${level} (${profile.xp} XP)</h2>
          <button type="button" class="ink-btn" data-close>Close</button>
        </div>
        <div class="sheet-body">
          <div class="option-group">
            <label>Nickname</label>
            <div style="display:flex;gap:6px;">
              <input type="text" class="ink-input" maxlength="16" value="${escapeHtml(profile.nickname)}" data-nick-input />
              <button type="button" class="ink-btn primary" data-save-nick>Save</button>
            </div>
          </div>

          <div class="option-group">
            <label>Level Progress (${currentXp}/${neededXp} XP) · ${profile.roundsWon} Rounds Won · ${profile.matchesWon} Matches · Best Streak: ${profile.bestStreak}${nemesis ? ` · Nemesis: ${escapeHtml(nemesis.name)}` : ""}</label>
            <div class="xp-bar"><div class="xp-bar-fill" style="width:${Math.round((currentXp / neededXp) * 100)}%"></div></div>
          </div>

          <div class="option-group">
            <label>Unlockable Inkline Drafting Themes</label>
            <div class="choices">${themesHtml}</div>
          </div>

          <div class="option-group">
            <label>Custom Deck Creator (Saved Locally)</label>
            <div style="display:flex;gap:6px;">
              <input type="text" class="ink-input" maxlength="92" placeholder="Add a custom White Response card…" data-custom-input />
              <button type="button" class="ink-btn primary" data-add-custom>Add</button>
            </div>
            <div class="standings-grid">${customListHtml}</div>
          </div>

          <div class="option-group">
            <label>Achievements (${profile.achievements.length}/${ACHIEVEMENTS.length})</label>
            <div class="standings-grid">${achHtml}</div>
          </div>
        </div>
        <div class="sheet-actions">
          <button type="button" class="ink-btn primary" data-close>Done</button>
        </div>
      </div>
    `

    this.profileDialog.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => this.profileDialog.close())
    })
    const nickInp = this.profileDialog.querySelector<HTMLInputElement>("[data-nick-input]")!
    this.profileDialog.querySelector("[data-save-nick]")?.addEventListener("click", () => {
      const next = nickInp.value.trim() || "You"
      this.callbacks.onUpdateProfile((p) => {
        p.nickname = next
      })
      this.showToast(`Nickname saved as ${next}.`)
      this.openProfileDialog()
    })
    this.profileDialog.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.theme as InklineThemeId
        this.callbacks.onThemeChange(id)
        this.openProfileDialog()
      })
    })
    const customInp = this.profileDialog.querySelector<HTMLInputElement>("[data-custom-input]")!
    this.profileDialog.querySelector("[data-add-custom]")?.addEventListener("click", () => {
      const txt = customInp.value.trim()
      if (txt.length < 2) return
      this.callbacks.onUpdateProfile((p) => {
        p.customWhiteCards = [...p.customWhiteCards, txt]
      })
      this.showToast("Custom white card added to your deck!")
      this.openProfileDialog()
    })
    this.profileDialog.querySelectorAll<HTMLButtonElement>("[data-del-custom]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.delCustom ?? -1)
        this.callbacks.onUpdateProfile((p) => {
          p.customWhiteCards = p.customWhiteCards.filter((_, i) => i !== idx)
        })
        this.openProfileDialog()
      })
    })

    if (!this.profileDialog.open) this.profileDialog.showModal()
  }

  private openChronicle(tab: "match" | "hall" = "match"): void {
    const entries = this.lastView?.chronicle ?? []
    const profile = this.callbacks.getProfile()
    const hof = profile.hallOfFame

    const listHtml =
      tab === "match"
        ? entries.length === 0
          ? `<p style="color:var(--ink-muted);margin:0;">No rounds awarded yet in this match.</p>`
          : entries
              .slice()
              .reverse()
              .map((entry, idx) => {
                const black = getBlackCard(entry.blackCardId)
                const comboId = `r${entry.roundNumber}:${entry.blackCardId}:${entry.winningCardTexts.join("|")}`
                const isSaved = hof.some((h) => h.id === comboId)
                return `
                  <div class="chronicle-item">
                    <div class="c-meta">
                      <span>ROUND #${entry.roundNumber} // WON BY ${escapeHtml(entry.winnerName.toUpperCase())}</span>
                      <span>CZAR: ${escapeHtml(entry.czarName)}</span>
                    </div>
                    <div class="c-sentence">${renderCompletedSentenceHtml(black.text, entry.winningCardTexts)}</div>
                    <div class="c-remark">“${escapeHtml(entry.remark)}”</div>
                    <div class="c-actions">
                      <button type="button" class="ink-btn small" data-save-hof="${idx}">${isSaved ? "★ In Hall of Fame" : "☆ Save to Hall of Fame"}</button>
                      <button type="button" class="ink-btn small" data-png-match="${idx}">Export PNG</button>
                    </div>
                  </div>
                `
              })
              .join("")
        : hof.length === 0
          ? `<p style="color:var(--ink-muted);margin:0;">Your Hall of Fame is empty. Save your funniest winning combos from any match!</p>`
          : hof
              .map(
                (item, idx) => `
                <div class="chronicle-item">
                  <div class="c-meta">
                    <span>SAVED ${escapeHtml(item.savedAt)} // ${escapeHtml(item.winnerName.toUpperCase())}</span>
                    <span>CZAR: ${escapeHtml(item.czarName)}</span>
                  </div>
                  <div class="c-sentence">${renderCompletedSentenceHtml(item.promptText, item.answerTexts)}</div>
                  <div class="c-remark">“${escapeHtml(item.remark)}”</div>
                  <div class="c-actions">
                    <button type="button" class="ink-btn small" data-png-hof="${idx}">Export PNG</button>
                    <button type="button" class="ink-btn small" data-del-hof="${idx}">Remove</button>
                  </div>
                </div>
              `
              )
              .join("")

    this.chronicleDialog.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>Chronicle &amp; Hall of Fame</h2>
          <button type="button" class="ink-btn" data-close>Close</button>
        </div>
        <div class="sheet-body">
          <div class="choices">
            <button type="button" class="ink-btn ${tab === "match" ? "active" : ""}" data-tab="match">This Match (${entries.length})</button>
            <button type="button" class="ink-btn ${tab === "hall" ? "active" : ""}" data-tab="hall">★ Hall of Fame (${hof.length})</button>
          </div>
          <div class="chronicle-list">${listHtml}</div>
        </div>
        <div class="sheet-actions">
          <button type="button" class="ink-btn primary" data-close>Done</button>
        </div>
      </div>
    `

    this.chronicleDialog.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => this.chronicleDialog.close())
    })
    this.chronicleDialog.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.openChronicle(btn.dataset.tab === "hall" ? "hall" : "match")
      })
    })

    const reversedEntries = entries.slice().reverse()
    this.chronicleDialog.querySelectorAll<HTMLButtonElement>("[data-save-hof]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entry = reversedEntries[Number(btn.dataset.saveHof ?? 0)]
        if (entry === undefined) return
        const black = getBlackCard(entry.blackCardId)
        const comboId = `r${entry.roundNumber}:${entry.blackCardId}:${entry.winningCardTexts.join("|")}`
        this.callbacks.onUpdateProfile((p) => {
          if (!p.hallOfFame.some((h) => h.id === comboId)) {
            p.hallOfFame = [
              {
                id: comboId,
                savedAt: getTodayDateString(),
                promptText: black.text,
                answerTexts: entry.winningCardTexts,
                winnerName: entry.winnerName,
                czarName: entry.czarName,
                remark: entry.remark,
                winReasons: entry.winReasons
              },
              ...p.hallOfFame
            ]
          }
        })
        this.showToast("Saved to Hall of Fame ★")
        this.openChronicle("match")
      })
    })

    this.chronicleDialog.querySelectorAll<HTMLButtonElement>("[data-png-match]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entry = reversedEntries[Number(btn.dataset.pngMatch ?? 0)]
        if (entry === undefined) return
        downloadComboPng({
          promptText: getBlackCard(entry.blackCardId).text,
          answerTexts: entry.winningCardTexts,
          winnerName: entry.winnerName,
          czarName: entry.czarName,
          remark: entry.remark,
          winReasons: entry.winReasons,
          badgeText: entry.isComboWin ? "×1.5 COMBO!" : "APPROVED",
          themeId: this.callbacks.getProfile().theme
        })
      })
    })

    this.chronicleDialog.querySelectorAll<HTMLButtonElement>("[data-png-hof]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = hof[Number(btn.dataset.pngHof ?? 0)]
        if (item === undefined) return
        downloadComboPng({
          promptText: item.promptText,
          answerTexts: item.answerTexts,
          winnerName: item.winnerName,
          czarName: item.czarName,
          remark: item.remark,
          winReasons: item.winReasons,
          badgeText: "HALL OF FAME",
          themeId: this.callbacks.getProfile().theme
        })
      })
    })

    this.chronicleDialog.querySelectorAll<HTMLButtonElement>("[data-del-hof]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.delHof ?? -1)
        this.callbacks.onUpdateProfile((p) => {
          p.hallOfFame = p.hallOfFame.filter((_, i) => i !== idx)
        })
        this.openChronicle("hall")
      })
    })

    if (!this.chronicleDialog.open) this.chronicleDialog.showModal()
  }

  openLanDialog(): void {
    const lan = this.callbacks.getLanState()
    const profile = this.callbacks.getProfile()

    const membersHtml =
      lan.members.length === 0
        ? ""
        : `
          <div class="standings-grid">
            ${lan.members.map((m) => `<div class="standing-row"><span>Seat #${m.seat + 1} — <b>${escapeHtml(m.name)}</b></span></div>`).join("")}
          </div>
        `

    const urlsHtml =
      lan.lanUrls.length > 0
        ? `<div style="font-size:11px;color:var(--ink-muted)">Friends on same Wi-Fi open: <b>${lan.lanUrls.map(escapeHtml).join(" · ")}</b></div>`
        : ""

    const bodyHtml = lan.connected && lan.roomCode
      ? `
        <div class="lan-banner">
          <div style="font-size:11px;color:var(--ink-muted)">CONNECTED LAN ROOM</div>
          <div class="lan-code">${escapeHtml(lan.roomCode)}</div>
          ${urlsHtml}
          <div style="font-size:11.5px">${escapeHtml(lan.statusMessage)}</div>
        </div>
        ${membersHtml}
        <div class="choices">
          ${lan.isHost ? `<button type="button" class="ink-btn confirm" data-lan-start>Deal &amp; Start LAN Match</button>` : ""}
          <button type="button" class="ink-btn" data-lan-leave>Leave Room</button>
        </div>
      `
      : `
        <p style="margin:0;">Play with <b>3 to 8 friends on the same Wi-Fi / LAN</b> (phones, tablets, laptops) with zero internet needed. Start the LAN host with <code>npm run lan</code> (or double-click <code>start-lan.bat</code> in the portable package).</p>
        <div class="option-group">
          <label>Your Nickname</label>
          <input type="text" class="ink-input" maxlength="16" value="${escapeHtml(profile.nickname)}" data-lan-nick />
        </div>
        <div class="option-group">
          <label>Host a New LAN Room</label>
          <div class="choices">
            <button type="button" class="ink-btn primary" data-lan-host="4">Host (4 Seats)</button>
            <button type="button" class="ink-btn primary" data-lan-host="6">Host (6 Seats)</button>
            <button type="button" class="ink-btn primary" data-lan-host="8">Host (8 Seats)</button>
          </div>
        </div>
        <div class="option-group">
          <label>Or Join Existing Room Code</label>
          <div style="display:flex;gap:6px;">
            <input type="text" class="ink-input" maxlength="6" placeholder="e.g. INK4" style="text-transform:uppercase" data-lan-code />
            <button type="button" class="ink-btn confirm" data-lan-join>Join Room</button>
          </div>
        </div>
        ${lan.statusMessage ? `<div style="font-size:11.5px;color:var(--red)">${escapeHtml(lan.statusMessage)}</div>` : ""}
      `

    this.lanDialog.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>Same-Network (LAN) Party Table</h2>
          <button type="button" class="ink-btn" data-close>Close</button>
        </div>
        <div class="sheet-body">${bodyHtml}</div>
        <div class="sheet-actions">
          <button type="button" class="ink-btn" data-close>Close</button>
        </div>
      </div>
    `

    this.lanDialog.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => this.lanDialog.close())
    })
    const nickInp = this.lanDialog.querySelector<HTMLInputElement>("[data-lan-nick]")
    this.lanDialog.querySelectorAll<HTMLButtonElement>("[data-lan-host]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nick = nickInp?.value.trim() || profile.nickname || "Host"
        this.callbacks.onUpdateProfile((p) => {
          p.nickname = nick
        })
        this.callbacks.onHostLanRoom(nick, Number(btn.dataset.lanHost ?? 6), 5, true)
      })
    })
    const codeInp = this.lanDialog.querySelector<HTMLInputElement>("[data-lan-code]")
    this.lanDialog.querySelector("[data-lan-join]")?.addEventListener("click", () => {
      const nick = nickInp?.value.trim() || profile.nickname || "Guest"
      const code = (codeInp?.value ?? "").trim().toUpperCase()
      if (code.length < 3) return
      this.callbacks.onUpdateProfile((p) => {
        p.nickname = nick
      })
      this.callbacks.onJoinLanRoom(code, nick)
    })
    this.lanDialog.querySelector("[data-lan-start]")?.addEventListener("click", () => {
      this.callbacks.onStartLanMatch()
      this.lanDialog.close()
    })
    this.lanDialog.querySelector("[data-lan-leave]")?.addEventListener("click", () => {
      this.callbacks.onLeaveLanRoom()
      this.openLanDialog()
    })

    if (!this.lanDialog.open) this.lanDialog.showModal()
  }

  refreshLanDialogIfOpen(): void {
    if (this.lanDialog.open) {
      this.openLanDialog()
    }
  }

  private renderRulesDialog(): void {
    this.rulesDialog.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>Inkline Against Humanity // Rules &amp; Controls</h2>
          <button type="button" class="ink-btn" data-close>Close</button>
        </div>
        <div class="sheet-body">
          <p style="margin:0;"><b>Read the Room:</b> Every Bot Czar prints their loved &amp; disliked tags on the prompt banner (e.g. <b>LOVES ABSURD &amp; SOCIAL · − DRY</b>). Pairing both loved tags on a Pick-2 scores a <b>×1.5 COMBO!</b></p>
          <p style="margin:0;"><b>Tactical Tools:</b> Use your <b>Ink Seal 2×</b> (1/match) to wager for double trophy points, <b>Write-In (1)</b> to inscribe your own custom 3D white card, or <b>Redraw (1)</b> for a fresh hand.</p>
          <p style="margin:0;"><b>Modes:</b> Solo vs Bots (3–8 players), Pass &amp; Play (with privacy handoff curtains), Daily Drafting Sheet, and Same-Network LAN Party.</p>
          <p style="margin:0;"><b>Controls:</b> Click 3D cards to toggle · Double-click Pick 1 to submit · <b>1–7</b> select cards · <b>Enter</b> confirms / advances · <b>R</b> resets camera · Drag mat to orbit.</p>
        </div>
        <div class="sheet-actions">
          <button type="button" class="ink-btn primary" data-close>Back to Table</button>
        </div>
      </div>
    `
    this.rulesDialog.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => this.rulesDialog.close())
    })
  }

  private openMatchOver(view: TableView): void {
    const sorted = view.players.slice().sort((a, b) => b.score - a.score)
    const champion = sorted[0]
    const isDaily = view.config.mode === "daily"
    const latest = view.chronicle[view.chronicle.length - 1]

    const rowsHtml = sorted
      .map(
        (p, idx) => `
          <div class="standing-row ${idx === 0 ? "top" : ""}">
            <span>#${idx + 1} ${escapeHtml(p.name)}</span>
            <span>${p.score} ${p.score === 1 ? "Black Card" : "Black Cards"}</span>
          </div>
        `
      )
      .join("")

    const highlightHtml =
      latest !== undefined
        ? `
          <div class="chronicle-item">
            <div class="c-meta"><span>${isDaily ? `DAILY SHEET ${view.config.dailyDate ?? ""}` : `DECIDING PLAY // ROUND #${latest.roundNumber}`}</span><span>${escapeHtml(latest.winnerName)}</span></div>
            <div class="c-sentence">${renderCompletedSentenceHtml(getBlackCard(latest.blackCardId).text, latest.winningCardTexts)}</div>
            <div class="c-remark">“${escapeHtml(latest.remark)}”</div>
          </div>
        `
        : ""

    this.matchOverDialog.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>${isDaily ? `Daily Sheet ${view.config.dailyDate ?? ""} Complete` : `Match Complete // ${escapeHtml(champion?.name ?? "Champion")} Wins!`}</h2>
          <button type="button" class="ink-btn" data-close>Close</button>
        </div>
        <div class="sheet-body">
          <div class="standings-grid">${rowsHtml}</div>
          ${highlightHtml}
        </div>
        <div class="sheet-actions">
          ${isDaily && latest !== undefined ? `<button type="button" class="ink-btn" data-copy-daily>Copy Share Text</button>` : ""}
          ${latest !== undefined ? `<button type="button" class="ink-btn" data-export-png>Export PNG</button>` : ""}
          <button type="button" class="ink-btn" data-chronicle>Chronicle</button>
          <button type="button" class="ink-btn primary" data-rematch>One-Click Rematch</button>
        </div>
      </div>
    `

    this.matchOverDialog.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => this.matchOverDialog.close())
    })
    this.matchOverDialog.querySelector("[data-copy-daily]")?.addEventListener("click", () => {
      if (latest === undefined) return
      const black = getBlackCard(latest.blackCardId)
      const full = formatCompletedSentencePlain(black.text, latest.winningCardTexts)
      const won = latest.winnerSeat === 0
      const shareText = `Inkline Against Humanity — Daily ${view.config.dailyDate ?? ""}\n${won ? `✓ Beat ${latest.czarName}!` : `✗ ${latest.czarName} chose ${latest.winnerName}`}\n“${full}”`
      void navigator.clipboard?.writeText(shareText)
      this.showToast("Daily result copied to clipboard!")
    })
    this.matchOverDialog.querySelector("[data-export-png]")?.addEventListener("click", () => {
      if (latest === undefined) return
      downloadComboPng({
        promptText: getBlackCard(latest.blackCardId).text,
        answerTexts: latest.winningCardTexts,
        winnerName: latest.winnerName,
        czarName: latest.czarName,
        remark: latest.remark,
        winReasons: latest.winReasons,
        badgeText: isDaily ? `DAILY ${view.config.dailyDate ?? ""}` : "MATCH WINNER",
        themeId: this.callbacks.getProfile().theme
      })
    })
    this.matchOverDialog.querySelector("[data-chronicle]")?.addEventListener("click", () => {
      this.matchOverDialog.close()
      this.openChronicle("match")
    })
    this.matchOverDialog.querySelector("[data-rematch]")?.addEventListener("click", () => {
      const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
      this.callbacks.sendIntent({
        _tag: "NewMatch",
        playerCount: view.config.playerCount,
        targetPoints: isDaily ? 5 : view.config.targetPoints,
        mode: isDaily ? "bots" : view.config.mode,
        seed,
        packs: view.config.packs,
        playerNames: view.config.playerNames,
        twistsEnabled: view.config.twistsEnabled,
        timerSeconds: view.config.timerSeconds,
        dailyDate: null,
        customWhitePool: this.callbacks.getProfile().customWhiteCards
      })
      this.matchOverDialog.close()
    })
    this.matchOverDialog.showModal()
  }
}
