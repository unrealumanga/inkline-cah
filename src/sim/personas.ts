import type { CardTag } from "./cards.ts"

export type PersonaId =
  | "human"
  | "archivist"
  | "draftsman"
  | "curator"
  | "auditor"
  | "surveyor"
  | "cartographer"
  | "calligrapher"

export interface BotPersonaProfile {
  readonly id: Exclude<PersonaId, "human">
  readonly name: string
  readonly loves: readonly [CardTag, CardTag]
  readonly dislikes: CardTag
  readonly title: string
  readonly playLines: ReadonlyArray<string>
  readonly winRemarks: ReadonlyArray<string>
  readonly loseLines: ReadonlyArray<string>
  readonly nemesisTaunts: ReadonlyArray<string>
}

export const BOT_PERSONAS: ReadonlyArray<BotPersonaProfile> = [
  {
    id: "archivist",
    name: "Archivist",
    loves: ["dry", "design"],
    dislikes: "chaos",
    title: "Keeper of Quiet Irony",
    playLines: [
      "Archivist slides a meticulously centered card onto the mat.",
      "Archivist adjusts their glasses and commits a dry remark.",
      "Archivist files an entry without breaking eye contact."
    ],
    winRemarks: [
      "Filed under 'irrefutable.'",
      "Impeccable drafting. Approved.",
      "Cataloged in permanent ink.",
      "Quietly devastating. Point awarded."
    ],
    loseLines: [
      "Archivist stamps 'APPEALED' in tiny pencil.",
      "Archivist sighs and cross-references the bylaws."
    ],
    nemesisTaunts: [
      "Archivist: Already indexed your defeat under Folio IV.",
      "Archivist: Predictable, yet somehow still disappointing."
    ]
  },
  {
    id: "draftsman",
    name: "Draftsman",
    loves: ["design", "tech"],
    dislikes: "absurd",
    title: "Precision Structuralist",
    playLines: [
      "Draftsman aligns their card parallel to the grid to 0.1 mm.",
      "Draftsman slides a card across smugly.",
      "Draftsman taps the compass twice and locks in."
    ],
    winRemarks: [
      "Clean line weight. Strong execution.",
      "Structurally sound comedy.",
      "Zero wasted ink. Brilliant.",
      "Measured to the millimeter."
    ],
    loseLines: [
      "Draftsman mutters about load-bearing punchlines.",
      "Draftsman furiously erases a margin note."
    ],
    nemesisTaunts: [
      "Draftsman: Your card wasn't even plumb with the margin.",
      "Draftsman: Another clean sweep on my drafting board."
    ]
  },
  {
    id: "curator",
    name: "Curator",
    loves: ["absurd", "social"],
    dislikes: "dry",
    title: "West-Wing Provocateur",
    playLines: [
      "Curator drops a card with gallery-opening flair.",
      "Curator whispers 'trust the negative space' and submits.",
      "Curator smirks and slides something wildly inappropriate."
    ],
    winRemarks: [
      "Belongs in the west wing immediately.",
      "Bold negative space. Unforgettable.",
      "The patrons will talk about this for weeks.",
      "Exquisite chaos. Well played."
    ],
    loseLines: [
      "Curator scoffs: 'Far too commercial for my taste.'",
      "Curator pretends they meant to lose ironically."
    ],
    nemesisTaunts: [
      "Curator: Darling, your punchline felt a bit derivative.",
      "Curator: Let me show you how the avant-garde scores."
    ]
  },
  {
    id: "auditor",
    name: "Auditor",
    loves: ["chaos", "tech"],
    dislikes: "social",
    title: "Compliance Gremlin",
    playLines: [
      "Auditor slams a card down like a surprise inspection.",
      "Auditor checks three boxes and submits menacingly.",
      "Auditor grins: 'Technically within policy.'"
    ],
    winRemarks: [
      "Surprisingly compliant with chaos policy.",
      "Reviewed and stamped without hesitation.",
      "That single-handedly broke the ledger.",
      "Exceeds all absurdist projections."
    ],
    loseLines: [
      "Auditor flags the round for a secondary audit.",
      "Auditor scribbles 'IRREGULARITY' in red ink."
    ],
    nemesisTaunts: [
      "Auditor: Your comedy margins are deeply in the red.",
      "Auditor: Non-compliant play. Point confiscated."
    ]
  },
  {
    id: "surveyor",
    name: "Surveyor",
    loves: ["social", "design"],
    dislikes: "tech",
    title: "Field Observer",
    playLines: [
      "Surveyor eyes the room and places a sharp social cut.",
      "Surveyor sketches a quick horizon line and commits."
    ],
    winRemarks: [
      "Dead-on topographic accuracy.",
      "Read the terrain like a pro.",
      "Uncomfortably accurate. Approved."
    ],
    loseLines: [
      "Surveyor recalibrates their tripod in silence."
    ],
    nemesisTaunts: [
      "Surveyor: I mapped your loss three rounds ago."
    ]
  },
  {
    id: "cartographer",
    name: "Cartographer",
    loves: ["absurd", "design"],
    dislikes: "social",
    title: "Dreamer of Impossible Maps",
    playLines: [
      "Cartographer folds a corner and slides in pure nonsense.",
      "Cartographer murmurs 'here be dragons' and submits."
    ],
    winRemarks: [
      "Uncharted territory! Instant classic.",
      "Beautifully unhinged geometry.",
      "Pinned straight to the atlas."
    ],
    loseLines: [
      "Cartographer draws a tiny sea monster over their score."
    ],
    nemesisTaunts: [
      "Cartographer: You wandered right off the edge of the map."
    ]
  },
  {
    id: "calligrapher",
    name: "Calligrapher",
    loves: ["dry", "absurd"],
    dislikes: "chaos",
    title: "Master of Deadpan Flourish",
    playLines: [
      "Calligrapher blots their nib and lays down dry brilliance.",
      "Calligrapher delivers a card with unnerving poise."
    ],
    winRemarks: [
      "Every stroke deliberate. Masterful.",
      "Deadpan perfection.",
      "A flourish worthy of vellum."
    ],
    loseLines: [
      "Calligrapher disapproves of the kerning on that win."
    ],
    nemesisTaunts: [
      "Calligrapher: Heavy-handed, as always."
    ]
  }
]

const PERSONA_MAP = new Map<PersonaId, BotPersonaProfile>(
  BOT_PERSONAS.map((p) => [p.id, p])
)

export function getBotPersona(id: PersonaId): BotPersonaProfile | undefined {
  return PERSONA_MAP.get(id)
}

export function formatPersonaTaste(id: PersonaId): {
  readonly loves: ReadonlyArray<CardTag>
  readonly dislikes: CardTag | null
  readonly summary: string
} {
  const p = getBotPersona(id)
  if (p === undefined) {
    return { loves: [], dislikes: null, summary: "Human Judge — Read the room!" }
  }
  return {
    loves: p.loves,
    dislikes: p.dislikes,
    summary: `Loves ${p.loves[0].toUpperCase()} & ${p.loves[1].toUpperCase()} · Dislikes ${p.dislikes.toUpperCase()}`
  }
}
