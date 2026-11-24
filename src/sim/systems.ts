import { Clock, Random } from "@typeonce/ritmo"
import {
  getBlackCard,
  getDeckIdsForPacks,
  getWhiteCard,
  WRITE_IN_CARD_BASE_ID,
  type BlackCard,
  type WhiteCard
} from "./cards.ts"
import { BOT_PERSONAS, getBotPersona, type PersonaId } from "./personas.ts"
import {
  Chronicle,
  CustomCards,
  DeckState,
  Game,
  Intent,
  MatchConfig,
  Player,
  Rng,
  RoundPhase,
  RoundState,
  STEP,
  Submission,
  TableFeedback,
  Time,
  type CueKind,
  type DeckStateData,
  type MatchConfigData,
  type PlayerData,
  type RevealPace,
  type RoundTwist,
  type TableFeedbackData
} from "./schema.ts"

const BOT_SUBMIT_DELAY = Clock.duration(STEP, 0.34)
const BOT_REVEAL_NORMAL = Clock.duration(STEP, 1.15)
const BOT_REVEAL_FAST = Clock.duration(STEP, 0.45)
const BOT_JUDGE_NORMAL = Clock.duration(STEP, 1.35)
const BOT_JUDGE_FAST = Clock.duration(STEP, 0.55)
const SPEED_TWIST_DURATION = Clock.duration(STEP, 15)

function revealDurationForPace(pace: RevealPace): Clock.Duration<60> {
  return pace === "fast" ? BOT_REVEAL_FAST : BOT_REVEAL_NORMAL
}

function judgeDurationForPace(pace: RevealPace): Clock.Duration<60> {
  return pace === "fast" ? BOT_JUDGE_FAST : BOT_JUDGE_NORMAL
}

function roundTimerDeadline(
  time: Clock.Time<60>,
  timerSeconds: number,
  twist: RoundTwist
): Clock.Deadline<60> | null {
  if (twist === "speed-draft") {
    return Clock.deadline(time, SPEED_TWIST_DURATION)
  }
  if (timerSeconds <= 0) return null
  const dur = Clock.durationRaw(STEP, timerSeconds)
  return dur.ok ? Clock.deadline(time, dur.value) : null
}

function pushCue(
  feedback: TableFeedbackData,
  kind: CueKind,
  seat: number,
  message: string
): TableFeedbackData {
  const nextSeq = feedback.nextSeq
  const entry = { seq: nextSeq, kind, seat, message }
  const cues =
    feedback.cues.length >= 16
      ? [...feedback.cues.slice(feedback.cues.length - 15), entry]
      : [...feedback.cues, entry]
  return { nextSeq: nextSeq + 1, cues }
}

function drawWhiteCards(
  deck: DeckStateData,
  count: number,
  fallbackPool: ReadonlyArray<number>,
  random: Random.Random
): { readonly cards: ReadonlyArray<number>; readonly deck: DeckStateData } {
  let draw = deck.whiteDraw.slice()
  let discard = deck.whiteDiscard.slice()
  const out: Array<number> = []

  for (let i = 0; i < count; i++) {
    if (draw.length === 0) {
      if (discard.length === 0) {
        draw = random.shuffle(fallbackPool)
      } else {
        draw = random.shuffle(discard)
        discard = []
      }
    }
    const next = draw.pop()
    if (next !== undefined) {
      out.push(next)
    }
  }

  return {
    cards: out,
    deck: {
      blackDraw: deck.blackDraw,
      blackDiscard: deck.blackDiscard,
      whiteDraw: draw,
      whiteDiscard: discard
    }
  }
}

function drawBlackCard(
  deck: DeckStateData,
  fallbackPool: ReadonlyArray<number>,
  random: Random.Random
): { readonly cardId: number; readonly deck: DeckStateData } {
  let draw = deck.blackDraw.slice()
  let discard = deck.blackDiscard.slice()
  if (draw.length === 0) {
    draw = random.shuffle(discard.length > 0 ? discard : fallbackPool)
    discard = []
  }
  const cardId = draw.pop() ?? fallbackPool[0] ?? 1
  return {
    cardId,
    deck: {
      blackDraw: draw,
      blackDiscard: discard,
      whiteDraw: deck.whiteDraw,
      whiteDiscard: deck.whiteDiscard
    }
  }
}

interface EvaluationResult {
  readonly total: number
  readonly reasons: ReadonlyArray<string>
  readonly isCombo: boolean
}

function evaluateSubmissionForPersona(
  blackCard: BlackCard,
  cards: ReadonlyArray<WhiteCard>,
  persona: PersonaId,
  random: Random.Random
): EvaluationResult {
  const profile = getBotPersona(persona)
  let score = random.range(0, 0.85)
  const reasons: Array<string> = []
  const matchedLoved = new Set<string>()
  let packMatched = false
  let writeInBonus = false

  for (const card of cards) {
    if (card.id >= WRITE_IN_CARD_BASE_ID && !writeInBonus) {
      score += 1.35
      writeInBonus = true
      reasons.push("+1.4 ORIGINAL INK")
    }
    if (card.pack === blackCard.pack && !packMatched) {
      score += 0.6
      packMatched = true
      reasons.push("+0.6 THEME FIT")
    }
    if (profile !== undefined) {
      for (const tag of card.tags) {
        if (profile.loves.includes(tag)) {
          score += 1.4
          matchedLoved.add(tag)
          reasons.push(`+1.4 ${tag.toUpperCase()}`)
        } else if (profile.dislikes === tag) {
          score -= 0.8
          reasons.push(`-0.8 ${tag.toUpperCase()}`)
        }
      }
    }
  }

  const isCombo = cards.length === 2 && matchedLoved.size >= 2
  if (isCombo) {
    score *= 1.5
    reasons.push("×1.5 COMBO!")
  }

  // Deduplicate identical reason strings while keeping order
  const uniqueReasons: Array<string> = []
  for (const r of reasons) {
    if (!uniqueReasons.includes(r)) uniqueReasons.push(r)
  }

  return {
    total: score,
    reasons: uniqueReasons.length > 0 ? uniqueReasons : ["WILD CARD PICK"],
    isCombo
  }
}

