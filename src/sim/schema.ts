import { Clock, Descriptor, Random, Schema } from "@typeonce/ritmo"
import type { CardPackId } from "./cards.ts"
import type { PersonaId } from "./personas.ts"

export const STEP = Clock.hz(60)
export type StepHz = 60

export type GameMode = "bots" | "hotseat" | "lan" | "daily"

export type RevealPace = "normal" | "fast" | "manual"

export type RoundTwist = "none" | "rando" | "double-stakes" | "speed-draft"

export interface PlayerData {
  readonly seatIndex: number
  readonly name: string
  readonly isBot: boolean
  readonly persona: PersonaId
  readonly score: number
  readonly streak: number
  readonly mulliganUsed: boolean
  readonly inkSealsLeft: number
  readonly sealArmed: boolean
  readonly writeInUsed: boolean
  readonly handCardIds: ReadonlyArray<number>
  readonly stagedCardIds: ReadonlyArray<number>
  readonly hasSubmitted: boolean
}

export interface SubmissionData {
  readonly ownerSeat: number // -1 for Rando Cardrissian phantom deck entry
  readonly cardIds: ReadonlyArray<number>
  readonly slotIndex: number
  readonly revealed: boolean
  readonly winner: boolean
  readonly sealed: boolean
}

export interface MatchConfigData {
  readonly playerCount: number
  readonly targetPoints: number
  readonly mode: GameMode
  readonly handSize: number
  readonly packs: ReadonlyArray<CardPackId>
  readonly playerNames: ReadonlyArray<string>
  readonly twistsEnabled: boolean
  readonly timerSeconds: number
  readonly dailyDate: string | null
  readonly revealPace: RevealPace
  readonly customWhitePool: ReadonlyArray<string>
}

export interface DeckStateData {
  readonly blackDraw: ReadonlyArray<number>
  readonly blackDiscard: ReadonlyArray<number>
  readonly whiteDraw: ReadonlyArray<number>
  readonly whiteDiscard: ReadonlyArray<number>
}

export interface CustomCardsData {
  readonly nextWriteInId: number
  readonly texts: Readonly<Record<number, string>>
}

export interface RoundStateData {
  readonly roundNumber: number
  readonly czarSeat: number
  readonly activeBlackCardId: number | null
  readonly activeTurnSeat: number
  readonly twist: RoundTwist
  readonly winnerSeat: number | null
  readonly winningCardIds: ReadonlyArray<number>
  readonly pointsAwarded: number
  readonly isComboWin: boolean
  readonly sealTriggered: boolean
  readonly winReasons: ReadonlyArray<string>
  readonly czarRemark: string
  readonly loserReaction: string
  readonly botActionAt: Clock.Deadline<StepHz> | null
  readonly roundDeadlineAt: Clock.Deadline<StepHz> | null
}

export interface ChronicleEntry {
  readonly roundNumber: number
  readonly blackCardId: number
  readonly winningCardIds: ReadonlyArray<number>
  readonly winningCardTexts: ReadonlyArray<string>
  readonly winnerSeat: number
  readonly winnerName: string
  readonly czarName: string
  readonly remark: string
  readonly winReasons: ReadonlyArray<string>
  readonly isComboWin: boolean
  readonly pointsAwarded: number
}

export interface ChronicleData {
  readonly entries: ReadonlyArray<ChronicleEntry>
}

export type CueKind = "deal" | "select" | "submit" | "flip" | "award" | "redraw" | "victory" | "seal" | "tick" | "reaction"

export interface TableCueItem {
  readonly seq: number
  readonly kind: CueKind
  readonly seat: number
  readonly message: string
}

export interface TableFeedbackData {
  readonly nextSeq: number
  readonly cues: ReadonlyArray<TableCueItem>
}

export type PlayerIntent =
  | { readonly _tag: "ToggleCard"; readonly seat: number; readonly cardId: number }
  | { readonly _tag: "ToggleInkSeal"; readonly seat: number }
  | { readonly _tag: "PlayWriteIn"; readonly seat: number; readonly text: string }
  | { readonly _tag: "SubmitStaged"; readonly seat: number }
  | { readonly _tag: "RedrawHand"; readonly seat: number }
  | { readonly _tag: "RevealSubmission"; readonly slotIndex: number }
  | { readonly _tag: "PickWinner"; readonly slotIndex: number }
  | { readonly _tag: "AdvanceRound"; readonly fastForward: boolean }
  | { readonly _tag: "SetRevealPace"; readonly pace: RevealPace }
  | { readonly _tag: "SendReaction"; readonly seat: number; readonly label: string }
  | {
      readonly _tag: "NewMatch"
      readonly playerCount: number
      readonly targetPoints: number
      readonly mode: GameMode
      readonly seed: number
      readonly packs?: ReadonlyArray<CardPackId>
      readonly playerNames?: ReadonlyArray<string>
      readonly twistsEnabled?: boolean
      readonly timerSeconds?: number
      readonly dailyDate?: string | null
      readonly customWhitePool?: ReadonlyArray<string>
    }

// ── Descriptors ──────────────────────────────────────────────────────────

export const Time = Clock.resource("Cah/Time", STEP)
export const Rng = Descriptor.ConstructedResource(Random.codec)("Cah/Rng")

export const Player = Descriptor.Component<PlayerData>()("Cah/Player")
export const Submission = Descriptor.Component<SubmissionData>()("Cah/Submission")

export const MatchConfig = Descriptor.Resource<MatchConfigData>()("Cah/MatchConfig")
export const DeckState = Descriptor.Resource<DeckStateData>()("Cah/DeckState")
export const CustomCards = Descriptor.Resource<CustomCardsData>()("Cah/CustomCards")
export const RoundState = Descriptor.Resource<RoundStateData>()("Cah/RoundState")
export const Chronicle = Descriptor.Resource<ChronicleData>()("Cah/Chronicle")
export const TableFeedback = Descriptor.Resource<TableFeedbackData>()("Cah/TableFeedback")

export const Intent = Descriptor.Event<PlayerIntent>()("Cah/Intent")

const CahFragment = Schema.fragment({
  components: { Player, Submission },
  resources: { Time, Rng, MatchConfig, DeckState, CustomCards, RoundState, Chronicle, TableFeedback },
  events: { Intent }
})

type CahSchemaOf = typeof CahFragment
export interface CahSchema extends CahSchemaOf {}

const namedSchema: CahSchema = CahFragment
const Root = Schema.defineRoot("Cah")
export const Game = Schema.bind(namedSchema, Root)

export const RoundPhase = Game.StateMachine(
  "Cah/RoundPhase",
  {
    Setup: {},
    Submitting: {},
    Judging: {},
    RoundResult: {},
    MatchOver: {}
  },
  {
    transitions: {
      Setup: ["Submitting"],
      Submitting: ["Judging", "Setup"],
      Judging: ["RoundResult", "Setup"],
      RoundResult: ["Submitting", "MatchOver", "Setup"],
      MatchOver: ["Setup"]
    }
  }
)

export type RoundPhaseTag = "Setup" | "Submitting" | "Judging" | "RoundResult" | "MatchOver"
