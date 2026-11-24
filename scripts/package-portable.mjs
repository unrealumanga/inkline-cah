import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

const ROOT = process.cwd()
const RELEASE_DIR = path.join(ROOT, "release")
const PORTABLE_DIR = path.join(RELEASE_DIR, "inkline-cah-portable")

console.log("1/4 Building client bundle (dist/)...")
execSync("npm run build", { stdio: "inherit" })

console.log("2/4 Bundling standalone LAN server...")
// Bundle server/lan-server.ts cleanly using rolldown (bundled with Vite 8) or Vite SSR build
fs.rmSync(PORTABLE_DIR, { recursive: true, force: true })
fs.mkdirSync(PORTABLE_DIR, { recursive: true })
fs.cpSync(path.join(ROOT, "dist"), path.join(PORTABLE_DIR, "dist"), { recursive: true })
fs.cpSync(path.join(ROOT, "server"), path.join(PORTABLE_DIR, "server"), { recursive: true })
fs.cpSync(path.join(ROOT, "src", "sim"), path.join(PORTABLE_DIR, "src", "sim"), { recursive: true })

// Minimal portable package.json with only the 2 runtime packages needed to run the LAN server
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
const portablePkg = {
  name: "inkline-cah-portable",
  version: rootPkg.version,
  private: true,
  type: "module",
  scripts: {
    start: "node server/lan-server.ts"
  },
  dependencies: {
    "@typeonce/ritmo": rootPkg.dependencies["@typeonce/ritmo"],
    ws: rootPkg.dependencies.ws
  }
}
fs.writeFileSync(path.join(PORTABLE_DIR, "package.json"), JSON.stringify(portablePkg, null, 2) + "\n")

// Copy minimal runtime node_modules (@typeonce/ritmo + ws) so target PC needs ZERO npm install!
console.log("3/4 Copying minimal runtime dependencies (@typeonce/ritmo + ws)...")
const nmTarget = path.join(PORTABLE_DIR, "node_modules")
fs.mkdirSync(path.join(nmTarget, "@typeonce"), { recursive: true })
fs.cpSync(path.join(ROOT, "node_modules", "@typeonce", "ritmo"), path.join(nmTarget, "@typeonce", "ritmo"), { recursive: true })
fs.cpSync(path.join(ROOT, "node_modules", "ws"), path.join(nmTarget, "ws"), { recursive: true })

// Double-click launchers for Windows & macOS/Linux
fs.writeFileSync(
  path.join(PORTABLE_DIR, "start-lan.bat"),
  `@echo off\r\ntitle Inkline Against Humanity — LAN Server\r\ncd /d "%~dp0"\r\necho Starting Inkline Against Humanity LAN Server...\r\nstart "" http://localhost:4179\r\nnode server/lan-server.ts\r\npause\r\n`
)

fs.writeFileSync(
  path.join(PORTABLE_DIR, "start-lan.sh"),
  `#!/usr/bin/env bash\ncd "$(dirname "$0")"\necho "Starting Inkline Against Humanity LAN Server..."\nnode server/lan-server.ts\n`
)

fs.writeFileSync(
  path.join(PORTABLE_DIR, "README-PORTABLE.txt"),
  [
    "INKLINE AGAINST HUMANITY — PORTABLE EDITION",
    "============================================",
    "",
    "HOW TO RUN ON ANOTHER PC (Requires Node.js 22.19+ / 24+ / 25+):",
    "  Windows: Double-click start-lan.bat",
    "  Mac/Linux: Run ./start-lan.sh (or `node server/lan-server.ts`)",
    "",
    "PLAYING ON THE SAME WI-FI / LAN (3 to 8 Players):",
    "  1. Start the server on one PC.",
    "  2. The console prints your LAN address, e.g. http://192.168.1.42:4179",
    "  3. Everyone on the same Wi-Fi opens that link on their phone or laptop.",
    "  4. One person clicks 'LAN Party' -> 'Host', others enter the 4-letter Room Code!",
    "",
    "DEPLOYING STATICALLY TO GITHUB PAGES:",
    "  Upload the contents of `dist/` (or push the full repo with .github/workflows/deploy.yml).",
    "  Solo vs Bots, Pass & Play (3–8 players), Daily Sheet, Custom Cards, and PNG export work 100% offline!",
    ""
  ].join("\n")
)

console.log("4/4 Portable package ready at:", PORTABLE_DIR)
