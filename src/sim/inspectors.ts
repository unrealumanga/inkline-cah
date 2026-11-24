import { Clock } from "@typeonce/ritmo"
import { getBlackCard, getWhiteCard, type BlackCard, type CardTag, type WhiteCard } from "./cards.ts"
import { formatPersonaTaste } from "./personas.ts"
import {
  Chronicle,
  CustomCards,
  DeckState,
  Game,
  MatchConfig,
  Player,
  RoundPhase,
  RoundState,
  Submission,
  TableFeedback,
  Time,
  type ChronicleEntry,
  type MatchConfigData,
  type PlayerData,
  type RoundPhaseTag,
  type RoundTwist,
  type TableCueItem
} from "./schema.ts"

export interface SubmissionView {
  readonly ownerSeat: number
  readonly ownerName: string
  readonly slotIndex: number
  readonly revealed: boolean
  readonly winner: boolean
  readonly sealed: boolean
  readonly cards: ReadonlyArray<WhiteCard>
}

export interface CzarTasteView {
  readonly name: string
  readonly isBot: boolean
  readonly loves: ReadonlyArray<CardTag>
  readonly dislikes: CardTag | null
  readonly summary: string
}

export interface TableView {
  readonly step: number
  readonly phase: RoundPhaseTag
  readonly config: MatchConfigData
  readonly roundNumber: number
  readonly czarSeat: number
  readonly czarTaste: CzarTasteView
  readonly activeTurnSeat: number
  readonly twist: RoundTwist
  readonly activeBlackCard: BlackCard | null
  readonly winnerSeat: number | null
  readonly pointsAwarded: number
  readonly isComboWin: boolean
  readonly sealTriggered: boolean
  readonly winReasons: ReadonlyArray<string>
  readonly czarRemark: string
  readonly loserReaction: string
  readonly timerRemainingSeconds: number | null
  readonly blackDeckRemaining: number
  readonly whiteDeckRemaining: number
  readonly players: ReadonlyArray<PlayerData>
  readonly viewerSeat: number
  readonly viewerHand: ReadonlyArray<WhiteCard>
  readonly viewerStagedIds: ReadonlyArray<number>
  readonly viewerSealArmed: boolean
  readonly viewerInkSealsLeft: number
  readonly viewerWriteInUsed: boolean
  readonly submissions: ReadonlyArray<SubmissionView>
  readonly allRevealed: boolean
  readonly isViewerCzar: boolean
  readonly canViewerSubmit: boolean
  readonly canViewerPickWinner: boolean
  readonly canViewerRedraw: boolean
  readonly chronicle: ReadonlyArray<ChronicleEntry>
  readonly cues: ReadonlyArray<TableCueItem>
  readonly customTexts: Readonly<Record<number, string>>
}

