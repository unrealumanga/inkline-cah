import { Clock, type Debug, Random } from "@typeonce/ritmo"
import { ALL_PACK_IDS, type CardPackId, WRITE_IN_CARD_BASE_ID } from "./cards.ts"
import {
  Game,
  RoundPhase,
  STEP,
  type GameMode,
  type RevealPace
} from "./schema.ts"
import {
  AdvanceTime,
  BootstrapMatch,
  HandleIntents,
  RunBotJudging,
  RunBotSubmissions
} from "./systems.ts"

export * from "./cards.ts"
export * from "./personas.ts"
export * from "./schema.ts"
export * from "./systems.ts"
export * from "./inspectors.ts"

export const setupSchedule = Game.Schedule(
  BootstrapMatch,
  Game.Schedule.applyDeferred(),
  Game.Schedule.applyStateTransitions()
)

export const updateSchedule = Game.Schedule(
  AdvanceTime,
  HandleIntents,
  Game.Schedule.applyDeferred(),
  Game.Schedule.applyStateTransitions(),
  BootstrapMatch,
  Game.Schedule.applyDeferred(),
  Game.Schedule.applyStateTransitions(),
  RunBotSubmissions,
  Game.Schedule.applyDeferred(),
  Game.Schedule.applyStateTransitions(),
  RunBotJudging,
  Game.Schedule.applyStateTransitions()
)

export interface MakeSimulationOptions {
  readonly seed?: number
  readonly playerCount?: number
  readonly targetPoints?: number
  readonly mode?: GameMode
  readonly packs?: ReadonlyArray<CardPackId>
  readonly playerNames?: ReadonlyArray<string>
  readonly twistsEnabled?: boolean
  readonly timerSeconds?: number
  readonly dailyDate?: string | null
  readonly revealPace?: RevealPace
  readonly customWhitePool?: ReadonlyArray<string>
  readonly debug?: Debug.Option
}

/** Deterministic FNV-1a 32-bit hash for Daily Sheet YYYY-MM-DD seeds */
export function seedFromDateString(dateStr: string): number {
  let h = 2166136261
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

export function makeSimulation(options: MakeSimulationOptions = {}) {
  const seed = options.seed ?? 0x1a2b3c4d
  const playerCount = Math.max(3, Math.min(8, options.playerCount ?? 4))
  const targetPoints = Math.max(1, Math.min(12, options.targetPoints ?? 5))
  const mode: GameMode = options.mode ?? "bots"

  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: {
      Time: Clock.start(STEP),
      Rng: Random.seed(seed),
      MatchConfig: {
        playerCount,
        targetPoints,
        mode,
        handSize: 7,
        packs: options.packs && options.packs.length > 0 ? options.packs : ALL_PACK_IDS,
        playerNames: options.playerNames ?? ["You"],
        twistsEnabled: options.twistsEnabled ?? true,
        timerSeconds: options.timerSeconds ?? 0,
        dailyDate: options.dailyDate ?? null,
        revealPace: options.revealPace ?? "normal",
        customWhitePool: options.customWhitePool ?? []
      },
      DeckState: {
        blackDraw: [],
        blackDiscard: [],
        whiteDraw: [],
        whiteDiscard: []
      },
      CustomCards: {
        nextWriteInId: WRITE_IN_CARD_BASE_ID + 1,
        texts: {}
      },
      RoundState: {
        roundNumber: 0,
        czarSeat: 0,
        activeBlackCardId: null,
        activeTurnSeat: 0,
        twist: "none",
        winnerSeat: null,
        winningCardIds: [],
        pointsAwarded: 1,
        isComboWin: false,
        sealTriggered: false,
        winReasons: [],
        czarRemark: "",
        loserReaction: "",
        botActionAt: null,
        roundDeadlineAt: null
      },
      Chronicle: {
        entries: []
      },
      TableFeedback: {
        nextSeq: 1,
        cues: []
      }
    },
    machines: Game.Runtime.machines(
      Game.Runtime.machine(RoundPhase, { _tag: "Setup" })
    ),
    debug: options.debug
  })

  if (!made.ok) {
    throw new Error(`Failed to initialize Inkline CAH runtime: ${JSON.stringify(made.error)}`)
  }

  return made.value
}

export type CahRuntime = ReturnType<typeof makeSimulation>