function pickBotCards(
  blackCard: BlackCard,
  hand: ReadonlyArray<number>,
  persona: PersonaId,
  customTexts: Readonly<Record<number, string>>,
  random: Random.Random
): ReadonlyArray<number> {
  const remaining = hand.slice()
  const chosen: Array<number> = []
  for (let k = 0; k < blackCard.pick && remaining.length > 0; k++) {
    let bestIdx = 0
    let bestScore = -999
    for (let i = 0; i < remaining.length; i++) {
      const card = getWhiteCard(remaining[i]!, customTexts)
      const evalRes = evaluateSubmissionForPersona(blackCard, [card], persona, random)
      if (evalRes.total > bestScore) {
        bestScore = evalRes.total
        bestIdx = i
      }
    }
    const picked = remaining.splice(bestIdx, 1)[0]
    if (picked !== undefined) {
      chosen.push(picked)
    }
  }
  return chosen
}

function pickRoundTwist(roundNumber: number, config: MatchConfigData, random: Random.Random): RoundTwist {
  if (!config.twistsEnabled || config.mode === "daily") return "none"
  if (roundNumber < 3 || roundNumber % 3 !== 0) return "none"
  return random.pick(["rando", "double-stakes", "speed-draft"] as const) ?? "none"
}

function makePlayersForMatch(
  config: MatchConfigData,
  whiteFallback: ReadonlyArray<number>,
  deck: DeckStateData,
  random: Random.Random
): { readonly players: ReadonlyArray<PlayerData>; readonly deck: DeckStateData } {
  const clamped = Math.max(3, Math.min(8, config.playerCount))
  let currentDeck = deck
  const players: Array<PlayerData> = []

  // Shuffle bot persona order slightly after the classic first 3 (or keep deterministic rotation per seed)
  const botRoster = config.mode === "daily"
    ? BOT_PERSONAS
    : [BOT_PERSONAS[0]!, BOT_PERSONAS[1]!, BOT_PERSONAS[2]!, ...random.shuffle(BOT_PERSONAS.slice(3))]

  for (let seat = 0; seat < clamped; seat++) {
    const drawn = drawWhiteCards(currentDeck, config.handSize, whiteFallback, random)
    currentDeck = drawn.deck

    const customName = config.playerNames[seat]?.trim()
    if (config.mode === "hotseat" || config.mode === "lan") {
      const isBotSeat = config.mode === "lan" && customName !== undefined && customName.startsWith("[BOT] ")
      const botProfile = botRoster[seat % botRoster.length]!
      players.push({
        seatIndex: seat,
        name: isBotSeat
          ? customName.slice(6)
          : customName && customName.length > 0
            ? customName
            : `Player ${seat + 1}`,
        isBot: isBotSeat,
        persona: isBotSeat ? botProfile.id : "human",
        score: 0,
        streak: 0,
        mulliganUsed: false,
        inkSealsLeft: 1,
        sealArmed: false,
        writeInUsed: false,
        handCardIds: drawn.cards,
        stagedCardIds: [],
        hasSubmitted: false
      })
    } else if (seat === 0) {
      players.push({
        seatIndex: 0,
        name: customName && customName.length > 0 ? customName : "You",
        isBot: false,
        persona: "human",
        score: 0,
        streak: 0,
        mulliganUsed: false,
        inkSealsLeft: config.mode === "daily" ? 0 : 1,
        sealArmed: false,
        writeInUsed: config.mode === "daily",
        handCardIds: drawn.cards,
        stagedCardIds: [],
        hasSubmitted: false
      })
    } else {
      const profile = botRoster[(seat - 1) % botRoster.length]!
      players.push({
        seatIndex: seat,
        name: profile.name,
        isBot: true,
        persona: profile.id,
        score: 0,
        streak: 0,
        mulliganUsed: false,
        inkSealsLeft: 0,
        sealArmed: false,
        writeInUsed: true,
        handCardIds: drawn.cards,
        stagedCardIds: [],
        hasSubmitted: false
      })
    }
  }

  return { players, deck: currentDeck }
}

function firstUnsubmittedHumanSeat(
  players: ReadonlyArray<PlayerData>,
  czarSeat: number
): number {
  const ordered = players.slice().sort((a, b) => a.seatIndex - b.seatIndex)
  for (const player of ordered) {
    if (!player.isBot && player.seatIndex !== czarSeat && !player.hasSubmitted) {
      return player.seatIndex
    }
  }
  return czarSeat
}

// ── Systems ──────────────────────────────────────────────────────────────

export const AdvanceTime = Clock.system(Game, {
  name: "Cah/AdvanceTime",
  resource: Time
})

