#!/usr/bin/env node
/**
 * scripts/fetch-app-server.mjs
 *
 * 下载 WPS 灵犀官方 app-server（客户端内核）到 vendor/app-server/。
 *
 * 背景：灵犀「任务中心」里的「完整体验一次灵犀专家模式」与「使用灵犀客户端」
 * 两个一次性任务，服务端判定依据是**经 AI Gateway 发出的那一次真实客户端对话**
 * （纯 HTTP 模拟 agent-runtime / 老平面 aigc v3 实测均无法触发）。
 * app-server 就是客户端跑对话的内核，它支持 `-stdin` 的 JSON-RPC 模式，
 * 因此插件可以在本地把它拉起来、发一次最小对话，行为与真客户端一致。
 *
 * app-server 由官方 CDN 公开分发，无需鉴权：
 *   GET /api/aioffice/v1/cowork/app-server/versions → { download_url, hash }
 * 下载后按 zip 的 sha256 校验完整性。
 *
 * 用法：
 *   node scripts/fetch-app-server.mjs           # 自动查最新版本并下载
 *   node scripts/fetch-app-server.mjs --force   # 已存在也重新下载
 */

import { createHash } from "node:crypto"
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { spawn } from "node:child_process"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const VENDOR_DIR = join(ROOT, "vendor", "app-server")
const EXE_REL = join("service", "lingxi.exe")
const VERSIONS_API = "https://lingxi.kdocs.cn/api/aioffice/v1/cowork/app-server/versions"

const force = process.argv.includes("--force")

/** 查询官方最新 app-server 版本信息 */
async function fetchVersions() {
  const res = await fetch(VERSIONS_API, {
    headers: { Accept: "application/json", "User-Agent": "magpie-wps-lingxi" },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`版本接口 HTTP ${res.status}`)
  const json = await res.json()
  const win = json?.data?.app_server?.platforms?.win
  if (!win?.download_url) throw new Error("版本接口未返回 Windows 下载地址")
  return { url: win.download_url, hash: win.hash, version: json?.data?.app_server_version }
}

/** 下载文件并校验 sha256 */
async function download(url, dest, expectHash) {
  const res = await fetch(url, { signal: AbortSignal.timeout(600000) })
  if (!res.ok) throw new Error(`下载 HTTP ${res.status}`)
  const tmp = dest + ".part"
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))

  if (expectHash) {
    const hash = createHash("sha256")
    hash.update(await import("node:fs").then((fs) => fs.readFileSync(tmp)))
    const got = hash.digest("hex")
    if (got !== expectHash) {
      await rmSync(tmp, { force: true })
      throw new Error(`校验失败：期望 ${expectHash}，实际 ${got}`)
    }
  }
  const { renameSync } = await import("node:fs")
  renameSync(tmp, dest)
  return dest
}

/** 解压 zip（优先用系统 tar（Windows 10+ 自带 bsdtar），否则用 7z / unzip） */
async function unzip(zipPath, outDir) {
  const candidates = [
    { cmd: "tar", args: ["-xf", zipPath, "-C", outDir] },
    { cmd: "7z", args: ["x", `-o${outDir}`, "-y", zipPath] },
    { cmd: "7za", args: ["x", `-o${outDir}`, "-y", zipPath] },
    { cmd: "unzip", args: ["-q", zipPath, "-d", outDir] },
  ]
  for (const c of candidates) {
    const ok = await new Promise((res) => {
      const p = spawn(c.cmd, c.args, { stdio: "ignore", shell: process.platform === "win32" })
      p.on("error", () => res(false))
      p.on("exit", (code) => res(code === 0))
    })
    if (ok) return true
  }
  return false
}

async function main() {
  const exePath = join(VENDOR_DIR, EXE_REL)
  if (existsSync(exePath) && !force) {
    const size = statSync(exePath).size
    console.log(`✓ app-server 已存在（${(size / 1024 / 1024).toFixed(1)} MB），跳过下载`)
    console.log(`  ${exePath}`)
    return
  }

  console.log("→ 查询官方 app-server 版本…")
  const { url, hash, version } = await fetchVersions()
  console.log(`  版本 ${version}`)

  mkdirSync(VENDOR_DIR, { recursive: true })
  const zipPath = join(VENDOR_DIR, "app-server.zip")
  console.log("→ 下载中（约 90 MB）…")
  await download(url, zipPath, hash)
  console.log("  校验通过")

  console.log("→ 解压…")
  const extracted = join(VENDOR_DIR, "_extract")
  rmSync(extracted, { recursive: true, force: true })
  mkdirSync(extracted, { recursive: true })
  if (!(await unzip(zipPath, extracted))) {
    throw new Error("解压失败：请安装 7-Zip，或手动解压 vendor/app-server/app-server.zip")
  }
  rmSync(zipPath, { force: true })

  // zip 内可能是 app-server/service/lingxi.exe，也可能是 service/lingxi.exe
  let src = join(extracted, "app-server", "service", "lingxi.exe")
  if (!existsSync(src)) {
    const found = readdirSync(extracted).flatMap((d) => {
      const p = join(extracted, d, "service", "lingxi.exe")
      return existsSync(p) ? [p] : []
    })
    if (!found.length) throw new Error("压缩包内未找到 service/lingxi.exe")
    src = found[0]
  }
  const destDir = join(VENDOR_DIR, "service")
  mkdirSync(destDir, { recursive: true })
  const { copyFileSync } = await import("node:fs")
  copyFileSync(src, join(destDir, "lingxi.exe"))
  rmSync(extracted, { recursive: true, force: true })

  const size = statSync(join(destDir, "lingxi.exe")).size
  console.log(`✓ 完成：${join(destDir, "lingxi.exe")}（${(size / 1024 / 1024).toFixed(1)} MB）`)
}

main().catch((err) => {
  console.error("✗ " + (err?.message || err))
  process.exit(1)
})
