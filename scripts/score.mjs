#!/usr/bin/env node
// 80 分评分卡 —— 可执行版。规则见 SCORING.md。
//
//   node scripts/score.mjs                # 给自己打分（当前目录）
//   node scripts/score.mjs ../my-plugin   # 给别的仓库打分
//   node scripts/score.mjs --json         # 机器可读
//
// 退出码：0 = ≥80 分（可以发布），1 = <80 分。
//
// 它只算「能自动算的」：A 合规 / B 测试 / D 说明书。
// C 语义 与 E 发布算不了 —— 输出里明确标「待人工」，并列出判据，
// 绝不用「看起来没问题」凑分。

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const args = process.argv.slice(2)
const jsonMode = args.includes("--json")
const ROOT = resolve(args.find((a) => !a.startsWith("--")) ?? ".")

const rows = []
let score = 0
let maxScore = 0

function section(key, title, points, got, detail) {
  maxScore += points
  score += got
  rows.push({ key, title, points, got, detail })
}

// ── A · 合规（40）────────────────────────────────────────────────────

// 优先用目标仓库自己的检查器；没有就用评分器自带的那份
// （这样「从零做的插件」也能被评分，而不是因为没带 scripts/ 直接 0 分）
const checkPath = [join(ROOT, "scripts/check.mjs"), join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "check.mjs")].find(existsSync)
let checkOk = false
let checkDetail = ""
if (!checkPath) {
  checkDetail = "找不到 check.mjs"
} else {
  const r = spawnSync(process.execPath, [checkPath, ROOT], { encoding: "utf8", timeout: 120000 })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  const m = out.match(/通过\s+(\d+)\s*·\s*警告\s*(\d+)\s*·\s*失败\s+(\d+)/)
  if (!m) {
    checkDetail = "check.mjs 输出无法解析，按 0 分"
  } else {
    const [, pass, warn, fail] = m.map(Number)
    const fails = fail
    const got = fails === 0 ? 40 : Math.max(0, 40 - fails * 8)
    checkDetail = `通过 ${pass} · 警告 ${warn} · 失败 ${fail}` +
      (warn > 0 ? `（${warn} 条警告需在提交里写「为什么可接受」）` : "")
    section("A", "合规", 40, got, checkDetail)
    checkOk = fails === 0
  }
}
if (!rows.some((r) => r.key === "A")) section("A", "合规", 40, 0, checkDetail)

// ── B · 测试（10）────────────────────────────────────────────────────

const testsDir = join(ROOT, "tests")
let bGot = 0
let bDetail = "没有 tests/ —— 复制模板的 tests/semantics.test.mjs 再改"
if (existsSync(testsDir)) {
  const files = readdirSync(testsDir).filter((f) => /\.(test|spec)\.(mjs|js|ts)$/.test(f))
  if (files.length === 0) {
    bDetail = "tests/ 里没有 *.test.* 文件"
  } else {
    const r = spawnSync(process.execPath, ["--test"], { cwd: ROOT, encoding: "utf8", timeout: 180000 })
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
    const fail = out.match(/ℹ fail\s+(\d+)/)
    const pass = out.match(/ℹ pass\s+(\d+)/)
    if (r.status === 0 && !Number(fail?.[1] ?? 1)) {
      bGot = 10
      bDetail = `${files.length} 个测试文件 · ${pass?.[1] ?? "?"} 条全过`
    } else {
      bGot = 5
      bDetail = `有测试但没全过（fail ${fail?.[1] ?? "?"}）`
    }
  }
}
section("B", "测试", 10, bGot, bDetail)

// ── C · 语义（25）—— 算不了，只列判据 ───────────────────────────────

const cItems = [
  ["C1", "config.models 有内容（静态占位也算）"],
  ["C2", "usage.used 是有限数字；aside 窗口不塞 amount/limit"],
  ["C3", "模型级错误用 404，不误用 401"],
  ["C4", "free 来自厂商声明，不从 rate === 0 反推"],
  ["C5", "refresh_token 串行；refresh 返回合并结果"],
]
rows.push({ key: "C", title: "语义（待人工，每项 5 分）", points: 25, got: null, detail: cItems })

// ── D · 说明书（15）──────────────────────────────────────────────────

let d = 0
const dDetail = []

