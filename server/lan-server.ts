import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { WebSocketServer, type WebSocket } from "ws"
import {
  Intent,
  makeSimulation,
  projectTableViewForSeat,
  setupSchedule,
  TableViewInspector,
  updateSchedule,
  type CahRuntime,
  type PlayerIntent
} from "../src/sim/index.ts"

const PORT = Number(process.env.PORT ?? 4179)
const DIST_DIR = path.resolve(process.cwd(), "dist")

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".ico": "image/x-icon"
}

function getLanUrls(port: number): Array<string> {
  const nets = os.networkInterfaces()
  const urls: Array<string> = []
  for (const list of Object.values(nets)) {
    if (list === undefined) continue
    for (const info of list) {
      if (info.family === "IPv4" && !info.internal) {
        urls.push(`http://${info.address}:${port}`)
      }
    }
  }
  return urls.length > 0 ? urls : [`http://localhost:${port}`]
}

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let out = ""
  for (let i = 0; i < 4; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]!
  }
  return out
}

interface RoomMember {
  readonly ws: WebSocket
  readonly name: string
  readonly seat: number
}

interface LanRoom {
  readonly code: string
  readonly maxPlayers: number
  readonly targetPoints: number
  readonly fillBots: boolean
  readonly members: Array<RoomMember>
  hostWs: WebSocket
  runtime: CahRuntime | null
  started: boolean
  lastBroadcastHash: string
}

const rooms = new Map<string, LanRoom>()
const socketToRoom = new Map<WebSocket, LanRoom>()
const lanUrls = getLanUrls(PORT)

function broadcastRoomState(room: LanRoom, message: string): void {
  const summary = room.members.map((m) => ({ name: m.name, seat: m.seat }))
  for (const m of room.members) {
    if (m.ws.readyState === 1) {
      m.ws.send(
        JSON.stringify({
          type: "room-update",
          roomCode: room.code,
          isHost: m.ws === room.hostWs,
          seatIndex: m.seat,
          members: summary,
          lanUrls,
          started: room.started,
          message
        })
      )
    }
  }
}

function broadcastViews(room: LanRoom, force = false): void {
  if (room.runtime === null) return
  const baseView = room.runtime.inspect(TableViewInspector)
  const hash = JSON.stringify({
    phase: baseView.phase,
    round: baseView.roundNumber,
    czar: baseView.czarSeat,
    timer: baseView.timerRemainingSeconds,
    cues: baseView.cues.length,
    subs: baseView.submissions.map((s) => `${s.slotIndex}:${s.revealed}:${s.winner}`),
    players: baseView.players.map((p) => `${p.score}:${p.hasSubmitted}:${p.stagedCardIds.join(",")}:${p.sealArmed}:${p.handCardIds.length}`)
  })
  if (!force && hash === room.lastBroadcastHash) return
  room.lastBroadcastHash = hash

  for (const member of room.members) {
    if (member.ws.readyState === 1) {
      const personalView = projectTableViewForSeat(baseView, member.seat, true)
      member.ws.send(JSON.stringify({ type: "view", view: personalView }))
    }
  }
}

// Authoritative HTTP server serving the built dist/ app for phones & laptops on LAN
const server = http.createServer((req, res) => {
  const urlPath = (req.url ?? "/").split("?")[0] ?? "/"
  const cleanRel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "")
  const safePath = path.resolve(DIST_DIR, cleanRel)

  if (!safePath.startsWith(DIST_DIR)) {
    res.writeHead(403)
    res.end("Forbidden")
    return
  }

  fs.readFile(safePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("Not found. Run `npm run build` first so dist/ is populated.")
      return
    }
    const ext = path.extname(safePath)
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" })
    res.end(data)
  })
})