export const TableViewInspector = Game.Inspector(
  "Cah/TableView",
  {
    queries: {
      players: Game.Query({ selection: { player: Game.Query.read(Player) } }),
      submissions: Game.Query({ selection: { sub: Game.Query.read(Submission) } })
    },
    resources: {
      time: Game.System.readResource(Time),
      config: Game.System.readResource(MatchConfig),
      deck: Game.System.readResource(DeckState),
      customCards: Game.System.readResource(CustomCards),
      round: Game.System.readResource(RoundState),
      chronicle: Game.System.readResource(Chronicle),
      feedback: Game.System.readResource(TableFeedback)
    },
    machines: {
      phase: Game.System.machine(RoundPhase)
    }
  },
  ({ queries, resources, machines }): TableView => {
    const phase = machines.phase.get()._tag
    const config = resources.config.get()
    const deck = resources.deck.get()
    const customTexts = resources.customCards.get().texts
    const round = resources.round.get()
    const chronicle = resources.chronicle.get()
    const feedback = resources.feedback.get()
    const time = resources.time.get()

    const players = queries.players
      .each()
      .map((entity) => queries.players.data.player.get(entity))
      .sort((a, b) => a.seatIndex - b.seatIndex)

    const viewerSeat = config.mode === "bots" || config.mode === "daily" ? 0 : round.activeTurnSeat
    const activeBlackCard = round.activeBlackCardId !== null ? getBlackCard(round.activeBlackCardId) : null
    const czarPlayer = players.find((p) => p.seatIndex === round.czarSeat)
    const taste = formatPersonaTaste(czarPlayer?.persona ?? "human")

    const submissions = queries.submissions
      .each()
      .map((entity) => {
        const sub = queries.submissions.data.sub.get(entity)
        const owner = players.find((p) => p.seatIndex === sub.ownerSeat)
        return {
          ownerSeat: sub.ownerSeat,
          ownerName: sub.ownerSeat === -1 ? "Rando (Deck)" : (owner?.name ?? `Seat ${sub.ownerSeat + 1}`),
          slotIndex: sub.slotIndex,
          revealed: sub.revealed,
          winner: sub.winner,
          sealed: sub.sealed,
          cards: sub.cardIds.map((id) => getWhiteCard(id, customTexts))
        }
      })
      .sort((a, b) => a.slotIndex - b.slotIndex)

    const timerRemainingSeconds =
      round.roundDeadlineAt !== null
        ? Math.ceil(Clock.remaining(time, round.roundDeadlineAt) / time.hz)
        : null

    const rawView: TableView = {
      step: time.step,
      phase,
      config,
      roundNumber: round.roundNumber,
      czarSeat: round.czarSeat,
      czarTaste: {
        name: czarPlayer?.name ?? "Czar",
        isBot: czarPlayer?.isBot ?? false,
        loves: taste.loves,
        dislikes: taste.dislikes,
        summary: taste.summary
      },
      activeTurnSeat: round.activeTurnSeat,
      twist: round.twist,
      activeBlackCard,
      winnerSeat: round.winnerSeat,
      pointsAwarded: round.pointsAwarded,
      isComboWin: round.isComboWin,
      sealTriggered: round.sealTriggered,
      winReasons: round.winReasons,
      czarRemark: round.czarRemark,
      loserReaction: round.loserReaction,
      timerRemainingSeconds,
      blackDeckRemaining: deck.blackDraw.length,
      whiteDeckRemaining: deck.whiteDraw.length,
      players,
      viewerSeat,
      viewerHand: [],
      viewerStagedIds: [],
      viewerSealArmed: false,
      viewerInkSealsLeft: 0,
      viewerWriteInUsed: true,
      submissions,
      allRevealed: submissions.length > 0 && submissions.every((s) => s.revealed),
      isViewerCzar: false,
      canViewerSubmit: false,
      canViewerPickWinner: false,
      canViewerRedraw: false,
      chronicle: chronicle.entries,
      cues: feedback.cues,
      customTexts
    }

    return projectTableViewForSeat(rawView, viewerSeat, false)
  }
)

/**
 * Pure projection helper used locally AND by the LAN multiplayer server
 * so every connected phone/laptop receives ONLY their own private hand & permissions!
 */
export function projectTableViewForSeat(
  base: TableView,
  seatIndex: number,
  sanitizeOtherHands: boolean
): TableView {
  const viewer = base.players.find((p) => p.seatIndex === seatIndex)
  const czarPlayer = base.players.find((p) => p.seatIndex === base.czarSeat)
  const requiredPick = base.activeBlackCard?.pick ?? 1

  const isViewerCzar =
    base.config.mode === "hotseat"
      ? base.phase === "Judging" || seatIndex === base.czarSeat
      : seatIndex === base.czarSeat

  const canViewerSubmit =
    base.phase === "Submitting" &&
    viewer !== undefined &&
    !viewer.isBot &&
    viewer.seatIndex !== base.czarSeat &&
    !viewer.hasSubmitted &&
    viewer.stagedCardIds.length === requiredPick

  const canViewerPickWinner =
    base.phase === "Judging" &&
    base.allRevealed &&
    czarPlayer !== undefined &&
    !czarPlayer.isBot &&
    (base.config.mode === "hotseat" || seatIndex === base.czarSeat)

  const canViewerRedraw =
    base.phase === "Submitting" &&
    viewer !== undefined &&
    !viewer.isBot &&
    viewer.seatIndex !== base.czarSeat &&
    !viewer.hasSubmitted &&
    !viewer.mulliganUsed

  const players = sanitizeOtherHands
    ? base.players.map((p) =>
        p.seatIndex === seatIndex
          ? p
          : {
              ...p,
              handCardIds: p.handCardIds.map(() => 0),
              stagedCardIds: []
            }
      )
    : base.players

  const submissions = sanitizeOtherHands
    ? base.submissions.map((sub) =>
        sub.revealed || base.phase === "RoundResult" || base.phase === "MatchOver"
          ? sub
          : {
              ...sub,
              ownerName: "Anonymous",
              cards: sub.cards.map((c) => ({ ...c, text: "Face down" }))
            }
      )
    : base.submissions

  return {
    ...base,
    players,
    submissions,
    viewerSeat: seatIndex,
    viewerHand: viewer !== undefined ? viewer.handCardIds.map((id) => getWhiteCard(id, base.customTexts)) : [],
    viewerStagedIds: viewer?.stagedCardIds ?? [],
    viewerSealArmed: viewer?.sealArmed ?? false,
    viewerInkSealsLeft: viewer?.inkSealsLeft ?? 0,
    viewerWriteInUsed: viewer?.writeInUsed ?? true,
    isViewerCzar,
    canViewerSubmit,
    canViewerPickWinner,
    canViewerRedraw
  }
}
