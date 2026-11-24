import * as THREE from "three"
import type { BlackCard, WhiteCard } from "../sim/cards.ts"
import type { TableView } from "../sim/inspectors.ts"
import { CardTextureCache } from "./cardTextures.ts"
import { CARD_DIMS, INKLINE_THEMES, type InklineThemePalette } from "./palette.ts"

export type CameraPreset = "table" | "hand" | "judge" | "top"

export type PickedCardTarget =
  | { readonly kind: "hand"; readonly cardId: number; readonly card: WhiteCard }
  | {
      readonly kind: "submission"
      readonly slotIndex: number
      readonly revealed: boolean
      readonly ownerName: string
      readonly winner: boolean
      readonly cards: ReadonlyArray<WhiteCard>
    }
  | { readonly kind: "black"; readonly card: BlackCard }

export interface SceneCallbacks {
  readonly onHover: (target: PickedCardTarget | null, clientX: number, clientY: number) => void
  readonly onClick: (target: PickedCardTarget) => void
  readonly onDoubleClick: (target: PickedCardTarget) => void
}

interface CardRig {
  readonly group: THREE.Group
  readonly mesh: THREE.Mesh
  readonly outline: THREE.LineSegments
  readonly outlineMat: THREE.LineBasicMaterial
  readonly shadowMesh: THREE.Mesh
  readonly shadowMat: THREE.MeshBasicMaterial
  readonly materials: Array<THREE.MeshBasicMaterial>
  targetPos: THREE.Vector3
  targetRot: THREE.Euler
  targetScale: number
  currentScale: number
  highlightColor: string
  pickTarget: PickedCardTarget | null
  lastFaceKey: string
  dealDelay: number
  slotIndex: number | null
}

interface Ripple {
  readonly mesh: THREE.Mesh
  readonly mat: THREE.MeshBasicMaterial
  age: number
  readonly maxAge: number
}

interface SplatterParticle {
  readonly mesh: THREE.Mesh
  readonly mat: THREE.MeshBasicMaterial
  readonly vel: THREE.Vector3
  readonly spin: number
  age: number
  readonly maxAge: number
}

// Tuned so all 7 cards fit cleanly inside 1440×900 & 1280×720 without clipping or toolbar overlap,
// and Judging snaps to an elevated flat top-angled frame!
const CAMERA_PRESETS: Record<
  CameraPreset,
  { readonly pos: [number, number, number]; readonly look: [number, number, number] }
> = {
  table: { pos: [0, 12.8, 12.0], look: [0, 0.1, 0.85] },
  hand: { pos: [0, 8.2, 11.4], look: [0, 0.25, 2.8] },
  judge: { pos: [0.35, 14.2, 4.4], look: [0.35, 0.05, -0.4] },
  top: { pos: [0, 16.8, 1.8], look: [0, 0, 0.35] }
}

function makeEdgeLines(geometry: THREE.BufferGeometry, color: string, opacity = 1): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(geometry, 25)
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity
  })
  return new THREE.LineSegments(edges, mat)
}

function makeDraftingBoardTexture(theme: InklineThemePalette): THREE.CanvasTexture {
  const size = 1024
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!

  ctx.fillStyle = theme.paperCard
  ctx.fillRect(0, 0, size, size)

  // Architectural drafting grid
  ctx.strokeStyle = theme.paperGrid
  ctx.lineWidth = 1
  const step = 32
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i)
    ctx.lineTo(size, i)
    ctx.stroke()
  }

  // Major crosshairs
  ctx.strokeStyle = theme.borderLine
  ctx.lineWidth = 1.5
  for (let y = 0; y <= size; y += step * 4) {
    for (let x = 0; x <= size; x += step * 4) {
      ctx.beginPath()
      ctx.moveTo(x - 6, y)
      ctx.lineTo(x + 6, y)
      ctx.moveTo(x, y - 6)
      ctx.lineTo(x, y + 6)
      ctx.stroke()
    }
  }

  ctx.strokeStyle = theme.borderLine
  ctx.lineWidth = 3
  ctx.strokeRect(20, 20, size - 40, size - 40)

  ctx.strokeStyle = theme.inkPrimary
  ctx.lineWidth = 2
  ctx.strokeRect(32, 32, size - 64, size - 64)

  // Central submission mat dashed outline
  ctx.save()
  ctx.setLineDash([10, 8])
  ctx.strokeStyle = theme.inkFaint
  ctx.lineWidth = 2
  ctx.strokeRect(130, 200, size - 260, 420)
  ctx.restore()

  ctx.font = '600 14px ui-monospace, "SF Mono", Menlo, monospace'
  ctx.fillStyle = theme.inkFaint
  ctx.fillText(`SHEET 01 // INKLINE DRAFTING TABLE (${theme.name.toUpperCase()})`, 50, 56)
  ctx.fillText("JUDGING MAT", 146, 224)
  ctx.fillText("SCALE 1:1", size - 134, 56)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/**
 * Seats up to 8 players cleanly around the outer perimeter of the drafting board,
 * with zero overlap against the active Black Card or judging mat!
 */
function getSeatAnchor(
  seatIndex: number,
  viewerSeat: number,
  totalPlayers: number
): { x: number; z: number; yaw: number; trophyX: number; trophyZ: number } {
  const rel = (seatIndex - viewerSeat + totalPlayers) % totalPlayers
  if (rel === 0) {
    return { x: 0, z: 5.2, yaw: 0, trophyX: 6.2, trophyZ: 3.8 }
  }

  const oppCount = Math.max(1, totalPlayers - 1)
  const idx = rel - 1
  // Fan opponents cleanly along a wide elliptical perimeter arc (left -> top -> right)
  const frac = oppCount === 1 ? 0.5 : idx / (oppCount - 1)
  const angle = Math.PI * (0.14 + frac * 0.72) // ~25 deg to ~155 deg
  const rx = 7.75
  const rz = 5.55
  const x = -Math.cos(angle) * rx
  const z = -Math.sin(angle) * rz - 0.15
  const yaw = Math.atan2(-x, -z)

  // Put trophy stacks further outward along the table rim so they NEVER collide with cards
  const trophyX = x * 0.92 + (x < -1 ? -0.65 : x > 1 ? 0.65 : 1.55)
  const trophyZ = z * 0.92 + (z < -3.5 ? 0.45 : -1.15)
  return { x, z, yaw, trophyX, trophyZ }
}

