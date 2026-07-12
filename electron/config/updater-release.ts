import { app } from "electron"
import * as https from "node:https"
import * as fs from "node:fs"
import * as path from "node:path"
import semver from "semver"
import type { ChangelogEntry, LatestRelease } from "./updater-types"

export const GITHUB_OWNER = "lk-eternal"
export const GITHUB_REPO = "cursor-claw"
export const HOMEBREW_TAP = "lk-eternal/tap"
export const HOMEBREW_CASK = "cursor-claw"
export const STARTUP_CHECK_DELAY_MS = 4_000
export const DEV_FAKE_LATEST_VERSION = "99.99.99"

/** 未打包且环境变量开启时，用假版本走更新 UI 联调 */
export function isDevSimulateUpdate(): boolean {
  if (app.isPackaged) {
    return false
  }
  const v = (process.env.FEISHU_DEV_SIMULATE_UPDATE ?? "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

export function fakeLatestReleaseForDev(): LatestRelease {
  return {
    version: DEV_FAKE_LATEST_VERSION,
    htmlUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
  }
}

export function devSimulateDetailSuffix(): string {
  return "\n（开发测试：不会真的安装）"
}

export function normalizeReleaseVersion(tagName: string): string {
  return tagName.replace(/^v/i, "").trim()
}

export function fetchLatestRelease(): Promise<LatestRelease | null> {
  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path,
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "cursor-claw-desktop-updater",
        },
      },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume()
          resolve(null)
          return
        }
        const chunks: Buffer[] = []
        res.on("data", (c: Buffer) => chunks.push(c))
        res.on("end", () => {
          try {
            if (res.statusCode !== 200) {
              resolve(null)
              return
            }
            const json = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
              tag_name?: string
              html_url?: string
              body?: string | null
            }
            const tag = json.tag_name
            const htmlUrl = json.html_url
            if (typeof tag !== "string" || typeof htmlUrl !== "string") {
              resolve(null)
              return
            }
            const version = normalizeReleaseVersion(tag)
            if (!semver.valid(version)) {
              resolve(null)
              return
            }
            const releaseBody = typeof json.body === "string" ? json.body.trim() : undefined
            resolve({ version, htmlUrl, releaseBody: releaseBody || undefined })
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on("error", () => resolve(null))
    req.setTimeout(20_000, () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

function parseVersionEntry(text: string): ChangelogEntry | null {
  try {
    const parsed = JSON.parse(text) as ChangelogEntry
    if (
      typeof parsed.version === "string" &&
      typeof parsed.date === "string" &&
      Array.isArray(parsed.changes)
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

function sortChangelogEntries(entries: ChangelogEntry[]): ChangelogEntry[] {
  return [...entries].sort((a, b) => semver.rcompare(a.version, b.version))
}

function loadChangelogFromDir(dirPath: string): ChangelogEntry[] {
  try {
    if (!fs.existsSync(dirPath)) {
      return []
    }
    const entries: ChangelogEntry[] = []
    for (const file of fs.readdirSync(dirPath)) {
      if (!file.endsWith(".json")) {
        continue
      }
      const entry = parseVersionEntry(fs.readFileSync(path.join(dirPath, file), "utf-8"))
      if (entry) {
        entries.push(entry)
      }
    }
    return sortChangelogEntries(entries)
  } catch {
    return []
  }
}

function getBundledChangelogBaseDir(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath()
}

function readBundledChangelog(): ChangelogEntry[] {
  return loadChangelogFromDir(path.join(getBundledChangelogBaseDir(), "changelog"))
}

function fetchHttpsText(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { "User-Agent": "cursor-claw-desktop-updater" } }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("end", () => {
        if (res.statusCode !== 200) {
          resolve(null)
          return
        }
        resolve(Buffer.concat(chunks).toString("utf-8"))
      })
    })
    req.on("error", () => resolve(null))
    req.setTimeout(15_000, () => {
      req.destroy()
      resolve(null)
    })
  })
}

function fetchGitHubApiJson<T>(apiPath: string): Promise<T | null> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: apiPath,
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "cursor-claw-desktop-updater",
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c: Buffer) => chunks.push(c))
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(null)
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T)
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on("error", () => resolve(null))
    req.setTimeout(15_000, () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

async function fetchChangelogFromGitHub(): Promise<ChangelogEntry[]> {
  const items = await fetchGitHubApiJson<Array<{ name: string; type: string; download_url?: string | null }>>(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/changelog?ref=main`,
  )
  if (!items) {
    return []
  }
  const jsonFiles = items.filter((item) => item.type === "file" && item.name.endsWith(".json"))
  const entries = await Promise.all(
    jsonFiles.map(async (item) => {
      if (typeof item.download_url === "string") {
        const text = await fetchHttpsText(item.download_url)
        return text ? parseVersionEntry(text) : null
      }
      return null
    }),
  )
  return sortChangelogEntries(entries.filter((e): e is ChangelogEntry => e !== null))
}

async function fetchChangelogEntries(): Promise<ChangelogEntry[]> {
  const fromGitHub = await fetchChangelogFromGitHub()
  if (fromGitHub.length > 0) {
    return fromGitHub
  }
  return readBundledChangelog()
}

export function buildReleaseNotes(entries: ChangelogEntry[], currentVersion: string): string {
  const newer = entries.filter((e) => semver.valid(e.version) && semver.gt(e.version, currentVersion))
  if (newer.length === 0) {
    return ""
  }
  newer.sort((a, b) => semver.rcompare(a.version, b.version))
  return newer
    .map((e) => {
      const header = newer.length > 1 ? `v${e.version}：\n` : ""
      return header + e.changes.map((c) => `- ${c}`).join("\n")
    })
    .join("\n\n")
}

export async function resolveReleaseNotes(currentVersion: string, latest: LatestRelease | null): Promise<string> {
  const fromChangelog = buildReleaseNotes(await fetchChangelogEntries(), currentVersion)
  if (fromChangelog) {
    return fromChangelog
  }
  const body = latest?.releaseBody?.trim()
  if (body && latest && semver.gt(latest.version, currentVersion)) {
    return body
  }
  return ""
}
