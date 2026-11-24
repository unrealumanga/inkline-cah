import type { InklineThemeId } from "../render/palette.ts"
import type { CardPackId } from "../sim/cards.ts"
import { ALL_PACK_IDS } from "../sim/cards.ts"

export interface SavedCombo {
  readonly id: string
  readonly savedAt: string
  readonly promptText: string
  readonly answerTexts: ReadonlyArray<string>
  readonly winnerName: string
  readonly czarName: string
  readonly remark: string
  readonly winReasons: ReadonlyArray<string>
}

export interface DailyRecord {
  readonly won: boolean
  readonly czarName: string
  readonly promptText: string
  readonly answerTexts: ReadonlyArray<string>
}

export interface CareerProfile {
  nickname: string
  theme: InklineThemeId
  selectedPacks: Array<CardPackId>
  xp: number
  roundsWon: number
  matchesWon: number
  bestStreak: number
  czarsBeaten: Array<string>
  botLossesTo: Record<string, number>
  achievements: Array<string>
  hallOfFame: Array<SavedCombo>
  customWhiteCards: Array<string>
  dailyResults: Record<string, DailyRecord>
}

export interface AchievementDef {
  readonly id: string
  readonly title: string
  readonly description: string
}

export const ACHIEVEMENTS: ReadonlyArray<AchievementDef> = [
  { id: "first-win", title: "First Stamp", description: "Win your first round on the drafting table." },
  { id: "hot-streak", title: "Hot Streak", description: "Win 3 rounds in a row." },
  { id: "pick2-combo", title: "Tag Combo", description: "Win a Pick-2 round with a ×1.5 tag combo." },
  { id: "ink-seal-win", title: "High Roller", description: "Win a round stamped with a 2× Ink Seal." },
  { id: "czar-whisperer", title: "Room Reader", description: "Win rounds judged by at least 3 different Bot Czars." },
  { id: "daily-victor", title: "Daily Draftsman", description: "Beat the Czar on a Daily Drafting Sheet." }
]

const STORAGE_KEY = "inkline-cah:profile:v2"
const MATURE_UNLOCK_KEY = "inkline-cah:packs-v3-migrated"

function defaultProfile(): CareerProfile {
  return {
    nickname: "You",
    theme: "sage",
    selectedPacks: [...ALL_PACK_IDS],
    xp: 0,
    roundsWon: 0,
    matchesWon: 0,
    bestStreak: 0,
    czarsBeaten: [],
    botLossesTo: {},
    achievements: [],
    hallOfFame: [],
    customWhiteCards: [],
    dailyResults: {}
  }
}

export function loadProfile(): CareerProfile {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return defaultProfile()
    const parsed = JSON.parse(raw) as Partial<CareerProfile>
    let selectedPacks: Array<CardPackId> =
      Array.isArray(parsed.selectedPacks) && parsed.selectedPacks.length > 0
        ? [...parsed.selectedPacks]
        : [...ALL_PACK_IDS]

    // Auto-enable the new 18+ vulgar packs once for existing profiles so they appear in the pool immediately
    if (window.localStorage.getItem(MATURE_UNLOCK_KEY) === null) {
      if (!selectedPacks.includes("afterdark")) selectedPacks.push("afterdark")
      if (!selectedPacks.includes("unhinged")) selectedPacks.push("unhinged")
      window.localStorage.setItem(MATURE_UNLOCK_KEY, "1")
    }

    return {
      ...defaultProfile(),
      ...parsed,
      selectedPacks,
      czarsBeaten: Array.isArray(parsed.czarsBeaten) ? parsed.czarsBeaten : [],
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
      hallOfFame: Array.isArray(parsed.hallOfFame) ? parsed.hallOfFame : [],
      customWhiteCards: Array.isArray(parsed.customWhiteCards) ? parsed.customWhiteCards : [],
      botLossesTo: parsed.botLossesTo && typeof parsed.botLossesTo === "object" ? parsed.botLossesTo : {},
      dailyResults: parsed.dailyResults && typeof parsed.dailyResults === "object" ? parsed.dailyResults : {}
    }
  } catch {
    return defaultProfile()
  }
}

export function saveProfile(profile: CareerProfile): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // Ignore storage quota / private-mode issues
  }
}

export function getPlayerLevel(xp: number): { readonly level: number; readonly currentXp: number; readonly neededXp: number } {
  const level = Math.floor(xp / 100) + 1
  return {
    level,
    currentXp: xp % 100,
    neededXp: 100
  }
}

export function getNemesis(profile: CareerProfile): { readonly name: string; readonly count: number } | null {
  let bestName = ""
  let bestCount = 0
  for (const [name, count] of Object.entries(profile.botLossesTo)) {
    if (count > bestCount) {
      bestCount = count
      bestName = name
    }
  }
  return bestCount >= 2 ? { name: bestName, count: bestCount } : null
}

export function getTodayDateString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
