import { HostClock } from "@typeonce/ritmo"
import { Determinism, Invariant, Session } from "@typeonce/ritmo-devtools"
import { describe, expect, it } from "vitest"
import {
  BLACK_CARDS,
  formatCompletedSentencePlain,
  Game,
  Intent,
  makeSimulation,
  Player,
  projectTableViewForSeat,
  seedFromDateString,
  setupSchedule,
  TableViewInspector,
  updateSchedule,
  WHITE_CARDS
} from "../src/sim/index.ts"

const NoNegativeScoresOrDuplicateHands = Invariant.fromInspector(
  Game.Inspector(
    "Cah/Invariant/ValidHandsAndScores",
    {
      queries: {
        players: Game.Query({ selection: { player: Game.Query.read(Player) } })
      }
    },
    ({ queries }) => {
      const seenCards = new Set<number>()
      for (const entity of queries.players.each()) {
        const p = queries.players.data.player.get(entity)
        if (p.score < 0) return `Player ${p.name} has negative score ${p.score}`
        for (const cardId of p.handCardIds) {
          if (seenCards.has(cardId)) return `Duplicate white card ${cardId} held in hands`
          seenCards.add(cardId)
        }
      }
      return undefined
    }
  )
)

function makeTestSession(
  seed = 101,
  playerCount = 4,
  targetPoints = 3,
  extra: Parameters<typeof makeSimulation>[0] = {}
) {
  const hostClock = HostClock.test()
  const runtime = makeSimulation({
    seed,
    playerCount,
    targetPoints,
    mode: "bots",
    ...extra,
    debug: { hostClock }
  })
  const session = Session.make(runtime, {
    hostClock,
    schedules: { setup: setupSchedule, update: updateSchedule },
    hostEvents: [Intent],
    invariants: [NoNegativeScoresOrDuplicateHands]
  })
  const setupRun = session.run("setup")
  expect(setupRun.data.ok).toBe(true)
  return { runtime, session }
}

