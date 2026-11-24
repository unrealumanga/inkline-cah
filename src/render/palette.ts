export type InklineThemeId = "sage" | "blueprint" | "vellum" | "charcoal" | "vermilion"

export interface InklineThemePalette {
  readonly id: InklineThemeId
  readonly name: string
  readonly unlockLevel: number
  readonly paperBg: string
  readonly paperCard: string
  readonly paperRecessed: string
  readonly paperHover: string
  readonly paperGrid: string
  readonly paperShadow: string
  readonly inkPrimary: string
  readonly inkDeep: string
  readonly inkMuted: string
  readonly inkFaint: string
  readonly borderLine: string
  readonly borderSoft: string
  readonly blackCardFill: string
  readonly blackCardBack: string
  readonly blackCardEdge: string
  readonly blackCardInner: string
  readonly blackCardText: string
  readonly accentBlue: string
  readonly accentBlueWash: string
  readonly accentBlueBorder: string
  readonly accentRed: string
  readonly accentRedWash: string
  readonly accentGreen: string
  readonly accentGreenWash: string
}

export const INKLINE_THEMES: Record<InklineThemeId, InklineThemePalette> = {
  sage: {
    id: "sage",
    name: "Sage Paper",
    unlockLevel: 1,
    paperBg: "#f0f2ec",
    paperCard: "#f7f8f4",
    paperRecessed: "#eef0ea",
    paperHover: "#eceee8",
    paperGrid: "#dfe3da",
    paperShadow: "#d5dad0",
    inkPrimary: "#3d4943",
    inkDeep: "#28332e",
    inkMuted: "#77817a",
    inkFaint: "#8a938c",
    borderLine: "#c9cec4",
    borderSoft: "#e0e3db",
    blackCardFill: "#2b3530",
    blackCardBack: "#242d28",
    blackCardEdge: "#181f1b",
    blackCardInner: "#515f58",
    blackCardText: "#f2f4ee",
    accentBlue: "#2f5a9c",
    accentBlueWash: "#eef3fb",
    accentBlueBorder: "#c9d6ee",
    accentRed: "#b04a39",
    accentRedWash: "#faefed",
    accentGreen: "#4f8a3e",
    accentGreenWash: "#eef6eb"
  },
  blueprint: {
    id: "blueprint",
    name: "Blueprint Cyan",
    unlockLevel: 1,
    paperBg: "#e8eff7",
    paperCard: "#f4f8fc",
    paperRecessed: "#e2ebf5",
    paperHover: "#dce6f2",
    paperGrid: "#cfdeef",
    paperShadow: "#c4d4e6",
    inkPrimary: "#234066",
    inkDeep: "#162b47",
    inkMuted: "#5e7696",
    inkFaint: "#7b91ad",
    borderLine: "#b4c7de",
    borderSoft: "#d5e2f0",
    blackCardFill: "#1a304d",
    blackCardBack: "#13243b",
    blackCardEdge: "#0d1a2b",
    blackCardInner: "#46638a",
    blackCardText: "#f0f6fc",
    accentBlue: "#1d5fbf",
    accentBlueWash: "#e3eefc",
    accentBlueBorder: "#b0cdf2",
    accentRed: "#b8483c",
    accentRedWash: "#faeae8",
    accentGreen: "#2f7d57",
    accentGreenWash: "#e7f5ee"
  },
  vellum: {
    id: "vellum",
    name: "Warm Vellum",
    unlockLevel: 2,
    paperBg: "#f3eee3",
    paperCard: "#faf7f0",
    paperRecessed: "#ece5d8",
    paperHover: "#e7dfd0",
    paperGrid: "#dfd7c6",
    paperShadow: "#d4cbb8",
    inkPrimary: "#473c30",
    inkDeep: "#2e261d",
    inkMuted: "#7f7264",
    inkFaint: "#968a7c",
    borderLine: "#ccc2b0",
    borderSoft: "#e2dacb",
    blackCardFill: "#332a22",
    blackCardBack: "#29211b",
    blackCardEdge: "#1c1611",
    blackCardInner: "#5c4f43",
    blackCardText: "#f8f4ec",
    accentBlue: "#365a8a",
    accentBlueWash: "#edf2f8",
    accentBlueBorder: "#c5d3e6",
    accentRed: "#a84432",
    accentRedWash: "#f9ece8",
    accentGreen: "#4c7d3c",
    accentGreenWash: "#edf5ea"
  },
  vermilion: {
    id: "vermilion",
    name: "Vermilion Ink",
    unlockLevel: 3,
    paperBg: "#f5f1ee",
    paperCard: "#fcfaf8",
    paperRecessed: "#eee8e3",
    paperHover: "#e8e0da",
    paperGrid: "#e2d9d2",
    paperShadow: "#d6cbc3",
    inkPrimary: "#4a332f",
    inkDeep: "#2e1d1a",
    inkMuted: "#846d68",
    inkFaint: "#9a847f",
    borderLine: "#d1c3bc",
    borderSoft: "#e5dbd5",
    blackCardFill: "#332220",
    blackCardBack: "#281a18",
    blackCardEdge: "#1c110f",
    blackCardInner: "#634642",
    blackCardText: "#faf5f2",
    accentBlue: "#a83c2c",
    accentBlueWash: "#faece9",
    accentBlueBorder: "#e4beb7",
    accentRed: "#b83227",
    accentRedWash: "#fceae8",
    accentGreen: "#3f7a46",
    accentGreenWash: "#eaf4eb"
  },
  charcoal: {
    id: "charcoal",
    name: "Night Studio",
    unlockLevel: 4,
    paperBg: "#1d2420",
    paperCard: "#26302b",
    paperRecessed: "#202824",
    paperHover: "#2e3933",
    paperGrid: "#2e3a34",
    paperShadow: "#141a17",
    inkPrimary: "#dfe5dc",
    inkDeep: "#f4f7f2",
    inkMuted: "#9aa69e",
    inkFaint: "#7d8a81",
    borderLine: "#414f48",
    borderSoft: "#323e38",
    blackCardFill: "#121714",
    blackCardBack: "#0e1210",
    blackCardEdge: "#4f5f57",
    blackCardInner: "#3b4741",
    blackCardText: "#eef2eb",
    accentBlue: "#72a1e5",
    accentBlueWash: "#1e2e45",
    accentBlueBorder: "#3a567d",
    accentRed: "#e07a68",
    accentRedWash: "#3d221d",
    accentGreen: "#7ec46c",
    accentGreenWash: "#1f361c"
  }
}

