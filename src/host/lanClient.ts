import type { TableView } from "../sim/inspectors.ts"
import type { PlayerIntent } from "../sim/schema.ts"
import type { LanRoomUiState } from "./hud.ts"

export interface LanClientCallbacks {
  readonly onRoomState: (state: LanRoomUiState) => void
  readonly onTableView: (view: TableView) => void
}

type ServerPacket =
  | {
      readonly type: "room-update"
      readonly roomCode: string
      readonly isHost: boolean
      readonly seatIndex: number
      readonly members: ReadonlyArray<{ readonly name: string; readonly seat: number }>
      readonly lanUrls: ReadonlyArray<string>
      readonly started: boolean
      readonly message: string
    }
  | { readonly type: "view"; readonly view: TableView }
  | { readonly type: "error"; readonly message: string }

export class LanClient {
  private readonly callbacks: LanClientCallbacks
  private ws: WebSocket | null = null
  private activeMatch = false
  private state: LanRoomUiState = {
    connected: false,
    roomCode: null,
    isHost: false,
    seatIndex: null,
    members: [],
    statusMessage: "",
    lanUrls: []
  }

  constructor(callbacks: LanClientCallbacks) {
    this.callbacks = callbacks
  }

  getState(): LanRoomUiState {
    return this.state
  }

  isInActiveMatch(): boolean {
    return this.activeMatch && this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  private setState(partial: Partial<LanRoomUiState>): void {
    this.state = { ...this.state, ...partial }
    this.callbacks.onRoomState(this.state)
  }

  private connectAndSend(payload: Record<string, unknown>): void {
    this.disconnect(false)
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
    const url = `${proto}//${window.location.host}/ws`

    try {
      const ws = new WebSocket(url)
      this.ws = ws
      this.setState({ statusMessage: "Connecting to local LAN server…" })

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify(payload))
      })

      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as ServerPacket
          if (msg.type === "room-update") {
            this.activeMatch = msg.started
            this.setState({
              connected: true,
              roomCode: msg.roomCode,
              isHost: msg.isHost,
              seatIndex: msg.seatIndex,
              members: msg.members,
              lanUrls: msg.lanUrls,
              statusMessage: msg.message
            })
          } else if (msg.type === "view") {
            this.activeMatch = true
            this.callbacks.onTableView(msg.view)
          } else if (msg.type === "error") {
            this.setState({ statusMessage: msg.message })
          }
        } catch {
          // Ignore malformed packet
        }
      })

      ws.addEventListener("error", () => {
        this.activeMatch = false
        this.setState({
          connected: false,
          roomCode: null,
          statusMessage: "No LAN server found on this host. Start `npm run lan` on a PC on your Wi-Fi to host LAN rooms!"
        })
      })

      ws.addEventListener("close", () => {
        if (this.ws === ws) {
          this.ws = null
          this.activeMatch = false
          this.setState({
            connected: false,
            roomCode: null,
            seatIndex: null,
            members: []
          })
        }
      })
    } catch {
      this.setState({
        connected: false,
        statusMessage: "WebSocket unavailable in this browser."
      })
    }
  }

  hostRoom(nickname: string, maxPlayers: number, targetPoints: number, fillBots: boolean): void {
    this.connectAndSend({
      type: "host",
      nickname,
      maxPlayers,
      targetPoints,
      fillBots
    })
  }

  joinRoom(roomCode: string, nickname: string): void {
    this.connectAndSend({
      type: "join",
      roomCode: roomCode.trim().toUpperCase(),
      nickname
    })
  }

  startMatch(): void {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "start" }))
    }
  }

  sendIntent(intent: PlayerIntent): void {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "intent", intent }))
    }
  }

  disconnect(notify = true): void {
    this.activeMatch = false
    if (this.ws !== null) {
      const old = this.ws
      this.ws = null
      old.close()
    }
    if (notify) {
      this.setState({
        connected: false,
        roomCode: null,
        isHost: false,
        seatIndex: null,
        members: [],
        statusMessage: ""
      })
    }
  }
}