describe("Inkline Against Humanity — Ritmo ECS simulation", () => {
  it("ships expanded themed decks including 18+ vulgar packs (200 black, 560 white) and builds completed sentences", () => {
    expect(BLACK_CARDS.length).toBeGreaterThanOrEqual(200)
    expect(WHITE_CARDS.length).toBeGreaterThanOrEqual(560)
    expect(BLACK_CARDS.filter((c) => c.pack === "afterdark" || c.pack === "unhinged").length).toBeGreaterThanOrEqual(80)
    expect(WHITE_CARDS.filter((c) => c.pack === "afterdark" || c.pack === "unhinged").length).toBeGreaterThanOrEqual(240)

    const filled = formatCompletedSentencePlain(
      "Step 1: ______. Step 2: ______. Step 3: Profit.",
      ["A goose with diplomatic immunity.", "Zero-latency existential dread."]
    )
    expect(filled).toBe(
      "Step 1: A goose with diplomatic immunity. Step 2: Zero-latency existential dread. Step 3: Profit."
    )
  })

  it("supports up to 8 players with custom nicknames, Czar tastes, Ink Seal 2x, and Write-In cards", () => {
    const { runtime, session } = makeTestSession(777, 8, 5, {
      playerNames: ["Sandro"]
    })
    const view = runtime.inspect(TableViewInspector)

    expect(view.phase).toBe("Submitting")
    expect(view.players).toHaveLength(8)
    expect(view.players[0]!.name).toBe("Sandro")
    expect(view.czarTaste.isBot).toBe(true)
    expect(view.czarTaste.loves).toHaveLength(2)
    expect(view.czarTaste.dislikes).not.toBeNull()

    // Arm Ink Seal 2× and inscribe a custom Write-In card
    runtime.send(Intent, { _tag: "ToggleInkSeal", seat: 0 })
    runtime.send(Intent, { _tag: "PlayWriteIn", seat: 0, text: "A 3D blueprint of my weekend." })
    expect(session.run("update", { frames: 2 }).data.ok).toBe(true)

    const staged = runtime.inspect(TableViewInspector)
    expect(staged.viewerSealArmed).toBe(true)
    expect(staged.viewerWriteInUsed).toBe(true)
    expect(staged.viewerHand.some((c) => c.text === "A 3D blueprint of my weekend.")).toBe(true)

    // Ensure required pick count is met before submitting
    const pick = staged.activeBlackCard!.pick
    if (staged.viewerStagedIds.length < pick) {
      runtime.send(Intent, { _tag: "ToggleCard", seat: 0, cardId: staged.viewerHand[0]!.id })
      expect(session.run("update", { frames: 1 }).data.ok).toBe(true)
    }

    runtime.send(Intent, { _tag: "SubmitStaged", seat: 0 })
    const toResult = session.run("update", {
      frames: 900,
      until: () => runtime.inspect(TableViewInspector).phase === "RoundResult"
    })
    expect(toResult.data.ok).toBe(true)

    const resultView = runtime.inspect(TableViewInspector)
    expect(resultView.phase).toBe("RoundResult")
    expect(resultView.winReasons.length).toBeGreaterThan(0)
    expect(resultView.players[0]!.inkSealsLeft).toBe(0)
    expect(resultView.chronicle).toHaveLength(1)
  })

  it("sanitizes opponent hands when projecting TableView for LAN multiplayer seats", () => {
    const { runtime } = makeTestSession(555, 6, 5, {
      mode: "lan",
      playerNames: ["Alice", "Bob", "Cara", "Dan", "Eve", "Frank"]
    })
    const raw = runtime.inspect(TableViewInspector)
    const seat2View = projectTableViewForSeat(raw, 2, true)

    expect(seat2View.viewerSeat).toBe(2)
    expect(seat2View.viewerHand).toHaveLength(7)
    // Seat 2's own hand IDs are intact, while other seats are zeroed out for privacy!
    expect(seat2View.players[2]!.handCardIds.every((id) => id > 0)).toBe(true)
    expect(seat2View.players[0]!.handCardIds.every((id) => id === 0)).toBe(true)
    expect(seat2View.players[1]!.handCardIds.every((id) => id === 0)).toBe(true)
  })

  it("produces identical Daily Drafting Sheet cards for the same YYYY-MM-DD seed", () => {
    const dailySeed = seedFromDateString("inkline-daily-2026-11-24")
    const a = makeTestSession(dailySeed, 4, 1, { mode: "daily", dailyDate: "2026-11-24" })
    const b = makeTestSession(dailySeed, 4, 1, { mode: "daily", dailyDate: "2026-11-24" })

    const viewA = a.runtime.inspect(TableViewInspector)
    const viewB = b.runtime.inspect(TableViewInspector)
    expect(viewA.activeBlackCard?.id).toBe(viewB.activeBlackCard?.id)
    expect(viewA.viewerHand.map((c) => c.id)).toEqual(viewB.viewerHand.map((c) => c.id))
  })

  it("lets human player judge and award the point when they are Card Czar, and reaches MatchOver", () => {
    const { runtime, session } = makeTestSession(2026, 3, 2)

    let safety = 0
    while (runtime.inspect(TableViewInspector).phase !== "MatchOver" && safety < 20) {
      safety += 1
      const view = runtime.inspect(TableViewInspector)

      if (view.phase === "Submitting") {
        if (view.czarSeat !== 0 && !view.players[0]!.hasSubmitted) {
          const pick = view.activeBlackCard!.pick
          for (let i = 0; i < pick; i++) {
            runtime.send(Intent, { _tag: "ToggleCard", seat: 0, cardId: view.viewerHand[i]!.id })
          }
          runtime.send(Intent, { _tag: "SubmitStaged", seat: 0 })
        }
        const toJudging = session.run("update", {
          frames: 300,
          until: () => runtime.inspect(TableViewInspector).phase === "Judging"
        })
        expect(toJudging.data.ok).toBe(true)
      } else if (view.phase === "Judging") {
        if (view.czarSeat === 0) {
          runtime.send(Intent, { _tag: "RevealSubmission", slotIndex: -1 })
          expect(session.run("update", { frames: 2 }).data.ok).toBe(true)
          const revealedView = runtime.inspect(TableViewInspector)
          expect(revealedView.allRevealed).toBe(true)
          expect(revealedView.canViewerPickWinner).toBe(true)

          runtime.send(Intent, { _tag: "PickWinner", slotIndex: 0 })
          expect(session.run("update", { frames: 2 }).data.ok).toBe(true)
        } else {
          const toResult = session.run("update", {
            frames: 500,
            until: () => runtime.inspect(TableViewInspector).phase === "RoundResult"
          })
          expect(toResult.data.ok).toBe(true)
        }
      } else if (view.phase === "RoundResult") {
        runtime.send(Intent, { _tag: "AdvanceRound", fastForward: false })
        expect(session.run("update", { frames: 2 }).data.ok).toBe(true)
      }
    }

    const finalView = runtime.inspect(TableViewInspector)
    expect(finalView.phase).toBe("MatchOver")
    expect(finalView.players.some((p) => p.score >= 2)).toBe(true)
  })

  it("is bit-for-bit deterministic under Ritmo Determinism.check", () => {
    const result = Determinism.check(
      ({ hostClock }) => {
        const runtime = makeSimulation({
          seed: 9999,
          playerCount: 5,
          targetPoints: 5,
          mode: "bots",
          debug: { hostClock }
        })
        const setupRes = runtime.tick(setupSchedule)
        if (!setupRes.ok) throw new Error("Setup failed")
        return {
          runtime,
          schedules: { update: updateSchedule }
        }
      },
      {
        schedule: "update",
        frames: 240,
        hostClock: HostClock.test()
      }
    )

    expect(result.ok).toBe(true)
  })
})