const wss = new WebSocketServer({ server, path: "/ws" })

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>

      if (msg.type === "host") {
        const nickname = String(msg.nickname ?? "Host").trim().slice(0, 16) || "Host"
        const maxPlayers = Math.max(3, Math.min(8, Number(msg.maxPlayers ?? 6)))
        const targetPoints = Math.max(2, Math.min(10, Number(msg.targetPoints ?? 5)))
        const fillBots = Boolean(msg.fillBots ?? true)

        let code = generateRoomCode()
        while (rooms.has(code)) code = generateRoomCode()

        const room: LanRoom = {
          code,
          maxPlayers,
          targetPoints,
          fillBots,
          members: [{ ws, name: nickname, seat: 0 }],
          hostWs: ws,
          runtime: null,
          started: false,
          lastBroadcastHash: ""
        }
        rooms.set(code, room)
        socketToRoom.set(ws, room)
        broadcastRoomState(room, `Room ${code} open (${room.members.length}/${maxPlayers}). Share code with friends on Wi-Fi!`)
        return
      }

      if (msg.type === "join") {
        const code = String(msg.roomCode ?? "").trim().toUpperCase()
        const nickname = String(msg.nickname ?? "Player").trim().slice(0, 16) || "Player"
        const room = rooms.get(code)
        if (room === undefined) {
          ws.send(JSON.stringify({ type: "error", message: `Room "${code}" not found.` }))
          return
        }
        if (room.started) {
          ws.send(JSON.stringify({ type: "error", message: `Room "${code}" already started.` }))
          return
        }
        if (room.members.length >= room.maxPlayers) {
          ws.send(JSON.stringify({ type: "error", message: `Room "${code}" is full (${room.maxPlayers}/${room.maxPlayers}).` }))
          return
        }

        const seat = room.members.length
        room.members.push({ ws, name: nickname, seat })
        socketToRoom.set(ws, room)
        broadcastRoomState(room, `${nickname} joined seat #${seat + 1}!`)
        return
      }

      if (msg.type === "start") {
        const room = socketToRoom.get(ws)
        if (room === undefined || room.hostWs !== ws) return

        const botNames = ["Archivist", "Draftsman", "Curator", "Auditor", "Surveyor", "Cartographer", "Calligrapher"]
        const totalSeats = room.fillBots
          ? Math.max(3, Math.min(8, Math.max(room.members.length, 4)))
          : Math.max(3, room.members.length)
        const names: Array<string> = []
        for (let i = 0; i < totalSeats; i++) {
          const human = room.members[i]
          if (human !== undefined) {
            names.push(human.name)
          } else {
            names.push(`[BOT] ${botNames[(i - room.members.length) % botNames.length]!}`)
          }
        }

        const runtime = makeSimulation({
          seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
          playerCount: totalSeats,
          targetPoints: room.targetPoints,
          mode: "lan",
          playerNames: names,
          twistsEnabled: true
        })
        const setupRes = runtime.tick(setupSchedule)
        if (!setupRes.ok) {
          ws.send(JSON.stringify({ type: "error", message: "Failed to deal LAN match." }))
          return
        }

        room.runtime = runtime
        room.started = true
        broadcastRoomState(room, "Match started! Good luck.")
        broadcastViews(room, true)
        return
      }

      if (msg.type === "intent") {
        const room = socketToRoom.get(ws)
        if (room === undefined || room.runtime === null) return
        const member = room.members.find((m) => m.ws === ws)
        if (member === undefined) return
        const rawIntent = msg.intent as PlayerIntent
        if (rawIntent._tag === "NewMatch") return

        // Enforce seat ownership so players can only act for their own seat!
        const safeIntent: PlayerIntent =
          "seat" in rawIntent
            ? ({ ...rawIntent, seat: member.seat } as PlayerIntent)
            : rawIntent
        room.runtime.send(Intent, safeIntent)
      }
    } catch {
      // Ignore malformed client message
    }
  })

  ws.on("close", () => {
    const room = socketToRoom.get(ws)
    if (room === undefined) return
    socketToRoom.delete(ws)
    const idx = room.members.findIndex((m) => m.ws === ws)
    if (idx !== -1) {
      const left = room.members.splice(idx, 1)[0]!
      if (room.members.length === 0) {
        rooms.delete(room.code)
      } else {
        if (room.hostWs === ws) {
          room.hostWs = room.members[0]!.ws
        }
        broadcastRoomState(room, `${left.name} left the room.`)
      }
    }
  })
})

// Authoritative 60 Hz fixed-step loop ticking every active LAN room's Ritmo simulation!
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.runtime === null) continue
    const ticked = room.runtime.tick(updateSchedule)
    if (!ticked.ok) {
      console.error(`Room ${room.code} tick failed:`, ticked.error)
      continue
    }
    broadcastViews(room)
  }
}, Math.round(1000 / 60))

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n  Inkline Against Humanity — LAN Party Server")
  console.log("  ───────────────────────────────────────────")
  for (const u of lanUrls) {
    console.log(`  Open on any PC / phone on your Wi-Fi: ${u}`)
  }
  console.log("  Press Ctrl+C to stop.\n")
})