export const BootstrapMatch = Game.System(
  "Cah/BootstrapMatch",
  {
    queries: {
      players: Game.Query({ selection: { player: Game.Query.read(Player) } }),
      submissions: Game.Query({ selection: { sub: Game.Query.read(Submission) } })
    },
    resources: {
      time: Game.System.readResource(Time),
      rng: Game.System.writeResource(Rng),
      config: Game.System.readResource(MatchConfig),
      deck: Game.System.writeResource(DeckState),
      customCards: Game.System.writeResource(CustomCards),
      round: Game.System.writeResource(RoundState),
      chronicle: Game.System.writeResource(Chronicle),
      feedback: Game.System.writeResource(TableFeedback)
    },
    machines: { phase: Game.System.machine(RoundPhase) },
    nextMachines: { phase: Game.System.nextState(RoundPhase) },
    commands: Game.System.commands(
      Game.System.spawns(Player),
      Game.System.despawns(Player, Submission)
    ),
    when: [Game.Condition.inState(RoundPhase, "Setup")]
  },
  ({ queries, resources, nextMachines, commands }) => {
    for (const entity of queries.players.each()) {
      commands.despawn(entity)
    }
    for (const entity of queries.submissions.each()) {
      commands.despawn(entity)
    }

    const random = Random.draw(resources.rng)
    const config = resources.config.get()
    const time = resources.time.get()

    const packDeck = getDeckIdsForPacks(config.packs)
    const customTexts: Record<number, string> = {}
    const customIds: Array<number> = []
    config.customWhitePool.forEach((raw, idx) => {
      const cleaned = raw.trim()
      if (cleaned.length > 0) {
        const cid = 500000 + idx
        customTexts[cid] = cleaned
        customIds.push(cid)
      }
    })

    resources.customCards.set({
      nextWriteInId: WRITE_IN_CARD_BASE_ID + 1,
      texts: customTexts
    })

    const allWhiteIds = [...packDeck.whiteIds, ...customIds]
    let deck: DeckStateData = {
      blackDraw: random.shuffle(packDeck.blackIds),
      blackDiscard: [],
      whiteDraw: random.shuffle(allWhiteIds),
      whiteDiscard: []
    }

    const dealt = makePlayersForMatch(config, allWhiteIds, deck, random)
    deck = dealt.deck

    const blackDraw = drawBlackCard(deck, packDeck.blackIds, random)
    deck = blackDraw.deck

    // Start with Seat 1 as initial Card Czar in Bots/Daily mode so Human plays immediately on Round 1!
    const initialCzarSeat = config.mode === "bots" || config.mode === "daily" ? 1 : 0
    for (const player of dealt.players) {
      commands.spawn(Game.Command.spawn([Player, player]))
    }

    resources.deck.set(deck)
    resources.chronicle.set({ entries: [] })
    resources.round.set({
      roundNumber: 1,
      czarSeat: initialCzarSeat,
      activeBlackCardId: blackDraw.cardId,
      activeTurnSeat: firstUnsubmittedHumanSeat(dealt.players, initialCzarSeat),
      twist: "none",
      winnerSeat: null,
      winningCardIds: [],
      pointsAwarded: 1,
      isComboWin: false,
      sealTriggered: false,
      winReasons: [],
      czarRemark: "",
      loserReaction: "",
      botActionAt: Clock.deadline(time, BOT_SUBMIT_DELAY),
      roundDeadlineAt: roundTimerDeadline(time, config.timerSeconds, "none")
    })

    const czarName = dealt.players[initialCzarSeat]?.name ?? "Czar"
    const introMsg =
      config.mode === "daily" && config.dailyDate !== null
        ? `Daily Sheet ${config.dailyDate} — Beat ${czarName}!`
        : `Round 1 dealt — ${czarName} is Card Czar.`
    resources.feedback.update((fb) => pushCue(fb, "deal", initialCzarSeat, introMsg))

    nextMachines.phase.transition({ from: "Setup", to: "Submitting" })
  }
)

