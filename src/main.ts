import "./host/styles.css"
import { FixedLoop } from "@typeonce/ritmo"
import { InklineAudio } from "./host/audio.ts"
import { InklineHud } from "./host/hud.ts"
import { LanClient } from "./host/lanClient.ts"
import {
  getTodayDateString,
  loadProfile,
  saveProfile,
  type CareerProfile
} from "./host/storage.ts"
import { applyThemeToDocument, INKLINE_THEMES, type InklineThemeId } from "./render/palette.ts"
import { InklineTableScene, type PickedCardTarget } from "./render/tableScene.ts"
import {
  getBlackCard,
  Intent,
  makeSimulation,
  seedFromDateString,
  setupSchedule,
  STEP,
  TableViewInspector,
  updateSchedule,
  type PlayerIntent,
  type TableView
} from "./sim/index.ts"

const appRoot = document.getElementById("app")
if (appRoot === null) {
  throw new Error("Missing #app container")
}

let profile: CareerProfile = loadProfile()
applyThemeToDocument(INKLINE_THEMES[profile.theme])

const initialSeed = (Date.now() ^ 0x51a7f3) >>> 0
const runtime = makeSimulation({
  seed: initialSeed,
  playerCount: 4,
  targetPoints: 5,
  mode: "bots",
  packs: profile.selectedPacks,
  playerNames: [profile.nickname || "You"],
  twistsEnabled: true,
  timerSeconds: 0,
  customWhitePool: profile.customWhiteCards
})

const setupResult = runtime.tick(setupSchedule)
if (!setupResult.ok) {
  console.error("Setup schedule failed:", setupResult.error)
}

const audio = new InklineAudio()
let lastSeenCueSeq = 0
let remoteLanView: TableView | null = null

// Unlock Web Audio cleanly on first user gesture (zero browser autoplay warning!)
const unlockAudioOnce = () => {
  audio.unlock()
}
window.addEventListener("pointerdown", unlockAudioOnce, { once: true })
window.addEventListener("keydown", unlockAudioOnce, { once: true })

function getActiveView(): TableView {
  if (lanClient.isInActiveMatch() && remoteLanView !== null) {
    return remoteLanView
  }
  return runtime.inspect(TableViewInspector)
}

function sendIntent(intent: PlayerIntent): void {
  audio.unlock()
  if (intent._tag === "NewMatch") {
    lanClient.disconnect()
    remoteLanView = null
    lastSeenCueSeq = 0
    scene.clearHover()
  }
  if (lanClient.isInActiveMatch()) {
    lanClient.sendIntent(intent)
    return
  }
  runtime.send(Intent, intent)
}

const lanClient = new LanClient({
  onRoomState(state) {
    if (!state.connected) {
      remoteLanView = null
    }
    hud.refreshTopBar(audio.isMuted())
    hud.refreshLanDialogIfOpen()
  },
  onTableView(view) {
    remoteLanView = view
  }
})

const scene = new InklineTableScene(appRoot, {
  onHover(target: PickedCardTarget | null) {
    hud.showHoverCard(target)
  },
  onClick(target: PickedCardTarget) {
    const view = getActiveView()
    if (target.kind === "hand" && view.phase === "Submitting") {
      sendIntent({ _tag: "ToggleCard", seat: view.viewerSeat, cardId: target.cardId })
      return
    }
    if (target.kind === "submission" && view.phase === "Judging") {
      if (!target.revealed) {
        sendIntent({ _tag: "RevealSubmission", slotIndex: target.slotIndex })
      } else if (view.canViewerPickWinner) {
        sendIntent({ _tag: "PickWinner", slotIndex: target.slotIndex })
      }
    }
  },
  onDoubleClick(target: PickedCardTarget) {
    const view = getActiveView()
    if (
      target.kind === "hand" &&
      view.phase === "Submitting" &&
      view.activeBlackCard?.pick === 1 &&
      view.viewerSeat !== view.czarSeat
    ) {
      if (!view.viewerStagedIds.includes(target.cardId)) {
        sendIntent({ _tag: "ToggleCard", seat: view.viewerSeat, cardId: target.cardId })
      }
      sendIntent({ _tag: "SubmitStaged", seat: view.viewerSeat })
    }
  }
})
scene.setTheme(INKLINE_THEMES[profile.theme])