export class InklineTableScene {
  private readonly container: HTMLElement
  private readonly callbacks: SceneCallbacks
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly textures = new CardTextureCache()
  private readonly cardGeom: THREE.BoxGeometry
  private readonly shadowGeom: THREE.PlaneGeometry
  private readonly particleGeom: THREE.BoxGeometry

  private theme: InklineThemePalette = INKLINE_THEMES.sage
  private boardMesh: THREE.Mesh | null = null
  private boardShadowMesh: THREE.Mesh | null = null

  private readonly cardRigs = new Map<string, CardRig>()
  private readonly interactiveMeshes: Array<THREE.Mesh> = []
  private readonly meshToRig = new Map<THREE.Mesh, CardRig>()
  private readonly ripples: Array<Ripple> = []
  private readonly splatters: Array<SplatterParticle> = []

  private readonly czarCrown: THREE.Group
  private readonly czarTargetPos = new THREE.Vector3(0, 0.35, -4)
  private readonly blackDeckGroup: THREE.Group
  private readonly whiteDeckGroup: THREE.Group
  private readonly trophyGroup: THREE.Group
  private readonly opponentHandsGroup: THREE.Group

  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2(-99, -99)
  private hoveredRig: CardRig | null = null
  private externalHighlightSlot: number | null = null
  private lastPointerX = 0
  private lastPointerY = 0
  private lastClickAt = 0
  private lastClickRig: CardRig | null = null

  private cameraPreset: CameraPreset = "table"
  private cameraZoom = 1
  private orbitYaw = 0
  private orbitPitch = 0
  private isDraggingOrbit = false
  private dragMoved = false
  private dragStartX = 0
  private dragStartY = 0
  private dragBaseYaw = 0
  private dragBasePitch = 0

  private readonly currentCamPos = new THREE.Vector3(0, 12.8, 12.0)
  private readonly currentCamLook = new THREE.Vector3(0, 0.1, 0.85)
  private winnerFocusPos: THREE.Vector3 | null = null

  private latestView: TableView | null = null
  private lastSyncedSignature = ""
  private lastWinnerCelebrationKey = ""
  private elapsedSeconds = 0

  constructor(container: HTMLElement, callbacks: SceneCallbacks) {
    this.container = container
    this.callbacks = callbacks

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(this.theme.paperBg)
    this.scene.fog = new THREE.Fog(this.theme.paperBg, 28, 56)

    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    this.camera = new THREE.PerspectiveCamera(this.computeFov(width, height), width / height, 0.1, 120)
    this.camera.position.copy(this.currentCamPos)
    this.camera.lookAt(this.currentCamLook)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.className = "world-canvas"
    container.appendChild(this.renderer.domElement)

    this.cardGeom = new THREE.BoxGeometry(CARD_DIMS.width, CARD_DIMS.thickness, CARD_DIMS.depth)
    this.shadowGeom = new THREE.PlaneGeometry(CARD_DIMS.width * 1.04, CARD_DIMS.depth * 1.04)
    this.particleGeom = new THREE.BoxGeometry(0.11, 0.03, 0.11)

    this.buildLighting()
    this.buildDraftingTable()
    this.blackDeckGroup = this.buildDeckStack("black", -6.55, 1.85)
    this.whiteDeckGroup = this.buildDeckStack("white", 6.55, 1.85)
    this.czarCrown = this.buildCzarCrown()
    this.trophyGroup = new THREE.Group()
    this.opponentHandsGroup = new THREE.Group()
    this.scene.add(this.trophyGroup, this.opponentHandsGroup)

    this.bindEvents()
  }

  private computeFov(width: number, height: number): number {
    const aspect = width / Math.max(1, height)
    // Automatically widen slightly on portrait phones so the mat stays framed!
    return aspect < 0.85 ? 42 : aspect < 1.15 ? 35 : 30
  }

  setTheme(theme: InklineThemePalette): void {
    if (this.theme.id === theme.id) return
    this.theme = theme
    this.textures.setTheme(theme)
    this.scene.background = new THREE.Color(theme.paperBg)
    this.scene.fog = new THREE.Fog(theme.paperBg, 28, 56)

    if (this.boardMesh !== null) {
      const mats = this.boardMesh.material as Array<THREE.MeshBasicMaterial>
      mats[2]!.map?.dispose()
      mats[2]!.map = makeDraftingBoardTexture(theme)
      mats[2]!.needsUpdate = true
      mats[0]!.color.set(theme.paperRecessed)
    }
    if (this.boardShadowMesh !== null) {
      ;(this.boardShadowMesh.material as THREE.MeshBasicMaterial).color.set(theme.paperShadow)
    }

    // Force card faces & backs to repaint in the new Inkline theme
    for (const rig of this.cardRigs.values()) {
      rig.lastFaceKey = ""
      rig.materials[3]!.map = this.textures.getWhiteBack(false)
      rig.materials[3]!.needsUpdate = true
    }
    this.lastSyncedSignature = ""
    if (this.latestView !== null) {
      this.syncView(this.latestView)
    }
  }

  clearHover(): void {
    if (this.hoveredRig !== null) {
      this.hoveredRig = null
      this.callbacks.onHover(null, this.lastPointerX, this.lastPointerY)
    }
  }

  setExternalHighlightSlot(slotIndex: number | null): void {
    this.externalHighlightSlot = slotIndex
  }