export const HandleIntents = Game.System(
  "Cah/HandleIntents",
  {
    queries: {
      players: Game.Query({ selection: { player: Game.Query.write(Player) } }),
      submissions: Game.Query({ selection: { sub: Game.Query.write(Submission) } })
    },
    resources: {
      time: Game.System.readResource(Time),
      rng: Game.System.writeResource(Rng),
      config: Game.System.writeResource(MatchConfig),
      deck: Game.System.writeResource(DeckState),
      customCards: Game.System.writeResource(CustomCards),
      round: Game.System.writeResource(RoundState),
      chronicle: Game.System.writeResource(Chronicle),
      feedback: Game.System.writeResource(TableFeedback)
    },
    events: {
      intents: Game.System.readEvent(Intent)
    },
    machines: { phase: Game.System.machine(RoundPhase) },
    nextMachines: { phase: Game.System.nextState(RoundPhase) },
    commands: Game.System.commands(
      Game.System.spawns(Submission),
      Game.System.despawns(Submission)
    )
  },
  ({ queries, resources, events, machines, nextMachines, commands }) => {
    const incoming = events.intents.all()
    if (incoming.length === 0) return

    const phase = machines.phase.get()._tag
    const time = resources.time.get()
    const random = Random.draw(resources.rng)

    for (const intent of incoming) {
      switch (intent._tag) {
        case "NewMatch": {
          const prev = resources.config.get()
          const clampedPlayers = Math.max(3, Math.min(8, Math.floor(intent.playerCount)))
          const clampedTarget = Math.max(1, Math.min(12, Math.floor(intent.targetPoints)))
          resources.config.set({
            playerCount: clampedPlayers,
            targetPoints: clampedTarget,
            mode: intent.mode,
            handSize: 7,
            packs: intent.packs && intent.packs.length > 0 ? intent.packs : prev.packs,
            playerNames: intent.playerNames ?? prev.playerNames,
            twistsEnabled: intent.twistsEnabled ?? prev.twistsEnabled,
            timerSeconds: intent.timerSeconds ?? prev.timerSeconds,
            dailyDate: intent.dailyDate !== undefined ? intent.dailyDate : null,
            revealPace: prev.revealPace,
            customWhitePool: intent.customWhitePool ?? prev.customWhitePool
          })
          resources.rng.set(Random.seed(intent.seed))
          if (phase !== "Setup") {
            nextMachines.phase.transition({ from: phase, to: "Setup" })
          }
          return
        }

        case "SetRevealPace": {
          resources.config.update((c) => ({ ...c, revealPace: intent.pace }))
          if (phase === "Judging" && intent.pace !== "manual") {
            resources.round.update((r) => ({
              ...r,
              botActionAt: Clock.deadline(time, revealDurationForPace(intent.pace))
            }))
          }
          break
        }

        case "SendReaction": {
          const sender = queries.players
            .each()
            .map((e) => queries.players.data.player.get(e))
            .find((p) => p.seatIndex === intent.seat)
          const label = intent.label.trim().slice(0, 24)
          if (label.length > 0) {
            resources.feedback.update((fb) =>
              pushCue(fb, "reaction", intent.seat, `${sender?.name ?? "Player"}: ${label}`)
            )
          }
          break
        }

        case "ToggleCard": {
          if (phase !== "Submitting") break
          const round = resources.round.get()
          if (intent.seat === round.czarSeat || round.activeBlackCardId === null) break
          const requiredPick = getBlackCard(round.activeBlackCardId).pick

          for (const entity of queries.players.each()) {
            const player = queries.players.data.player.get(entity)
            if (player.seatIndex !== intent.seat || player.isBot || player.hasSubmitted) continue
            if (!player.handCardIds.includes(intent.cardId)) continue

            const already = player.stagedCardIds.includes(intent.cardId)
            let nextStaged: ReadonlyArray<number>
            if (already) {
              nextStaged = player.stagedCardIds.filter((id) => id !== intent.cardId)
            } else if (requiredPick === 1) {
              nextStaged = [intent.cardId]
            } else if (player.stagedCardIds.length < requiredPick) {
              nextStaged = [...player.stagedCardIds, intent.cardId]
            } else {
              nextStaged = [player.stagedCardIds[1]!, intent.cardId]
            }

            queries.players.data.player.set(entity, {
              ...player,
              stagedCardIds: nextStaged
            })
            resources.feedback.update((fb) =>
              pushCue(
                fb,
                "select",
                player.seatIndex,
                already ? "Card returned to hand." : `Selected ${nextStaged.length}/${requiredPick}.`
              )
            )
            break
          }
          break
        }

        case "ToggleInkSeal": {
          if (phase !== "Submitting") break
          const round = resources.round.get()
          if (intent.seat === round.czarSeat) break

          for (const entity of queries.players.each()) {
            const player = queries.players.data.player.get(entity)
            if (player.seatIndex !== intent.seat || player.isBot || player.hasSubmitted) continue
            if (player.inkSealsLeft <= 0) continue

            const armed = !player.sealArmed
            queries.players.data.player.set(entity, {
              ...player,
              sealArmed: armed
            })
            resources.feedback.update((fb) =>
              pushCue(
                fb,
                "seal",
                player.seatIndex,
                armed ? "Ink Seal armed — double points (+2) if you win!" : "Ink Seal disarmed."
              )
            )
            break
          }
          break
        }

        case "PlayWriteIn": {
          if (phase !== "Submitting") break
          const round = resources.round.get()
          if (intent.seat === round.czarSeat || round.activeBlackCardId === null) break
          const cleaned = intent.text.trim().slice(0, 96)
          if (cleaned.length < 2) break
          const requiredPick = getBlackCard(round.activeBlackCardId).pick

          for (const entity of queries.players.each()) {
            const player = queries.players.data.player.get(entity)
            if (player.seatIndex !== intent.seat || player.isBot || player.hasSubmitted || player.writeInUsed) continue

            const custom = resources.customCards.get()
            const newId = custom.nextWriteInId
            resources.customCards.set({
              nextWriteInId: newId + 1,
              texts: { ...custom.texts, [newId]: cleaned }
            })

            const nextHand = [...player.handCardIds, newId]
            const nextStaged =
              requiredPick === 1
                ? [newId]
                : player.stagedCardIds.length < requiredPick
                  ? [...player.stagedCardIds, newId]
                  : [player.stagedCardIds[1]!, newId]

            queries.players.data.player.set(entity, {
              ...player,
              writeInUsed: true,
              handCardIds: nextHand,
              stagedCardIds: nextStaged
            })
            resources.feedback.update((fb) =>
              pushCue(fb, "select", player.seatIndex, `${player.name} inked a custom write-in card.`)
            )
            break
          }
          break
        }

        case "SubmitStaged": {
          if (phase !== "Submitting") break
          const round = resources.round.get()
          if (intent.seat === round.czarSeat || round.activeBlackCardId === null) break
          const requiredPick = getBlackCard(round.activeBlackCardId).pick

          const allPlayers: Array<PlayerData> = []
          let submittedNow = false

          for (const entity of queries.players.each()) {
            const player = queries.players.data.player.get(entity)
            if (
              player.seatIndex === intent.seat &&
              !player.isBot &&
              !player.hasSubmitted &&
              player.stagedCardIds.length === requiredPick
            ) {
              const playedIds = player.stagedCardIds
              const remainingHand = player.handCardIds.filter((id) => !playedIds.includes(id))
              const usedSeal = player.sealArmed && player.inkSealsLeft > 0
              const updated: PlayerData = {
                ...player,
                handCardIds: remainingHand,
                stagedCardIds: [],
                hasSubmitted: true,
                sealArmed: false,
                inkSealsLeft: usedSeal ? player.inkSealsLeft - 1 : player.inkSealsLeft
              }
              queries.players.data.player.set(entity, updated)
              commands.spawn(
                Game.Command.spawn([
                  Submission,
                  {
                    ownerSeat: player.seatIndex,
                    cardIds: playedIds,
                    slotIndex: -1,
                    revealed: false,
                    winner: false,
                    sealed: usedSeal
                  }
                ])
              )
              allPlayers.push(updated)
              submittedNow = true
              resources.feedback.update((fb) =>
                pushCue(
                  fb,
                  usedSeal ? "seal" : "submit",
                  player.seatIndex,
                  usedSeal
                    ? `${player.name} slammed a 2× Ink-Sealed play onto the mat!`
                    : `${player.name} slid their play onto the mat.`
                )
              )
            } else {
              allPlayers.push(player)
            }
          }

          if (submittedNow) {
            resources.round.update((r) => ({
              ...r,
              activeTurnSeat: firstUnsubmittedHumanSeat(allPlayers, r.czarSeat)
            }))
          }
          break
        }

        case "RedrawHand": {
          if (phase !== "Submitting") break
          const round = resources.round.get()
          if (intent.seat === round.czarSeat) break
          const config = resources.config.get()
          const packDeck = getDeckIdsForPacks(config.packs)

          for (const entity of queries.players.each()) {
            const player = queries.players.data.player.get(entity)
            if (player.seatIndex !== intent.seat || player.isBot || player.hasSubmitted || player.mulliganUsed) {
              continue
            }
            const currentDeck = resources.deck.get()
            const discardedDeck: DeckStateData = {
              blackDraw: currentDeck.blackDraw,
              blackDiscard: currentDeck.blackDiscard,
              whiteDraw: currentDeck.whiteDraw,
              whiteDiscard: [...currentDeck.whiteDiscard, ...player.handCardIds.filter((id) => id < WRITE_IN_CARD_BASE_ID)]
            }
            const drawn = drawWhiteCards(discardedDeck, config.handSize, packDeck.whiteIds, random)
            resources.deck.set(drawn.deck)
            queries.players.data.player.set(entity, {
              ...player,
              mulliganUsed: true,
              handCardIds: drawn.cards,
              stagedCardIds: []
            })
            resources.feedback.update((fb) =>
              pushCue(fb, "redraw", player.seatIndex, `${player.name} redrew a fresh hand of ${config.handSize} cards.`)
            )
            break
          }
          break
        }

        case "RevealSubmission": {
          if (phase !== "Judging") break
          const pace = resources.config.get().revealPace
          let revealedAny = false
          const subRows = queries.submissions
            .each()
            .map((entity) => ({ entity, sub: queries.submissions.data.sub.get(entity) }))
            .sort((a, b) => a.sub.slotIndex - b.sub.slotIndex)

          if (intent.slotIndex === -2) {
            // Reveal next single unrevealed submission in order!
            const nextHidden = subRows.find((r) => !r.sub.revealed)
            if (nextHidden !== undefined) {
              queries.submissions.data.sub.set(nextHidden.entity, { ...nextHidden.sub, revealed: true })
              revealedAny = true
            }
          } else {
            for (const row of subRows) {
              if (row.sub.revealed) continue
              if (intent.slotIndex === -1 || row.sub.slotIndex === intent.slotIndex) {
                queries.submissions.data.sub.set(row.entity, { ...row.sub, revealed: true })
                revealedAny = true
              }
            }
          }

          if (revealedAny) {
            resources.round.update((r) => ({
              ...r,
              botActionAt: pace === "manual" ? null : Clock.deadline(time, revealDurationForPace(pace))
            }))
            resources.feedback.update((fb) =>
              pushCue(
                fb,
                "flip",
                resources.round.get().czarSeat,
                intent.slotIndex === -1 ? "All submissions revealed." : "Submission flipped face-up."
              )
            )
          }
          break
        }

        case "PickWinner": {
          if (phase !== "Judging") break
          const round = resources.round.get()
          let czarPlayer: PlayerData | undefined
          for (const entity of queries.players.each()) {
            const p = queries.players.data.player.get(entity)
            if (p.seatIndex === round.czarSeat) czarPlayer = p
          }
          if (czarPlayer === undefined || czarPlayer.isBot) break

          let allRevealed = true
          let winningOwnerSeat: number | null = null
          let winningCards: ReadonlyArray<number> = []
          let winningSealed = false

          for (const entity of queries.submissions.each()) {
            const sub = queries.submissions.data.sub.get(entity)
            if (!sub.revealed) allRevealed = false
            if (sub.slotIndex === intent.slotIndex) {
              winningOwnerSeat = sub.ownerSeat
              winningCards = sub.cardIds
              winningSealed = sub.sealed
            }
          }
          if (!allRevealed || winningOwnerSeat === null || round.activeBlackCardId === null) break

          for (const entity of queries.submissions.each()) {
            const sub = queries.submissions.data.sub.get(entity)
            if (sub.slotIndex === intent.slotIndex) {
              queries.submissions.data.sub.set(entity, { ...sub, winner: true })
            }
          }

          const basePoints = round.twist === "double-stakes" ? 2 : 1
          const awarded = winningOwnerSeat === -1 ? 0 : basePoints * (winningSealed ? 2 : 1)
          let winnerName = winningOwnerSeat === -1 ? "Rando (Deck)" : "Player"

          for (const entity of queries.players.each()) {
            const player = queries.players.data.player.get(entity)
            if (player.seatIndex === winningOwnerSeat) {
              winnerName = player.name
              queries.players.data.player.set(entity, {
                ...player,
                score: player.score + awarded,
                streak: player.streak + 1
              })
            } else if (player.seatIndex !== round.czarSeat) {
              queries.players.data.player.set(entity, { ...player, streak: 0 })
            }
          }

          const customTexts = resources.customCards.get().texts
          const winReasons: Array<string> = ["CZAR'S CHOICE"]
          if (round.twist === "double-stakes") winReasons.push("2× DOUBLE STAKES")
          if (winningSealed) winReasons.push("2× INK SEAL")

          const remark =
            winningOwnerSeat === -1
              ? "The deck itself beat everyone at the table."
              : `${czarPlayer.name} stamped the winner.`
          const activeBlackId = round.activeBlackCardId
          const winningTexts = winningCards.map((id) => getWhiteCard(id, customTexts).text)

          resources.round.update((r) => ({
            ...r,
            winnerSeat: winningOwnerSeat,
            winningCardIds: winningCards,
            pointsAwarded: awarded,
            isComboWin: false,
            sealTriggered: winningSealed,
            winReasons,
            czarRemark: remark,
            loserReaction: "",
            botActionAt: null,
            roundDeadlineAt: null
          }))
          resources.chronicle.update((ch) => ({
            entries: [
              ...ch.entries,
              {
                roundNumber: round.roundNumber,
                blackCardId: activeBlackId,
                winningCardIds: winningCards,
                winningCardTexts: winningTexts,
                winnerSeat: winningOwnerSeat,
                winnerName,
                czarName: czarPlayer.name,
                remark,
                winReasons,
                isComboWin: false,
                pointsAwarded: awarded
              }
            ]
          }))
          resources.feedback.update((fb) =>
            pushCue(
              fb,
              "award",
              winningOwnerSeat,
              `${winnerName} wins Round ${round.roundNumber}${awarded > 1 ? ` (+${awarded} pts!)` : "!"}`
            )
          )
          nextMachines.phase.transition({ from: "Judging", to: "RoundResult" })
          break
        }

        case "AdvanceRound": {
          if (phase === "Judging" && intent.fastForward) {
            resources.round.update((r) => ({
              ...r,
              botActionAt: Clock.deadline(time, Clock.durationOfSteps(STEP, 1))
            }))
            break
          }

          if (phase !== "RoundResult") break
          const config = resources.config.get()
          const round = resources.round.get()

          let someoneWonMatch = config.mode === "daily"
          let championName = ""
          let championSeat = 0
          for (const entity of queries.players.each()) {
            const player = queries.players.data.player.get(entity)
            if (player.score >= config.targetPoints) {
              someoneWonMatch = true
              championName = player.name
              championSeat = player.seatIndex
            }
          }

          if (someoneWonMatch) {
            const msg =
              config.mode === "daily"
                ? `Daily Sheet ${config.dailyDate ?? ""} complete!`
                : `${championName} takes the match with ${config.targetPoints} points!`
            resources.feedback.update((fb) => pushCue(fb, "victory", championSeat, msg))
            nextMachines.phase.transition({ from: "RoundResult", to: "MatchOver" })
            break
          }

          const packDeck = getDeckIdsForPacks(config.packs)
          let deck = resources.deck.get()
          const discardedWhites: Array<number> = []
          for (const entity of queries.submissions.each()) {
            const sub = queries.submissions.data.sub.get(entity)
            discardedWhites.push(...sub.cardIds.filter((id) => id < WRITE_IN_CARD_BASE_ID))
            commands.despawn(entity)
          }
          deck = {
            blackDraw: deck.blackDraw,
            blackDiscard:
              round.activeBlackCardId !== null
                ? [...deck.blackDiscard, round.activeBlackCardId]
                : deck.blackDiscard,
            whiteDraw: deck.whiteDraw,
            whiteDiscard: [...deck.whiteDiscard, ...discardedWhites]
          }

          const updatedPlayers: Array<PlayerData> = []
          for (const entity of queries.players.each()) {
            const player = queries.players.data.player.get(entity)
            const need = Math.max(0, config.handSize - player.handCardIds.length)
            const drawn = drawWhiteCards(deck, need, packDeck.whiteIds, random)
            deck = drawn.deck
            const nextPlayer: PlayerData = {
              ...player,
              handCardIds: [...player.handCardIds, ...drawn.cards],
              stagedCardIds: [],
              sealArmed: false,
              hasSubmitted: false
            }
            queries.players.data.player.set(entity, nextPlayer)
            updatedPlayers.push(nextPlayer)
          }

          const nextRoundNumber = round.roundNumber + 1
          const nextCzarSeat = (round.czarSeat + 1) % config.playerCount
          const nextBlack = drawBlackCard(deck, packDeck.blackIds, random)
          deck = nextBlack.deck
          const nextTwist = pickRoundTwist(nextRoundNumber, config, random)

          resources.deck.set(deck)
          resources.round.set({
            roundNumber: nextRoundNumber,
            czarSeat: nextCzarSeat,
            activeBlackCardId: nextBlack.cardId,
            activeTurnSeat: firstUnsubmittedHumanSeat(updatedPlayers, nextCzarSeat),
            twist: nextTwist,
            winnerSeat: null,
            winningCardIds: [],
            pointsAwarded: nextTwist === "double-stakes" ? 2 : 1,
            isComboWin: false,
            sealTriggered: false,
            winReasons: [],
            czarRemark: "",
            loserReaction: "",
            botActionAt: Clock.deadline(time, BOT_SUBMIT_DELAY),
            roundDeadlineAt: roundTimerDeadline(time, config.timerSeconds, nextTwist)
          })

          const nextCzar = updatedPlayers.find((p) => p.seatIndex === nextCzarSeat)?.name ?? "Czar"
          const twistTag =
            nextTwist === "rando"
              ? " [DIRECTIVE: RANDO CARDRISSIAN]"
              : nextTwist === "double-stakes"
                ? " [DIRECTIVE: DOUBLE STAKES]"
                : nextTwist === "speed-draft"
                  ? " [DIRECTIVE: 15s SPEED DRAFT]"
                  : ""
          resources.feedback.update((fb) =>
            pushCue(fb, "deal", nextCzarSeat, `Round ${nextRoundNumber} — ${nextCzar} is Card Czar.${twistTag}`)
          )
          nextMachines.phase.transition({ from: "RoundResult", to: "Submitting" })
          break
        }
      }
    }
  }
)