const hud = new InklineHud(appRoot, {
  sendIntent,
  onCameraPreset(preset) {
    scene.setCameraPreset(preset)
  },
  onZoomDelta(delta) {
    scene.adjustZoom(delta)
  },
  getZoomPercent() {
    return scene.getZoomPercent()
  },
  onToggleMute() {
    const muted = audio.toggleMute()
    if (!muted) audio.unlock()
    return muted
  },
  onHighlightSlot(slotIndex) {
    scene.setExternalHighlightSlot(slotIndex)
  },
  getProfile() {
    return profile
  },
  onUpdateProfile(mutate) {
    mutate(profile)
    saveProfile(profile)
    hud.refreshTopBar(audio.isMuted())
  },
  onThemeChange(themeId: InklineThemeId) {
    profile.theme = themeId
    saveProfile(profile)
    const palette = INKLINE_THEMES[themeId]
    applyThemeToDocument(palette)
    scene.setTheme(palette)
    hud.showToast(`Theme switched to ${palette.name}.`)
  },
  onStartDaily() {
    const today = getTodayDateString()
    const dailySeed = seedFromDateString(`inkline-daily-${today}`)
    sendIntent({
      _tag: "NewMatch",
      playerCount: 4,
      targetPoints: 1,
      mode: "daily",
      seed: dailySeed,
      packs: ["core", "studio", "office", "absurd"],
      playerNames: [profile.nickname || "You"],
      twistsEnabled: false,
      timerSeconds: 0,
      dailyDate: today,
      customWhitePool: []
    })
    hud.showToast(`Daily Sheet ${today} dealt — same cards for everyone today!`)
  },
  getLanState() {
    return lanClient.getState()
  },
  onHostLanRoom(nickname, maxPlayers, targetPoints, fillBots) {
    lanClient.hostRoom(nickname, maxPlayers, targetPoints, fillBots)
  },
  onJoinLanRoom(roomCode, nickname) {
    lanClient.joinRoom(roomCode, nickname)
  },
  onStartLanMatch() {
    lanClient.startMatch()
  },
  onLeaveLanRoom() {
    lanClient.disconnect()
    remoteLanView = null
  }
})