  private buildLighting(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.94)
    const dir = new THREE.DirectionalLight(0xfdfef9, 0.22)
    dir.position.set(6, 14, 8)
    this.scene.add(ambient, dir)
  }

  private buildDraftingTable(): void {
    const boardW = 18.4
    const boardD = 13.6
    const boardH = 0.26
    const boardGeo = new THREE.BoxGeometry(boardW, boardH, boardD)
    const topTex = makeDraftingBoardTexture(this.theme)
    const sideMat = new THREE.MeshBasicMaterial({ color: this.theme.paperRecessed })
    const topMat = new THREE.MeshBasicMaterial({ map: topTex })

    const boardMesh = new THREE.Mesh(boardGeo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat])
    boardMesh.position.set(0, -boardH / 2, 0.05)
    boardMesh.add(makeEdgeLines(boardGeo, this.theme.inkPrimary, 0.65))
    this.boardMesh = boardMesh
    this.scene.add(boardMesh)

    const tableShadowGeo = new THREE.PlaneGeometry(boardW + 0.28, boardD + 0.28)
    const tableShadowMat = new THREE.MeshBasicMaterial({ color: this.theme.paperShadow })
    const tableShadow = new THREE.Mesh(tableShadowGeo, tableShadowMat)
    tableShadow.rotation.x = -Math.PI / 2
    tableShadow.position.set(0.18, -boardH - 0.01, 0.28)
    this.boardShadowMesh = tableShadow
    this.scene.add(tableShadow)

    // Inkline drafting pen prop
    const penGroup = new THREE.Group()
    const barrelGeo = new THREE.CylinderGeometry(0.065, 0.065, 2.7, 8)
    const barrel = new THREE.Mesh(barrelGeo, new THREE.MeshBasicMaterial({ color: this.theme.paperCard }))
    barrel.add(makeEdgeLines(barrelGeo, this.theme.inkPrimary))
    barrel.rotation.z = Math.PI / 2
    penGroup.add(barrel)

    const nibGeo = new THREE.ConeGeometry(0.065, 0.34, 8)
    const nib = new THREE.Mesh(nibGeo, new THREE.MeshBasicMaterial({ color: this.theme.inkPrimary }))
    nib.rotation.z = -Math.PI / 2
    nib.position.x = 1.52
    penGroup.add(nib)

    const capGeo = new THREE.CylinderGeometry(0.072, 0.072, 0.3, 8)
    const cap = new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({ color: this.theme.accentBlueWash }))
    cap.add(makeEdgeLines(capGeo, this.theme.accentBlue))
    cap.rotation.z = Math.PI / 2
    cap.position.x = -1.28
    penGroup.add(cap)

    penGroup.position.set(6.75, 0.08, -4.4)
    penGroup.rotation.y = 0.22
    this.scene.add(penGroup)

    // Architectural scale ruler
    const rulerGeo = new THREE.BoxGeometry(3.4, 0.04, 0.38)
    const ruler = new THREE.Mesh(rulerGeo, new THREE.MeshBasicMaterial({ color: this.theme.paperRecessed }))
    ruler.add(makeEdgeLines(rulerGeo, this.theme.inkPrimary, 0.8))
    ruler.position.set(-6.5, 0.02, -4.6)
    ruler.rotation.y = -0.06
    this.scene.add(ruler)
  }

  private buildDeckStack(kind: "black" | "white", x: number, z: number): THREE.Group {
    const group = new THREE.Group()
    group.position.set(x, 0, z)

    const bodyGeo = new THREE.BoxGeometry(CARD_DIMS.width, 0.42, CARD_DIMS.depth)
    const sideColor = kind === "black" ? "#212925" : "#e7ebe2"
    const edgeColor = kind === "black" ? this.theme.blackCardEdge : this.theme.inkPrimary
    const topTex = kind === "black" ? this.textures.getBlackBack() : this.textures.getWhiteBack(true)

    const sideMat = new THREE.MeshBasicMaterial({ color: sideColor })
    const topMat = new THREE.MeshBasicMaterial({ map: topTex })
    const deckMesh = new THREE.Mesh(bodyGeo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat])
    deckMesh.position.y = 0.21
    deckMesh.add(makeEdgeLines(bodyGeo, edgeColor, 0.9))
    deckMesh.name = "deck-body"
    group.add(deckMesh)

    const sh = new THREE.Mesh(
      this.shadowGeom,
      new THREE.MeshBasicMaterial({ color: this.theme.paperShadow, transparent: true, opacity: 0.72 })
    )
    sh.rotation.x = -Math.PI / 2
    sh.position.set(0.08, 0.004, 0.1)
    group.add(sh)

    const outlineGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(CARD_DIMS.width + 0.2, CARD_DIMS.depth + 0.2))
    const slotOutline = new THREE.LineSegments(
      outlineGeo,
      new THREE.LineBasicMaterial({ color: this.theme.borderLine })
    )
    slotOutline.rotation.x = -Math.PI / 2
    slotOutline.position.y = 0.006
    group.add(slotOutline)

    this.scene.add(group)
    return group
  }

  private buildCzarCrown(): THREE.Group {
    const group = new THREE.Group()

    const baseGeo = new THREE.CylinderGeometry(0.42, 0.46, 0.07, 6)
    const base = new THREE.Mesh(baseGeo, new THREE.MeshBasicMaterial({ color: this.theme.accentBlueWash }))
    base.add(makeEdgeLines(baseGeo, this.theme.accentBlue))
    base.position.y = 0.04
    group.add(base)

    const gemGeo = new THREE.OctahedronGeometry(0.24, 0)
    const gem = new THREE.Mesh(gemGeo, new THREE.MeshBasicMaterial({ color: this.theme.paperCard }))
    gem.add(makeEdgeLines(gemGeo, this.theme.accentBlue))
    gem.position.y = 0.42
    gem.name = "czar-gem"
    group.add(gem)

    this.scene.add(group)
    return group
  }

  private ensureCardRig(key: string, kind: "black" | "white", startPos: THREE.Vector3, dealDelay = 0): CardRig {
    const existing = this.cardRigs.get(key)
    if (existing !== undefined) return existing

    const sideColor = kind === "black" ? "#202824" : "#e5e8e0"
    const sideMat = new THREE.MeshBasicMaterial({ color: sideColor })
    const topMat = new THREE.MeshBasicMaterial({
      map: kind === "black" ? this.textures.getBlackBack() : this.textures.getWhiteBack(true)
    })
    const bottomMat = new THREE.MeshBasicMaterial({
      map: kind === "black" ? this.textures.getBlackBack() : this.textures.getWhiteBack(false)
    })
    const materials = [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat]

    const mesh = new THREE.Mesh(this.cardGeom, materials)
    const outlineGeo = new THREE.EdgesGeometry(this.cardGeom, 25)
    const outlineMat = new THREE.LineBasicMaterial({
      color: kind === "black" ? this.theme.blackCardEdge : this.theme.inkPrimary
    })
    const outline = new THREE.LineSegments(outlineGeo, outlineMat)
    mesh.add(outline)

    const group = new THREE.Group()
    group.position.copy(startPos)
    group.add(mesh)
    this.scene.add(group)

    const shadowMat = new THREE.MeshBasicMaterial({
      color: this.theme.paperShadow,
      transparent: true,
      opacity: 0.65
    })
    const shadowMesh = new THREE.Mesh(this.shadowGeom, shadowMat)
    shadowMesh.rotation.x = -Math.PI / 2
    shadowMesh.position.set(startPos.x + 0.06, 0.007, startPos.z + 0.08)
    this.scene.add(shadowMesh)

    const rig: CardRig = {
      group,
      mesh,
      outline,
      outlineMat,
      shadowMesh,
      shadowMat,
      materials,
      targetPos: startPos.clone(),
      targetRot: new THREE.Euler(0, 0, 0),
      targetScale: 1,
      currentScale: 1,
      highlightColor: kind === "black" ? this.theme.blackCardEdge : this.theme.inkPrimary,
      pickTarget: null,
      lastFaceKey: "",
      dealDelay,
      slotIndex: null
    }

    this.cardRigs.set(key, rig)
    this.interactiveMeshes.push(mesh)
    this.meshToRig.set(mesh, rig)
    return rig
  }

  private removeCardRig(key: string): void {
    const rig = this.cardRigs.get(key)
    if (rig === undefined) return
    if (this.hoveredRig === rig) {
      this.hoveredRig = null
      this.callbacks.onHover(null, this.lastPointerX, this.lastPointerY)
    }
    this.scene.remove(rig.group)
    this.scene.remove(rig.shadowMesh)
    this.meshToRig.delete(rig.mesh)
    const idx = this.interactiveMeshes.indexOf(rig.mesh)
    if (idx !== -1) this.interactiveMeshes.splice(idx, 1)
    rig.outline.geometry.dispose()
    rig.outlineMat.dispose()
    rig.shadowMat.dispose()
    for (const mat of rig.materials) mat.dispose()
    this.cardRigs.delete(key)
  }

  spawnInkRipple(x: number, z: number, color: string = this.theme.inkPrimary): void {
    const ringGeo = new THREE.RingGeometry(0.18, 0.24, 28)
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.58,
      side: THREE.DoubleSide
    })
    const mesh = new THREE.Mesh(ringGeo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.015, z)
    this.scene.add(mesh)
    this.ripples.push({ mesh, mat, age: 0, maxAge: 0.72 })
  }

  spawnInkSplatter(x: number, z: number): void {
    const colors = [this.theme.accentGreen, this.theme.accentBlue, this.theme.inkPrimary, this.theme.accentRed]
    for (let i = 0; i < 22; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length]!,
        transparent: true,
        opacity: 0.95
      })
      const mesh = new THREE.Mesh(this.particleGeom, mat)
      mesh.position.set(x, 0.55, z)
      const angle = (i / 22) * Math.PI * 2 + (i % 3) * 0.2
      const speed = 2.0 + (i % 5) * 0.75
      this.scene.add(mesh)
      this.splatters.push({
        mesh,
        mat,
        vel: new THREE.Vector3(Math.cos(angle) * speed, 2.8 + (i % 4) * 0.6, Math.sin(angle) * speed),
        spin: (i % 2 === 0 ? 1 : -1) * (4 + (i % 4)),
        age: 0,
        maxAge: 0.85 + (i % 3) * 0.14
      })
    }
    this.spawnInkRipple(x, z, this.theme.accentGreen)
    this.spawnInkRipple(x, z, this.theme.accentBlue)
  }

  setCameraPreset(preset: CameraPreset): void {
    this.cameraPreset = preset
    this.orbitYaw = 0
    this.orbitPitch = 0
    this.cameraZoom = 1
  }

  adjustZoom(delta: number): void {
    this.cameraZoom = Math.max(0.7, Math.min(1.42, this.cameraZoom + delta))
  }

  getZoomPercent(): number {
    return Math.round((1 / this.cameraZoom) * 100)
  }

  syncView(view: TableView): void {
    const prevPhase = this.latestView?.phase
    const prevRound = this.latestView?.roundNumber
    const prevViewer = this.latestView?.viewerSeat
    this.latestView = view

    // Clear stale hover preview whenever phase, round, or active player changes!
    if (prevPhase !== view.phase || prevRound !== view.roundNumber || prevViewer !== view.viewerSeat) {
      this.clearHover()
      this.externalHighlightSlot = null
    }

    const sig = JSON.stringify({
      theme: this.theme.id,
      phase: view.phase,
      round: view.roundNumber,
      czar: view.czarSeat,
      viewer: view.viewerSeat,
      black: view.activeBlackCard?.id ?? null,
      hand: view.viewerHand.map((c) => `${c.id}:${c.text}`),
      staged: view.viewerStagedIds,
      seal: view.viewerSealArmed,
      subs: view.submissions.map((s) => ({
        slot: s.slotIndex,
        rev: s.revealed,
        win: s.winner,
        sealed: s.sealed,
        owner: s.ownerName,
        ids: s.cards.map((c) => c.id)
      })),
      scores: view.players.map((p) => `${p.seatIndex}:${p.score}:${p.handCardIds.length}:${p.hasSubmitted ? 1 : 0}`)
    })

    if (sig === this.lastSyncedSignature) return
    this.lastSyncedSignature = sig

    const activeKeys = new Set<string>()
    this.winnerFocusPos = null

    // 1. Scale physical decks
    const blackBody = this.blackDeckGroup.getObjectByName("deck-body")
    if (blackBody !== undefined) {
      const h = Math.max(0.18, Math.min(1.2, view.blackDeckRemaining / 200))
      blackBody.scale.y = h
      blackBody.position.y = 0.21 * h
    }
    const whiteBody = this.whiteDeckGroup.getObjectByName("deck-body")
    if (whiteBody !== undefined) {
      const h = Math.max(0.18, Math.min(1.2, view.whiteDeckRemaining / 560))
      whiteBody.scale.y = h
      whiteBody.position.y = 0.21 * h
    }

    // 2. Card Czar crown token
    const czarAnchor = getSeatAnchor(view.czarSeat, view.viewerSeat, view.players.length)
    if (view.czarSeat === view.viewerSeat) {
      this.czarTargetPos.set(-5.6, 0.02, 3.65)
    } else {
      this.czarTargetPos.set(czarAnchor.x * 0.74, 0.02, czarAnchor.z * 0.74)
    }

    // 3. Active Black Prompt Card on left side of the mat
    if (view.activeBlackCard !== null) {
      const key = `black:${view.roundNumber}:${view.activeBlackCard.id}`
      activeKeys.add(key)
      const isNew = !this.cardRigs.has(key)
      const rig = this.ensureCardRig(key, "black", new THREE.Vector3(-6.55, 0.55, 1.85), 0)
      const faceKey = `b:${this.theme.id}:${view.activeBlackCard.id}`
      if (rig.lastFaceKey !== faceKey) {
        rig.materials[2]!.map = this.textures.getBlackFront(view.activeBlackCard)
        rig.materials[2]!.needsUpdate = true
        rig.lastFaceKey = faceKey
      }

      if (view.phase === "RoundResult" && view.winnerSeat !== null && view.winnerSeat >= 0) {
        // Animate the won Black Card lifting & angling slightly toward the winner's trophy stack!
        const winAnchor = getSeatAnchor(view.winnerSeat, view.viewerSeat, view.players.length)
        rig.targetPos.set(
          THREE.MathUtils.lerp(-4.05, winAnchor.trophyX, 0.3),
          0.42,
          THREE.MathUtils.lerp(-0.55, winAnchor.trophyZ, 0.3)
        )
        rig.targetRot.set(0.08, 0.05, 0)
        rig.targetScale = 1.03
        rig.highlightColor = this.theme.accentGreen
      } else {
        rig.targetPos.set(-4.05, 0.16, -0.55)
        rig.targetRot.set(view.phase === "Judging" ? 0.04 : 0.12, 0.04, 0)
        rig.targetScale = 1.04
        rig.highlightColor = this.theme.blackCardEdge
      }
      rig.slotIndex = null
      rig.pickTarget = { kind: "black", card: view.activeBlackCard }
      if (isNew) this.spawnInkRipple(-4.05, -0.55, this.theme.inkPrimary)
    }

    // 4. Submissions on the central judging mat (ZERO Pick-2 overlap, up to 7 submissions in 1 or 2 crisp rows!)
    const subs = view.submissions
    const subCount = subs.length
    const isPick2 = (view.activeBlackCard?.pick ?? 1) === 2
    const maxPerRow = isPick2 ? 3 : 4

    for (let i = 0; i < subCount; i++) {
      const sub = subs[i]!
      const displayIdx = sub.slotIndex >= 0 ? sub.slotIndex : i
      const row = Math.floor(displayIdx / maxPerRow)
      const col = displayIdx % maxPerRow
      const rowCount = Math.ceil(subCount / maxPerRow)
      const colsInThisRow = row === rowCount - 1 ? subCount - row * maxPerRow : maxPerRow

      const slotWidth = isPick2 ? 3.55 : 2.02
      const baseX = 1.35 + (col - (colsInThisRow - 1) / 2) * slotWidth
      const baseZ = rowCount === 1 ? -0.55 : -1.85 + row * 2.55

      for (let cIdx = 0; cIdx < sub.cards.length; cIdx++) {
        const card = sub.cards[cIdx]!
        const key = `sub:${view.roundNumber}:${sub.ownerSeat}:${card.id}`
        activeKeys.add(key)
        const isNew = !this.cardRigs.has(key)
        const origin =
          sub.ownerSeat === -1
            ? { x: 6.55, z: 1.85 }
            : getSeatAnchor(sub.ownerSeat, view.viewerSeat, view.players.length)
        const rig = this.ensureCardRig(key, "white", new THREE.Vector3(origin.x, 0.35, origin.z), 0)

        const badge = sub.cards.length > 1 ? cIdx + 1 : null
        const showAuthor = view.phase === "RoundResult" || view.phase === "MatchOver"
        const isWinner = sub.winner
        const faceKey = `w:${this.theme.id}:${card.id}:${card.text}:${badge ?? 0}:${isWinner ? 1 : 0}:${view.isComboWin ? 1 : 0}:${sub.sealed ? 1 : 0}:${showAuthor ? sub.ownerName : ""}`
        if (rig.lastFaceKey !== faceKey) {
          rig.materials[2]!.map = this.textures.getWhiteFront(card, {
            orderBadge: badge,
            approved: isWinner,
            comboStamp: isWinner && view.isComboWin,
            sealedStamp: sub.sealed,
            authorLabel: showAuthor ? sub.ownerName : null
          })
          rig.materials[2]!.needsUpdate = true
          rig.lastFaceKey = faceKey
        }

        // Side-by-side non-overlapping Pick-2 layout!
        const offsetX = sub.cards.length > 1 ? (cIdx - 0.5) * 1.66 : 0
        const offsetZ = 0
        const isShruggingLoser = view.phase === "RoundResult" && !sub.winner
        const liftY = isWinner ? 0.58 : isShruggingLoser ? 0.04 : sub.revealed ? 0.14 : 0.08

        rig.targetPos.set(baseX + offsetX, liftY, baseZ + offsetZ)
        const flipZ = sub.revealed ? 0 : Math.PI
        // Flat, crisp orientation during Judging so text is NEVER cut off or tilted!
        const tiltX = sub.revealed ? (isWinner ? 0.08 : 0.04) : 0
        const yawAngle = isShruggingLoser ? (displayIdx % 2 === 0 ? -0.1 : 0.1) : 0
        rig.targetRot.set(tiltX, yawAngle, flipZ)
        rig.targetScale = isWinner ? 1.09 : isShruggingLoser ? 0.91 : 0.98
        rig.highlightColor = isWinner
          ? this.theme.accentGreen
          : sub.sealed
            ? this.theme.accentBlue
            : sub.revealed && view.canViewerPickWinner
              ? this.theme.accentBlue
              : this.theme.inkPrimary

        rig.slotIndex = sub.slotIndex >= 0 ? sub.slotIndex : i
        rig.pickTarget = {
          kind: "submission",
          slotIndex: rig.slotIndex,
          revealed: sub.revealed,
          ownerName: sub.ownerName,
          winner: sub.winner,
          cards: sub.cards
        }

        if (isWinner && view.phase === "RoundResult") {
          this.winnerFocusPos = new THREE.Vector3(baseX, 0.4, baseZ)
          const celebKey = `${view.roundNumber}:${sub.ownerSeat}`
          if (this.lastWinnerCelebrationKey !== celebKey) {
            this.lastWinnerCelebrationKey = celebKey
            this.spawnInkSplatter(baseX, baseZ)
          }
        }
        if (isNew) this.spawnInkRipple(baseX, baseZ, this.theme.borderLine)
      }
    }

    // 5. Viewer's Interactive 3D Hand (tighter fan so cards 1 & 7 never clip and stay well above toolbar!)
    const hideHandDuringJudging =
      view.phase === "Judging" || view.phase === "RoundResult" || view.phase === "MatchOver"
    const hand = view.viewerHand
    const handCount = hand.length
    for (let i = 0; i < handCount; i++) {
      const card = hand[i]!
      const key = `hand:${view.viewerSeat}:${card.id}`
      activeKeys.add(key)

      const isNew = !this.cardRigs.has(key)
      // Staggered lively deal animation on initial deal!
      const dealDelay = isNew ? i * 0.055 : 0
      const rig = this.ensureCardRig(key, "white", new THREE.Vector3(6.55, 0.55, 1.85), dealDelay)
      const stagedIdx = view.viewerStagedIds.indexOf(card.id)
      const isStaged = stagedIdx !== -1
      const orderBadge = isStaged && (view.activeBlackCard?.pick ?? 1) > 1 ? stagedIdx + 1 : null

      const faceKey = `w:${this.theme.id}:${card.id}:${card.text}:${orderBadge ?? 0}:${isStaged && view.viewerSealArmed ? "s" : ""}`
      if (rig.lastFaceKey !== faceKey) {
        rig.materials[2]!.map = this.textures.getWhiteFront(card, {
          orderBadge,
          sealedStamp: isStaged && view.viewerSealArmed
        })
        rig.materials[2]!.needsUpdate = true
        rig.lastFaceKey = faceKey
      }

      const norm = handCount <= 1 ? 0 : (i / (handCount - 1)) * 2 - 1
      const fanX = norm * Math.min(4.45, Math.max(0, handCount - 1) * 0.72)
      const fanZ = (hideHandDuringJudging ? 4.85 : 3.65) + norm * norm * 0.42 - (isStaged ? 0.65 : 0)
      const fanY = (hideHandDuringJudging ? 0.06 : 0.34) + i * 0.015 + (isStaged ? 0.42 : 0)
      const fanYaw = -norm * 0.14
      const tiltX = hideHandDuringJudging ? 0.1 : 0.34

      rig.targetPos.set(fanX, fanY, fanZ)
      rig.targetRot.set(tiltX, fanYaw, 0)
      rig.targetScale = isStaged ? 1.07 : hideHandDuringJudging ? 0.84 : 0.98
      rig.highlightColor = isStaged ? this.theme.accentBlue : this.theme.inkPrimary
      rig.slotIndex = null
      rig.pickTarget = { kind: "hand", cardId: card.id, card }
    }

    // Despawn obsolete card rigs cleanly
    for (const key of Array.from(this.cardRigs.keys())) {
      if (!activeKeys.has(key)) {
        this.removeCardRig(key)
      }
    }

    // Refresh live hover preview if the hovered card changed state (e.g. flipped from face-down to revealed!)
    if (this.hoveredRig !== null) {
      this.callbacks.onHover(this.hoveredRig.pickTarget, this.lastPointerX, this.lastPointerY)
    }

    this.rebuildTableProps(view)
  }

  private rebuildTableProps(view: TableView): void {
    while (this.trophyGroup.children.length > 0) {
      this.trophyGroup.remove(this.trophyGroup.children[0]!)
    }
    while (this.opponentHandsGroup.children.length > 0) {
      this.opponentHandsGroup.remove(this.opponentHandsGroup.children[0]!)
    }

    const whiteBackMat = new THREE.MeshBasicMaterial({ map: this.textures.getWhiteBack(true) })
    const whiteSideMat = new THREE.MeshBasicMaterial({ color: this.theme.paperRecessed })
    const blackBackMat = new THREE.MeshBasicMaterial({ map: this.textures.getBlackBack() })
    const blackSideMat = new THREE.MeshBasicMaterial({ color: "#202824" })
    const miniCardGeo = new THREE.BoxGeometry(CARD_DIMS.width * 0.56, CARD_DIMS.thickness * 0.85, CARD_DIMS.depth * 0.56)

    for (const player of view.players) {
      const anchor = getSeatAnchor(player.seatIndex, view.viewerSeat, view.players.length)

      if (player.seatIndex !== view.viewerSeat) {
        const count = Math.min(7, player.handCardIds.length)
        const seatGroup = new THREE.Group()
        seatGroup.position.set(anchor.x, 0.04, anchor.z)
        seatGroup.rotation.y = anchor.yaw

        for (let i = 0; i < count; i++) {
          const norm = count <= 1 ? 0 : (i / (count - 1)) * 2 - 1
          const cardMesh = new THREE.Mesh(miniCardGeo, [
            whiteSideMat,
            whiteSideMat,
            whiteBackMat,
            whiteSideMat,
            whiteSideMat,
            whiteSideMat
          ])
          cardMesh.add(makeEdgeLines(miniCardGeo, this.theme.inkPrimary, 0.8))
          cardMesh.position.set(norm * 1.15, i * 0.012, norm * norm * 0.14)
          cardMesh.rotation.y = -norm * 0.14
          seatGroup.add(cardMesh)
        }
        this.opponentHandsGroup.add(seatGroup)
      }

      if (player.score > 0) {
        const stackGroup = new THREE.Group()
        stackGroup.position.set(anchor.trophyX, 0.02, anchor.trophyZ)

        for (let s = 0; s < player.score; s++) {
          const trophy = new THREE.Mesh(miniCardGeo, [
            blackSideMat,
            blackSideMat,
            blackBackMat,
            blackSideMat,
            blackSideMat,
            blackSideMat
          ])
          trophy.add(makeEdgeLines(miniCardGeo, this.theme.blackCardEdge, 0.9))
          trophy.position.set((s % 2 === 0 ? -1 : 1) * 0.025, s * 0.052 + 0.025, 0)
          trophy.rotation.y = s * 0.18 - 0.1
          stackGroup.add(trophy)
        }
        this.trophyGroup.add(stackGroup)
      }
    }
  }

  renderFrame(dtSeconds: number): void {
    const dt = Math.min(0.05, Math.max(0.001, dtSeconds))
    this.elapsedSeconds += dt
    const smooth = 1 - Math.exp(-11.0 * dt)

    // Smooth camera interpolation with winner push-in celebration!
    const preset = CAMERA_PRESETS[this.cameraPreset]
    const baseVec = new THREE.Vector3(preset.pos[0], preset.pos[1], preset.pos[2])
    const lookVec = new THREE.Vector3(preset.look[0], preset.look[1], preset.look[2])

    if (this.winnerFocusPos !== null && this.cameraPreset === "judge") {
      lookVec.lerp(this.winnerFocusPos, 0.35)
      baseVec.lerp(new THREE.Vector3(this.winnerFocusPos.x, 10.6, this.winnerFocusPos.z + 4.2), 0.28)
    }

    const offset = baseVec.clone().sub(lookVec).multiplyScalar(this.cameraZoom)
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitYaw)
    offset.y = Math.max(4.4, offset.y + this.orbitPitch * 3.5)

    const desiredPos = lookVec.clone().add(offset)
    this.currentCamPos.lerp(desiredPos, 1 - Math.exp(-7.5 * dt))
    this.currentCamLook.lerp(lookVec, 1 - Math.exp(-7.5 * dt))
    this.camera.position.copy(this.currentCamPos)
    this.camera.lookAt(this.currentCamLook)

    // Animate Czar crown token
    this.czarCrown.position.lerp(this.czarTargetPos, smooth)
    const gem = this.czarCrown.getObjectByName("czar-gem")
    if (gem !== undefined) {
      gem.rotation.y = this.elapsedSeconds * 1.15
      gem.position.y = 0.42 + Math.sin(this.elapsedSeconds * 2.4) * 0.05
    }

    // Animate cards
    for (const rig of this.cardRigs.values()) {
      if (rig.dealDelay > 0) {
        rig.dealDelay = Math.max(0, rig.dealDelay - dt)
        continue
      }

      const isExternalSlotHighlighted =
        this.externalHighlightSlot !== null && rig.slotIndex === this.externalHighlightSlot
      const isHovered = rig === this.hoveredRig || isExternalSlotHighlighted
      const hoverLift = isHovered ? (rig.pickTarget?.kind === "hand" ? 0.44 : 0.3) : 0
      const hoverZShift = isHovered && rig.pickTarget?.kind === "hand" ? -0.34 : 0
      const desiredScale = rig.targetScale * (isHovered ? 1.07 : 1.0)

      rig.group.position.x = THREE.MathUtils.lerp(rig.group.position.x, rig.targetPos.x, smooth)
      rig.group.position.y = THREE.MathUtils.lerp(rig.group.position.y, rig.targetPos.y + hoverLift, smooth)
      rig.group.position.z = THREE.MathUtils.lerp(rig.group.position.z, rig.targetPos.z + hoverZShift, smooth)

      const targetRotX = isHovered && rig.pickTarget?.kind === "hand" ? 0.56 : rig.targetRot.x
      rig.group.rotation.x = THREE.MathUtils.lerp(rig.group.rotation.x, targetRotX, smooth)
      rig.group.rotation.y = THREE.MathUtils.lerp(rig.group.rotation.y, rig.targetRot.y, smooth)
      rig.group.rotation.z = THREE.MathUtils.lerp(rig.group.rotation.z, rig.targetRot.z, smooth)

      rig.currentScale = THREE.MathUtils.lerp(rig.currentScale, desiredScale, smooth)
      rig.group.scale.setScalar(rig.currentScale)

      const outlineHex = isHovered ? this.theme.accentBlue : rig.highlightColor
      rig.outlineMat.color.set(outlineHex)

      const lift = Math.max(0, rig.group.position.y)
      rig.shadowMesh.position.set(
        rig.group.position.x + 0.06 + lift * 0.14,
        0.008,
        rig.group.position.z + 0.08 + lift * 0.16
      )
      rig.shadowMesh.rotation.z = -rig.group.rotation.y
      rig.shadowMesh.scale.setScalar(rig.currentScale * (1 + lift * 0.03))
      rig.shadowMat.opacity = Math.max(0.16, 0.62 - lift * 0.28)
    }

    // Ink ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]!
      r.age += dt
      const t = r.age / r.maxAge
      if (t >= 1) {
        this.scene.remove(r.mesh)
        r.mesh.geometry.dispose()
        r.mat.dispose()
        this.ripples.splice(i, 1)
      } else {
        r.mesh.scale.setScalar(1 + t * 5.6)
        r.mat.opacity = (1 - t) * 0.45
      }
    }

    // Winner ink-splatter confetti particles
    for (let i = this.splatters.length - 1; i >= 0; i--) {
      const p = this.splatters[i]!
      p.age += dt
      const t = p.age / p.maxAge
      if (t >= 1) {
        this.scene.remove(p.mesh)
        p.mat.dispose()
        this.splatters.splice(i, 1)
      } else {
        p.vel.y -= 9.5 * dt
        p.mesh.position.addScaledVector(p.vel, dt)
        if (p.mesh.position.y < 0.03) {
          p.mesh.position.y = 0.03
          p.vel.y = 0
          p.vel.multiplyScalar(0.84)
        }
        p.mesh.rotation.y += p.spin * dt
        p.mat.opacity = Math.max(0, 1 - t * t)
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  private performRaycast(): CardRig | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    const hits = this.raycaster.intersectObjects(this.interactiveMeshes, false)
    if (hits.length === 0) return null
    const mesh = hits[0]!.object as THREE.Mesh
    return this.meshToRig.get(mesh) ?? null
  }

  private updatePointerCoords(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.lastPointerX = clientX
    this.lastPointerY = clientY
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    this.updatePointerCoords(event.clientX, event.clientY)

    if (this.isDraggingOrbit) {
      const dx = event.clientX - this.dragStartX
      const dy = event.clientY - this.dragStartY
      if (Math.hypot(dx, dy) > 5) this.dragMoved = true
      this.orbitYaw = Math.max(-0.55, Math.min(0.55, this.dragBaseYaw - dx * 0.0032))
      this.orbitPitch = Math.max(-0.45, Math.min(0.55, this.dragBasePitch + dy * 0.0028))
      this.renderer.domElement.style.cursor = "grabbing"
      return
    }

    const hit = this.performRaycast()
    this.hoveredRig = hit
    this.renderer.domElement.style.cursor = hit !== null ? "pointer" : "grab"
    this.callbacks.onHover(hit?.pickTarget ?? null, this.lastPointerX, this.lastPointerY)
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return
    this.updatePointerCoords(event.clientX, event.clientY)
    const hit = this.performRaycast()

    if (hit === null || event.button === 2) {
      this.isDraggingOrbit = true
      this.dragMoved = false
      this.dragStartX = event.clientX
      this.dragStartY = event.clientY
      this.dragBaseYaw = this.orbitYaw
      this.dragBasePitch = this.orbitPitch
      this.renderer.domElement.setPointerCapture(event.pointerId)
    }
  }

  private readonly onPointerUp = (event: PointerEvent) => {
    if (this.isDraggingOrbit) {
      this.isDraggingOrbit = false
      if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
        this.renderer.domElement.releasePointerCapture(event.pointerId)
      }
      this.renderer.domElement.style.cursor = "grab"
      if (this.dragMoved) return
    }

    if (event.button !== 0) return
    this.updatePointerCoords(event.clientX, event.clientY)
    const hit = this.performRaycast()
    if (hit === null || hit.pickTarget === null) return

    const now = performance.now()
    const isDouble = hit === this.lastClickRig && now - this.lastClickAt < 340
    this.lastClickRig = hit
    this.lastClickAt = now

    this.spawnInkRipple(hit.group.position.x, hit.group.position.z, this.theme.accentBlue)

    if (isDouble) {
      this.callbacks.onDoubleClick(hit.pickTarget)
    } else {
      this.callbacks.onClick(hit.pickTarget)
    }
  }

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? 0.08 : -0.08
    this.adjustZoom(delta)
  }

  private readonly onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
  }

  private readonly onResize = () => {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.camera.fov = this.computeFov(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private bindEvents(): void {
    const dom = this.renderer.domElement
    dom.addEventListener("pointermove", this.onPointerMove)
    dom.addEventListener("pointerdown", this.onPointerDown)
    dom.addEventListener("pointerup", this.onPointerUp)
    dom.addEventListener("wheel", this.onWheel, { passive: false })
    dom.addEventListener("contextmenu", this.onContextMenu)
    window.addEventListener("resize", this.onResize)
  }

  dispose(): void {
    const dom = this.renderer.domElement
    dom.removeEventListener("pointermove", this.onPointerMove)
    dom.removeEventListener("pointerdown", this.onPointerDown)
    dom.removeEventListener("pointerup", this.onPointerUp)
    dom.removeEventListener("wheel", this.onWheel)
    dom.removeEventListener("contextmenu", this.onContextMenu)
    window.removeEventListener("resize", this.onResize)
    for (const key of Array.from(this.cardRigs.keys())) {
      this.removeCardRig(key)
    }
    this.cardGeom.dispose()
    this.shadowGeom.dispose()
    this.particleGeom.dispose()
    this.textures.dispose()
    this.renderer.dispose()
    dom.remove()
  }
}