// D1 · README 结构（6）：模板九段里的关键段落到齐 + 有实质长度
{
  const p = join(ROOT, "README.md")
  if (!existsSync(p)) {
    dDetail.push("D1 0/6：没有 README.md")
  } else {
    const t = readFileSync(p, "utf8")
    const has = {
      "开头数字": /\d/.test(t.slice(0, 1200)),
      "功能/特性": /功能|特性|支持|包括/.test(t),
      "安装": /安装|install|npm i|clone/i.test(t),
      "参考源": /参考源|来源|参考/.test(t),
      "模型": /模型|model/i.test(t),
    }
    const hit = Object.values(has).filter(Boolean).length
    const lenOk = t.length >= 1500
    const got = lenOk ? Math.round((hit / 5) * 6) : 0
    d += got
    dDetail.push(`D1 ${got}/6：${Object.entries(has).filter(([, v]) => v).map(([k]) => k).join(" · ") || "无"}${lenOk ? "" : "（内容太短）"}`)
  }
}

// D2 · CHANGELOG（4）—— 「有没有当前版本」已由 check.mjs 查，这里只查内容够不够实
{
  const p = join(ROOT, "CHANGELOG.md")
  if (!existsSync(p)) dDetail.push("D2 0/4：没有 CHANGELOG.md")
  else {
    const t = readFileSync(p, "utf8")
    const first = (t.split(/^## /m)[1] ?? "").trim()
    const got = first.length >= 240 ? 4 : first.length >= 80 ? 2 : 0
    d += got
    dDetail.push(`D2 ${got}/4：顶部一节 ${first.length} 字符（≥240 得 4，≥80 得 2）`)
  }
}

// D3 · registry-entry（3）
{
  const pkg = readPkg()
  const p = join(ROOT, "registry-entry.json")
  if (!existsSync(p) || !pkg) dDetail.push("D3 0/3：没有 registry-entry.json")
  else {
    try {
      const re = JSON.parse(readFileSync(p, "utf8"))
      const nameOk = re.package === pkg.name
      const zhOk = typeof re.summary?.zh === "string" && re.summary.zh.length > 4
      const enOk = typeof re.summary?.en === "string" && re.summary.en.length > 4
      const got = (nameOk ? 1 : 0) + (zhOk ? 1 : 0) + (enOk ? 1 : 0)
      d += got
      dDetail.push(`D3 ${got}/3：${nameOk ? "" : "package 名不一致 "}${zhOk ? "" : "缺中文 summary "}${enOk ? "" : "缺英文 summary"}`.trim() || `D3 3/3`)
    } catch {
      dDetail.push("D3 0/3：registry-entry.json 解析失败")
    }
  }
}

// D4 · README 讲清签入（2）
{
  const p = join(ROOT, "README.md")
  if (!existsSync(p)) dDetail.push("D4 0/2：没有 README.md")
  else {
    const t = readFileSync(p, "utf8")
    const got = /签入|登录|sign.?in/i.test(t) ? 2 : 0
    d += got
    dDetail.push(`D4 ${got}/2：${got ? "写清了签入什么" : "没写签入什么服务"}`)
  }
}
section("D", "说明书", 15, d, dDetail)

// ── E · 发布（10）—— 算不了，只列判据 ───────────────────────────────

rows.push({
  key: "E", title: "发布（待人工，4+3+3）", points: 10, got: null,
  detail: [
    ["E1", "npm view <包名> version 能查到当前版本（4）"],
    ["E2", "GitHub Release / tag 存在且指向当前版本（3）"],
    ["E3", "本机 magpie plugin add 装得上、magpie plugin 列得出（3）"],
  ],
})

function readPkg() {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  } catch {
    return null
  }
}

// ── 身份门：模板原样不算分 ────────────────────────────────────────────

const idPkg = readPkg()
let idRe = null
try {
  idRe = JSON.parse(readFileSync(join(ROOT, "registry-entry.json"), "utf8"))
} catch {}
// 常量可能按 AGENTS 第五节的建议放在 src/ 里（index.mjs 只装配），所以入口和 src 一起找
function readTree(dir) {
  let out = ""
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out += readTree(p)
    else if (/\.(mjs|js|ts)$/.test(e.name)) { try { out += readFileSync(p, "utf8") + "\n" } catch {} }
  }
  return out
}
let entrySrc = ""
try {
  entrySrc = readFileSync(join(ROOT, String(idPkg?.main ?? "index.mjs")), "utf8")
} catch {}
const allSrc = entrySrc + "\n" + readTree(join(ROOT, "src"))
const providerOf = allSrc.match(/const\s+PROVIDER\s*=\s*["'`]([^"'`]+)["'`]/)?.[1] ?? ""
const baseOf = allSrc.match(/const\s+BASE\s*=\s*["'`]([^"'`]+)["'`]/)?.[1] ?? ""
const gate = {
  "name 不是脚手架默认值": !!idPkg?.name && !["magpie-plugin-scaffold", "magpie-plugin-template"].includes(idPkg.name),
  "repository 不是模板地址": !!idPkg?.repository?.url && !String(idPkg.repository.url).includes("MYCF711/magpie-plugin-scaffold"),
  "registry-entry 的 package 与 name 一致": !!idRe?.package && idRe.package === idPkg?.name,
  "PROVIDER 不是模板占位": !!providerOf && !["xxx", "acme", "your-provider", "your_provider"].includes(providerOf),
  "BASE 不是模板占位": !!baseOf && baseOf !== "https://api.xxx.example/v1" && !/xxx/i.test(baseOf),
  "TODO 函数已实现（不再 throw TODO）": !/throw\s+new\s+Error\(\s*["'`]TODO/.test(entrySrc),
}
const gateOk = Object.values(gate).every(Boolean)

// ── 输出 ──────────────────────────────────────────────────────────────

const autoMax = rows.filter((r) => r.got !== null).reduce((s, r) => s + r.points, 0)
const autoGot = rows.filter((r) => r.got !== null).reduce((s, r) => s + r.got, 0)

if (jsonMode) {
  console.log(JSON.stringify({ root: ROOT, gate: { ok: gateOk, items: gate }, auto: { got: autoGot, max: autoMax }, rows }, null, 2))
  process.exit(gateOk && autoGot >= 55 ? 0 : 1)
}

const C = { bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", reset: "\x1b[0m" }
const mark = (got, points) => (got === null ? `${C.yellow}待人工${C.reset}` : got >= points ? `${C.green}${got}${C.reset}/${points}` : `${C.red}${got}/${points}`)

console.log(`\n${C.bold}80 分评分卡 · ${ROOT}${C.reset}\n`)
console.log(`  ${C.bold}身份门${C.reset}  ${gateOk ? `${C.green}通过${C.reset}` : `${C.red}未通过 —— 总分封顶 60${C.reset}`}`)
for (const [k, v] of Object.entries(gate)) {
  console.log(`      ${v ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`} ${k}`)
}
console.log("")
for (const r of rows) {
  console.log(`  ${C.bold}${r.key} · ${r.title}${C.reset}  ${mark(r.got, r.points)}`)
  const lines = Array.isArray(r.detail) ? r.detail : [r.detail]
  for (const line of lines) {
    if (Array.isArray(line)) console.log(`      ${C.dim}${line[0]}${C.reset}  ${line[1]}`)
    else if (line) console.log(`      ${C.dim}${line}${C.reset}`)
  }
}

console.log(`\n  ${C.bold}自动分：${gateOk ? autoGot : Math.min(autoGot, 60)} / ${autoMax}${C.reset}${C.dim}（C 25 + E 10 待人工）${C.reset}`)
console.log(`  ${C.dim}80 分线 = 身份门通过 + 自动分 ≥ 55 + C 拿满 25${C.reset}`)
console.log(`  ${C.dim}自动分满分 65：A 40 + B 10 + D 15${C.reset}\n`)

const ok = gateOk && autoGot >= 55
console.log(ok ? `  ${C.green}✓ 自动分已过线 —— 接着把 C 的 5 项逐条找判据${C.reset}\n`
               : !gateOk ? `  ${C.red}✗ 这是模板原样，不是你的插件 —— 先改 name / repository / registry-entry${C.reset}\n`
               : `  ${C.red}✗ 自动分没过线 —— 先补 A/B/D，别急着看 C${C.reset}\n`)
process.exit(ok ? 0 : 1)