export const INKLINE = INKLINE_THEMES.sage

export const CARD_DIMS = {
  width: 1.62,
  thickness: 0.044,
  depth: 2.26
} as const

export function applyThemeToDocument(theme: InklineThemePalette): void {
  const root = document.documentElement.style
  root.setProperty("--paper-bg", theme.paperBg)
  root.setProperty("--paper-card", theme.paperCard)
  root.setProperty("--paper-recessed", theme.paperRecessed)
  root.setProperty("--paper-hover", theme.paperHover)
  root.setProperty("--border", theme.borderLine)
  root.setProperty("--border-soft", theme.borderSoft)
  root.setProperty("--shadow", theme.paperShadow)
  root.setProperty("--ink", theme.inkPrimary)
  root.setProperty("--ink-deep", theme.inkDeep)
  root.setProperty("--ink-muted", theme.inkMuted)
  root.setProperty("--ink-faint", theme.inkFaint)
  root.setProperty("--blue", theme.accentBlue)
  root.setProperty("--blue-wash", theme.accentBlueWash)
  root.setProperty("--blue-border", theme.accentBlueBorder)
  root.setProperty("--red", theme.accentRed)
  root.setProperty("--red-wash", theme.accentRedWash)
  root.setProperty("--green", theme.accentGreen)
  root.setProperty("--green-wash", theme.accentGreenWash)
}