export const RunBotSubmissions = Game.System(
  "Cah/RunBotSubmissions",
  {
    queries: {
      players: Game.Query({ selection: { player: Game.Query.write(Player) } }),
      submissions: Game.Query({ selection: { sub: Game.Query.write(Submission) } })
    },
    resources: {
      time: Game.System.readResource(Time),
      rng: Game.System.writeResource(Rng),
      config: Game.System.readResource(MatchConfig),
      deck: Game.System.writeResource(DeckState),
      customCards: Game.System.readResource(CustomCards),
      round: Game.System.writeResource(RoundState),
      feedback: Game.System.writeResource(TableFeedback)
    },
    nextMachines: { phase: Game.System.nextState(RoundPhase) },
    commands: Game.System.commands(Game.System.spawns(Submission)),
    when: [Game.Condition.inState(RoundPhase, "Submitting")]
  },
  ({ queries, resources, nextMachines, commands }) => {
    const time = resources.time.get()
    const round = resources.round.get()
    if (round.activeBlackCardId === null) return

    const config = resources.config.get()
    const blackCard = getBlackCard(round.activeBlackCardId)
    const requiredPick = blackCard.pick
    const customTexts = resources.customCards.get().texts
    const random = Random.draw(resources.rng)

    // Check optional round timer expiration for humans
    const timerExpired = round.roundDeadlineAt !== null && Clock.reached(time, round.roundDeadlineAt)
    if (round.roundDeadlineAt !== null && !timerExpired) {
      const stepsLeft = Clock.remaining(time, round.roundDeadlineAt)
      if (stepsLeft > 0 && stepsLeft <= STEP.hz * 5 && stepsLeft % STEP.hz === 0) {
        const secs = Math.round(stepsLeft / STEP.hz)
        resources.feedback.update((fb) => pushCue(fb, "tick", round.czarSeat, `${secs}s remaining…`))
      }
    }

    let pendingNonCzar = 0
    let spawnedThisTick = false

    for (const entity of queries.players.each()) {
      const player = queries.players.data.player.get(entity)
      if (player.seatIndex === round.czarSeat || player.hasSubmitted) continue
      pendingNonCzar += 1

      if (!player.isBot && timerExpired) {
        // Auto-submit staged or first valid cards when timer hits 0
        const autoIds = player.stagedCardIds.slice()
        for (const id of player.handCardIds) {
          if (autoIds.length >= requiredPick) break
          if (!autoIds.includes(id)) autoIds.push(id)
        }
        const remaining = player.handCardIds.filter((id) => !autoIds.includes(id))
        queries.players.data.player.set(entity, {
          ...player,
          handCardIds: remaining,
          stagedCardIds: [],
          sealArmed: false,
          hasSubmitted: true
        })
        commands.spawn(
          Game.Command.spawn([
            Submission,
            {
              ownerSeat: player.seatIndex,
              cardIds: autoIds,
              slotIndex: -1,
              revealed: false,
              winner: false,
              sealed: false
            }
          ])
        )
        pendingNonCzar -= 1
        spawnedThisTick = true
        resources.feedback.update((fb) =>
          pushCue(fb, "submit", player.seatIndex, `Time's up! ${player.name}'s hand auto-submitted.`)
        )
        continue
      }

      if (
        player.isBot &&
        !spawnedThisTick &&
        (round.botActionAt === null || Clock.reached(time, round.botActionAt))
      ) {
        const pickedIds = pickBotCards(blackCard, player.handCardIds, player.persona, customTexts, random)
        const remaining = player.handCardIds.filter((id) => !pickedIds.includes(id))
        queries.players.data.player.set(entity, {
          ...player,
          handCardIds: remaining,
          stagedCardIds: [],
          hasSubmitted: true
        })
        commands.spawn(
          Game.Command.spawn([
            Submission,
            {
              ownerSeat: player.seatIndex,
              cardIds: pickedIds,
              slotIndex: -1,
              revealed: false,
              winner: false,
              sealed: false
            }
          ])
        )
        pendingNonCzar -= 1
        spawnedThisTick = true
        const profile = getBotPersona(player.persona)
        const banter = random.pick(profile?.playLines ?? [`${player.name} placed a face-down play.`]) ?? `${player.name} placed a play.`
        resources.round.update((r) => ({
          ...r,
          botActionAt: Clock.deadline(time, BOT_SUBMIT_DELAY)
        }))
        resources.feedback.update((fb) => pushCue(fb, "submit", player.seatIndex, banter))
      }
    }

    // Rando Cardrissian twist: spawn one phantom deck entry before entering Judging
    if (pendingNonCzar === 0 && !spawnedThisTick && round.twist === "rando") {
      const hasRando = queries.submissions.each().some((e) => queries.submissions.data.sub.get(e).ownerSeat === -1)
      if (!hasRando) {
        const packDeck = getDeckIdsForPacks(config.packs)
        const drawn = drawWhiteCards(resources.deck.get(), requiredPick, packDeck.whiteIds, random)
        resources.deck.set(drawn.deck)
        commands.spawn(
          Game.Command.spawn([
            Submission,
            {
              ownerSeat: -1,
              cardIds: drawn.cards,
              slotIndex: -1,
              revealed: false,
              winner: false,
              sealed: false
            }
          ])
        )
        spawnedThisTick = true
        resources.feedback.update((fb) =>
          pushCue(fb, "submit", -1, "Rando Cardrissian slipped a blind card from the deck onto the mat!")
        )
      }
    }

    if (pendingNonCzar === 0 && !spawnedThisTick) {
      const subEntities = queries.submissions.each()
      if (subEntities.length === 0) return

      const indices = random.shuffle(subEntities.map((_, i) => i))
      for (let i = 0; i < subEntities.length; i++) {
        const entity = subEntities[i]!
        const sub = queries.submissions.data.sub.get(entity)
        queries.submissions.data.sub.set(entity, {
          ...sub,
          slotIndex: indices[i]!,
          revealed: false,
          winner: false
        })
      }

      const nextDelay =
        config.revealPace === "manual"
          ? null
          : Clock.deadline(time, revealDurationForPace(config.revealPace))
      resources.round.update((r) => ({
        ...r,
        botActionAt: nextDelay,
        roundDeadlineAt: null
      }))
      resources.feedback.update((fb) =>
        pushCue(fb, "deal", round.czarSeat, "All plays locked in — flipping onto the judging mat.")
      )
      nextMachines.phase.transition({ from: "Submitting", to: "Judging" })
    }
  }
)