// Keyboard shortcuts (non-interfering: never calls preventDefault on window)
window.addEventListener("keydown", (event) => {
  if (hud.hasOpenDialog()) return
  const target = event.target
  if (
    target instanceof HTMLElement &&
    (target.tagName === "BUTTON" || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
  ) {
    return
  }

  const key = event.key.toLowerCase()
  const view = getActiveView()

  if (key >= "1" && key <= "7") {
    const idx = Number(key) - 1
    const card = view.viewerHand[idx]
    if (card !== undefined && view.phase === "Submitting") {
      sendIntent({ _tag: "ToggleCard", seat: view.viewerSeat, cardId: card.id })
    }
  } else if (key === "enter") {
    if (view.phase === "Submitting" && view.canViewerSubmit) {
      sendIntent({ _tag: "SubmitStaged", seat: view.viewerSeat })
    } else if (view.phase === "Judging" && !view.allRevealed) {
      if (view.isViewerCzar) {
        sendIntent({ _tag: "RevealSubmission", slotIndex: -2 })
      } else {
        sendIntent({ _tag: "AdvanceRound", fastForward: true })
      }
    } else if (view.phase === "RoundResult") {
      sendIntent({ _tag: "AdvanceRound", fastForward: false })
    }
  } else if (key === "r") {
    scene.setCameraPreset("table")
    hud.syncCameraPreset("table")
  }
})

// Career progression & achievement tracking (strictly host-side!)
let recordedRoundKey = ""
let recordedMatchKey = ""

function recordCareerProgress(view: TableView): void {
  if (view.config.mode !== "bots" && view.config.mode !== "daily") return

  if (view.phase === "RoundResult") {
    const key = `${view.config.dailyDate ?? "m"}:${view.roundNumber}:${view.chronicle.length}`
    if (key !== recordedRoundKey) {
      recordedRoundKey = key
      const me = view.players[0]
      const latest = view.chronicle[view.chronicle.length - 1]
      if (me !== undefined && latest !== undefined) {
        if (view.winnerSeat === 0) {
          profile.roundsWon += 1
          profile.xp += 25 + (view.isComboWin ? 15 : 0) + (view.sealTriggered ? 15 : 0)
          if (me.streak > profile.bestStreak) profile.bestStreak = me.streak
          if (!profile.czarsBeaten.includes(latest.czarName)) {
            profile.czarsBeaten.push(latest.czarName)
          }
          const unlock = (id: string, title: string) => {
            if (!profile.achievements.includes(id)) {
              profile.achievements.push(id)
              hud.showToast(`Achievement Unlocked: ${title}!`)
            }
          }
          unlock("first-win", "First Stamp")
          if (me.streak >= 3) unlock("hot-streak", "Hot Streak")
          if (view.isComboWin) unlock("pick2-combo", "Tag Combo")
          if (view.sealTriggered) unlock("ink-seal-win", "High Roller")
          if (profile.czarsBeaten.length >= 3) unlock("czar-whisperer", "Room Reader")
        } else if (view.winnerSeat !== null && view.winnerSeat > 0) {
          const winnerBot = view.players.find((p) => p.seatIndex === view.winnerSeat)
          if (winnerBot !== undefined && winnerBot.isBot) {
            profile.botLossesTo[winnerBot.name] = (profile.botLossesTo[winnerBot.name] ?? 0) + 1
          }
        }

        if (view.config.mode === "daily" && view.config.dailyDate !== null) {
          const won = view.winnerSeat === 0
          profile.dailyResults[view.config.dailyDate] = {
            won,
            czarName: latest.czarName,
            promptText: getBlackCard(latest.blackCardId).text,
            answerTexts: latest.winningCardTexts
          }
          if (won) {
            profile.xp += 40
            if (!profile.achievements.includes("daily-victor")) {
              profile.achievements.push("daily-victor")
            }
          }
        }
        saveProfile(profile)
        hud.refreshTopBar(audio.isMuted())
      }
    }
  }

  if (view.phase === "MatchOver" && view.config.mode === "bots") {
    const mKey = `${view.roundNumber}:${view.chronicle.length}`
    if (mKey !== recordedMatchKey) {
      recordedMatchKey = mKey
      const sorted = view.players.slice().sort((a, b) => b.score - a.score)
      if (sorted[0]?.seatIndex === 0) {
        profile.matchesWon += 1
        profile.xp += 50
        saveProfile(profile)
        hud.refreshTopBar(audio.isMuted())
      }
    }
  }
}

let lastPhase = ""
let lastViewSignature = ""

function syncPresentation(dtSeconds: number): void {
  const view = getActiveView()

  // Audio cues & toasts
  for (const cue of view.cues) {
    if (cue.seq > lastSeenCueSeq) {
      lastSeenCueSeq = cue.seq
      audio.playCue(cue.kind)
      if (cue.kind !== "select" && cue.kind !== "tick") {
        hud.showToast(cue.message)
      }
    }
  }

  // Camera auto-framing: snap cleanly to flat Judge view for judging/result, Table view for submitting!
  if (view.phase !== lastPhase) {
    lastPhase = view.phase
    scene.clearHover()
    if (view.phase === "Judging" || view.phase === "RoundResult") {
      scene.setCameraPreset("judge")
      hud.syncCameraPreset("judge")
    } else if (view.phase === "Submitting") {
      scene.setCameraPreset("table")
      hud.syncCameraPreset("table")
    }
  }

  recordCareerProgress(view)
  scene.syncView(view)

  const hudSig = `${view.phase}:${view.roundNumber}:${view.czarSeat}:${view.viewerSeat}:${view.timerRemainingSeconds ?? "-"}:${view.config.revealPace}:${view.viewerSealArmed ? 1 : 0}:${view.viewerStagedIds.join(",")}:${view.submissions.map((s) => `${s.slotIndex}${s.revealed ? "r" : ""}${s.winner ? "w" : ""}`).join("|")}:${view.players.map((p) => `${p.score}${p.streak}${p.hasSubmitted ? "s" : ""}${p.mulliganUsed ? "m" : ""}`).join(",")}`
  if (hudSig !== lastViewSignature) {
    lastViewSignature = hudSig
    hud.render(view)
  }

  scene.renderFrame(dtSeconds)
}

syncPresentation(1 / 60)
const loadingEl = document.getElementById("loading")
if (loadingEl !== null) {
  requestAnimationFrame(() => loadingEl.classList.add("done"))
}

const rafSource = FixedLoop.source((onTick) => {
  let rafId = 0
  let lastNow = performance.now()
  let active = true

  const frame = (now: number) => {
    if (!active) return
    const deltaMS = Math.max(0.001, now - lastNow)
    lastNow = now
    onTick({ deltaMS })
    rafId = requestAnimationFrame(frame)
  }

  rafId = requestAnimationFrame(frame)
  return {
    stop() {
      active = false
      cancelAnimationFrame(rafId)
    }
  }
})

const loop = FixedLoop.start({
  source: rafSource,
  step: STEP,
  maxFrameSeconds: 0.25,
  maxStepsPerFrame: 5,
  update: () => {
    if (lanClient.isInActiveMatch()) {
      return { ok: true as const, value: undefined }
    }
    return runtime.tick(updateSchedule)
  },
  render: (frame) => {
    syncPresentation(frame.elapsedSeconds)
  },
  onFailure: (failure) => {
    console.error("Simulation loop failure:", failure)
  }
})

if (!loop.ok) {
  console.error("Could not start fixed loop:", loop.error)
}
