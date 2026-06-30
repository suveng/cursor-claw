import { resolve } from "node:path"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

/** 从 argv 解析 --profile=<name>，供 dev 多开端口隔离 */
function parseProfileArg(): string {
  const arg = process.argv.find((a) => a.startsWith("--profile="))
  return arg?.split("=")[1] ?? ""
}

/** profile 名稳定映射到 0–49，同一 profile 每次 dev 端口一致 */
function profilePortOffset(name: string): number {
  if (!name) return 0
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 50
}

const profileName = parseProfileArg()
const rendererDevPort = 5173 + profilePortOffset(profileName)

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "electron-store",
          "electron-updater",
          "node-cron",
          "cron-parser",
          "semver",
        ],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve("electron/main.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("electron/preload.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react(), tailwindcss()],
    server: {
      // 显式绑定 IPv4：Node 17+ 解析 localhost 可能优先 ::1，
      // 导致 dev server 只监听 IPv6 而 Electron 按 127.0.0.1 连接失败（白屏）
      host: "127.0.0.1",
      // 多开 --profile= 时各实例独立 Vite 端口，避免争用 5173
      port: rendererDevPort,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: resolve("src/renderer/index.html"),
      },
    },
  },
})
