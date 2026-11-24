import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
  server: {
    port: 5179,
    host: true,
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:4179",
        ws: true
      }
    }
  },
  build: {
    target: "es2023"
  }
})