export const RunBotJudging = Game.System(
  "Cah/RunBotJudging",
  {
    queries: {
      players: Game.Query({ selection: { player: Game.Query.write(Player) } }),
      submissions: Game.Query({ selection: { sub: Game.Query.write(Submission) } })
    },
    resources: {
      time: Game.System.readResource(Time),
      rng: Game.System.writeResource(Rng),
      config: Game.System.readResource(MatchConfig),
      customCards: Game.System.readResource(CustomCards),
      round: Game.System.writeResource(RoundState),
      chronicle: Game.System.writeResource(Chronicle),
      feedback: Game.System.writeResource(TableFeedback)
    },
    nextMachines: { phase: Game.System.nextState(RoundPhase) },
    when: [Game.Condition.inState(RoundPhase, "Judging")]
  },
  ({ queries, resources, nextMachines }) => {
    const round = resources.round.get()
    if (round.activeBlackCardId === null) return

    let czar: PlayerData | undefined
    for (const entity of queries.players.each()) {
      const p = queries.players.data.player.get(entity)
      if (p.seatIndex === round.czarSeat) {
        czar = p
        break
      }
    }
    if (czar === undefined || !czar.isBot) return

    const config = resources.config.get()
    const time = resources.time.get()
    // In manual pace, wait until player clicks Next Reveal / Step Faster (which sets a 1-step botActionAt)
    if (round.botActionAt === null) return
    if (!Clock.reached(time, round.botActionAt)) return

    const subRows = queries.submissions
      .each()
      .map((entity) => ({ entity, sub: queries.submissions.data.sub.get(entity) }))
      .sort((a, b) => a.sub.slotIndex - b.sub.slotIndex)

    const nextHidden = subRows.find((row) => !row.sub.revealed)
    if (nextHidden !== undefined) {
      queries.submissions.data.sub.set(nextHidden.entity, {
        ...nextHidden.sub,
        revealed: true
      })
      const stillHidden = subRows.some((row) => row.entity.id !== nextHidden.entity.id && !row.sub.revealed)
      const nextAt =
        config.revealPace === "manual"
          ? null
          : Clock.deadline(
              time,
              stillHidden ? revealDurationForPace(config.revealPace) : judgeDurationForPace(config.revealPace)
            )
      resources.round.update((r) => ({ ...r, botActionAt: nextAt }))
      resources.feedback.update((fb) =>
        pushCue(fb, "flip", czar.seatIndex, `${czar.name} flipped entry #${nextHidden.sub.slotIndex + 1}.`)
      )
      return
    }

    if (subRows.length === 0) return
    const random = Random.draw(resources.rng)
    const blackCard = getBlackCard(round.activeBlackCardId)
    const customTexts = resources.customCards.get().texts

    let bestRow = subRows[0]!
    let bestEval: EvaluationResult = { total: -999, reasons: [], isCombo: false }

    for (const row of subRows) {
      const whiteCards = row.sub.cardIds.map((id) => getWhiteCard(id, customTexts))
      const evalRes = evaluateSubmissionForPersona(blackCard, whiteCards, czar.persona, random)
      if (evalRes.total > bestEval.total) {
        bestEval = evalRes
        bestRow = row
      }
    }

    queries.submissions.data.sub.set(bestRow.entity, {
      ...bestRow.sub,
      winner: true
    })

    const basePoints = round.twist === "double-stakes" ? 2 : 1
    const awarded = bestRow.sub.ownerSeat === -1 ? 0 : basePoints * (bestRow.sub.sealed ? 2 : 1)
    let winnerName = bestRow.sub.ownerSeat === -1 ? "Rando (Deck)" : "Player"
    const losingBots: Array<PlayerData> = []

    for (const entity of queries.players.each()) {
      const player = queries.players.data.player.get(entity)
      if (player.seatIndex === bestRow.sub.ownerSeat) {
        winnerName = player.name
        queries.players.data.player.set(entity, {
          ...player,
          score: player.score + awarded,
          streak: player.streak + 1
        })
      } else if (player.seatIndex !== round.czarSeat) {
        queries.players.data.player.set(entity, { ...player, streak: 0 })
        if (player.isBot) losingBots.push(player)
      }
    }

    const czarProfile = getBotPersona(czar.persona)
    const remark =
      bestRow.sub.ownerSeat === -1
        ? "Rando Cardrissian stole the round straight from the deck!"
        : (random.pick(czarProfile?.winRemarks ?? ["Approved."]) ?? "Approved.")

    const loser = random.pick(losingBots)
    const loserProfile = loser !== undefined ? getBotPersona(loser.persona) : undefined
    const loserReaction = loserProfile !== undefined ? (random.pick(loserProfile.loseLines) ?? "") : ""

    const finalReasons = bestEval.reasons.slice()
    if (round.twist === "double-stakes") finalReasons.push("2× DOUBLE STAKES")
    if (bestRow.sub.sealed) finalReasons.push("2× INK SEAL")

    const activeBlackId = round.activeBlackCardId
    const winningTexts = bestRow.sub.cardIds.map((id) => getWhiteCard(id, customTexts).text)

    resources.round.update((r) => ({
      ...r,
      winnerSeat: bestRow.sub.ownerSeat,
      winningCardIds: bestRow.sub.cardIds,
      pointsAwarded: awarded,
      isComboWin: bestEval.isCombo,
      sealTriggered: bestRow.sub.sealed,
      winReasons: finalReasons,
      czarRemark: remark,
      loserReaction,
      botActionAt: null
    }))
    resources.chronicle.update((ch) => ({
      entries: [
        ...ch.entries,
        {
          roundNumber: round.roundNumber,
          blackCardId: activeBlackId,
          winningCardIds: bestRow.sub.cardIds,
          winningCardTexts: winningTexts,
          winnerSeat: bestRow.sub.ownerSeat,
          winnerName,
          czarName: czar.name,
          remark,
          winReasons: finalReasons,
          isComboWin: bestEval.isCombo,
          pointsAwarded: awarded
        }
      ]
    }))
    resources.feedback.update((fb) =>
      pushCue(
        fb,
        "award",
        bestRow.sub.ownerSeat,
        `${czar.name} approved ${winnerName}'s play${awarded > 1 ? ` (+${awarded} pts!)` : "!"}`
      )
    )

    nextMachines.phase.transition({ from: "Judging", to: "RoundResult" })
  }
)
