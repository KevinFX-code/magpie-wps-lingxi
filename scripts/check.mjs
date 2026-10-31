#!/usr/bin/env node
// 供应商插件规定 —— 可执行版
//
//   node scripts/check.mjs            # 检查当前目录
//   node scripts/check.mjs ../my-plugin
//
// 退出码 0 = 合规，1 = 不合规（CI 靠它卡门）。
//
// 为什么要有这个：规定写在 md 里只有认真的人会看；写成断言，谁都绕不过去。
// 它是给**作者自己**用的自查表 —— CI 绿了说明这个插件符合 magpie 的插件契约，
// 可以放心发布；把结果贴进 issue 也省得维护者一条条问。
//
// 它不做任何「提交到社区」的动作：收不收、收哪个，是维护者的事。

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = resolve(process.argv[2] ?? ".")
const results = []

function ok(cond, name, note, fix) {
  results.push({ level: cond ? "pass" : "fail", name, note, fix })
  return cond
}
function warn(cond, name, note, fix) {
  results.push({ level: cond ? "pass" : "warn", name, note, fix })
  return cond
}
function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

// ── 读 package.json ───────────────────────────────────────────────────

let pkg = null
const pkgPath = join(ROOT, "package.json")
if (ok(existsSync(pkgPath), "package.json 存在", "插件必须是一个 npm 包")) {
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  } catch (e) {
    ok(false, "package.json 可解析", String(e.message ?? e))
  }
}

if (pkg) {
  // ── ① 身份 ────────────────────────────────────────────────────────
  ok(typeof pkg.name === "string" && pkg.name.length > 0,
     "package.json 的 name 非空",
     "magpie 用包名做依赖键，卡片标题也从它来")

  warn(pkg.name !== "magpie-plugin-scaffold" && pkg.name !== "magpie-plugin-template",
       "name 已改成自己的（不是脚手架默认值）",
       "还叫脚手架名的话，别人装了会跟脚手架撞",
       "改成 <你的包名>")

  ok(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version ?? ""),
     "version 是语义化版本",
     "更新检测靠比版本号；不合法就一直显示「有新版」",
     `现在是 ${pkg.version}`)

  ok(typeof pkg.description === "string" && pkg.description.length >= 20,
     "description 说清楚了签入什么",
     "发现页只显示这一行")

  // ── ② 能不能被加载 ────────────────────────────────────────────────
  ok(pkg.type === "module",
     "type 是 module",
     "magpie 用 import() 加载，commonjs 会失败")

  const entry = pkg.main ?? (typeof pkg.exports === "string" ? pkg.exports : pkg.exports?.["."]?.import ?? pkg.exports?.["."])
  ok(!!entry, "声明了入口（main 或 exports）", "否则 magpie 猜不到从哪加载")
  if (entry) {
    ok(existsSync(join(ROOT, String(entry))), `入口文件存在：${entry}`)
  }

  ok(Array.isArray(pkg.files) && pkg.files.length > 0,
     "files 白名单非空",
     "不写就把整个仓库（含测试、截图）发到 npm")

  // ── ③ 能不能被搜到 ────────────────────────────────────────────────
  const kw = Array.isArray(pkg.keywords) ? pkg.keywords.map((k) => String(k).toLowerCase()) : []
  ok(kw.includes("opencode"), "keywords 含 opencode", "市场搜索问的是 npm `<query> opencode`")
  ok(kw.some((k) => k === "plugin" || k === "auth" || k === "provider"),
     "keywords 含 plugin / auth / provider 之一")
  ok(kw.some((k) => k === "magpie" || k === "magpie-plugin"),
     "keywords 含 magpie", "社区按这个收")

  // ── ④ 许可 ────────────────────────────────────────────────────────
  ok(pkg.license === "MIT", "license 是 MIT", "社区默认许可", `现在是 ${pkg.license}`)

  // ── ⑤ 图标：两个位置各管一块，最常漏的一条 ────────────────────────
  const icon = pkg.magpie?.icon
  if (icon) {
    ok(/^(https:\/\/|data:image\/)/i.test(icon),
       "magpie.icon 是 https:// 或 data:image/ 开头",
       "magpie 只认这两种（ownIcon）")
    ok(icon.length <= (3 << 19),
       "magpie.icon ≤ 1 MB",
       "超了会被丢掉，插件卡片回退成灰方块")
  } else {
    warn(false, "magpie.icon 已设置",
         "插件卡片（列表那一行、详情页左上角）只认它；auth.icon 到不了那里",
         "把 auth.icon 那份 data URI 抄进 package.json 的 magpie.icon")
  }

  const mc = pkg.magpie?.maxConcurrency
  if (mc !== undefined) {
    ok(Number.isInteger(mc) && mc >= 1 && mc <= 1000,
       "magpie.maxConcurrency 是 1-1000 的整数", "超出范围会被忽略")
  }

  // 卡片上的「承载」徽章不是 package.json 给的：magpie ≥ 0.1.1744 从插件**注册的
  // provider 名**派生（/api/plugins 的 serves），有内置订阅迁入或注册了 2 个以上
  // provider 才画。曾经草案里的 magpie.carries 从未随 magpie 发布过，留着它没人读。
  warn(pkg.magpie?.carries === undefined,
       "没有已作废的 magpie.carries",
       "徽章由注册的 provider 名派生（magpie ≥ 0.1.1744），这个字段宿主不读",
       "删掉 magpie.carries；想让徽章读起来清楚，改的是供应商 name")
}

// ── ⑥ LICENSE 逐字 MIT ────────────────────────────────────────────────

const licPath = join(ROOT, "LICENSE")
if (ok(existsSync(licPath), "LICENSE 文件存在", "GitHub 靠它认许可，卡片才有许可那一格")) {
  const lic = readFileSync(licPath, "utf8")
  ok(/Permission is hereby granted,\s*free of charge/i.test(lic),
     "LICENSE 是 MIT 正文",
     "归属说明别插进正文，否则 GitHub 返回 NOASSERTION")
  warn(!/^Portions of this/im.test(lic),
       "归属说明没有夹在 LICENSE 里",
       "夹了的话 GitHub 认不出 MIT",
       "挪到 NOTICE.md")
}

// ── ⑦ 入口加载 + 导出形状 ────────────────────────────────────────────
//
// 官方原话：模块导出的**每个函数**都会被当作插件调用。
// 所以入口文件里不许有辅助函数 —— 这条不查出来，装上去会多出一堆假供应商。

const entryFile = pkg?.main ?? (typeof pkg?.exports === "string" ? pkg.exports : pkg?.exports?.["."]?.import ?? pkg?.exports?.["."])
if (entryFile && existsSync(join(ROOT, String(entryFile)))) {
  const p = join(ROOT, String(entryFile))
  let mod = null
  let loadErr = ""
  try {
    mod = await import(pathToFileURL(p).href)
  } catch (e) {
    loadErr = String(e?.message ?? e)
  }

  if (ok(!loadErr, "入口能被 import", "加载失败 = 插件完全不工作", loadErr.slice(0, 300))) {
    const fns = Object.entries(mod).filter(([, v]) => typeof v === "function")
    ok(fns.length > 0, "至少导出一个插件函数", "形如 export const XxxAuthPlugin = async (...) => ({...})")

    for (const [name, fn] of fns) {
      let hooks = null
      try {
        hooks = await fn({ client: {}, directory: ROOT }, undefined)
      } catch (e) {
        ok(false, `导出函数 ${name} 能被调起来`,
           "加载时抛错会让整个插件宿主起不来",
           String(e?.message ?? e).slice(0, 200))
        continue
      }
      const keys = hooks && typeof hooks === "object" ? Object.keys(hooks) : []
      const known = keys.filter((k) => ["config", "auth", "provider", "chat.headers"].includes(k))
      ok(known.length > 0, `导出函数 ${name} 返回了钩子`,
         "一个都没有 = 它不是插件，只是被误导出（辅助函数要挂到 _internal 对象上）",
         `拿到的键：${keys.join(",") || "(空)"}`)
    }

    const objExports = Object.keys(mod).filter((k) => k !== "default" && typeof mod[k] === "object")
    warn(true,
         objExports.length ? `对象导出（不会被当插件）：${objExports.join(", ")}` : "没有多余的对象导出",
         "测试用的东西放 _internal 这类对象里")
  }
}

// ── ⑧ CHANGELOG 有当前版本 ───────────────────────────────────────────

const chgPath = join(ROOT, "CHANGELOG.md")
if (existsSync(chgPath) && pkg?.version) {
  const chg = readFileSync(chgPath, "utf8")
  ok(chg.includes(pkg.version),
     `CHANGELOG 有 ${pkg.version} 这一段`,
     "发版时 Release 正文从它抽；没有就等于没写更新说明")
}

// ── ⑨ 敏感信息 ────────────────────────────────────────────────────────
//
// 别人会 fork、会 PR。真 token 混进来一次就是一次泄露。

const SUSPECT = [
  [/eyJhbGciOiJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{20,}/, "看起来像真的 JWT"],
  [/[Cc]:[\\/]Users[\\/][A-Za-z0-9._-]+/, "硬编码的本机用户路径"],
]

for (const target of ["index.mjs", "src", "README.md", "docs", "tests", "tools", "scripts"]) {
  const p = join(ROOT, target)
  if (!existsSync(p)) continue
  const files = statSync(p).isDirectory() ? walk(p) : [p]
  for (const f of files) {
    if (!/\.(m?js|ts|json|md)$/.test(f)) continue
    const text = readFileSync(f, "utf8")
    for (const [re, why] of SUSPECT) {
      const m = text.match(re)
      if (!m) continue
      const hit = m[0]
      if (/fake|example|placeholder|占位|demo|deadbeef|test-jwt/i.test(hit)) continue
      if (/Users[\\/]+(Administrator|test|user|you)\b/i.test(hit) && /your|example|占位/i.test(hit)) continue
      const rel = f.replace(ROOT + "\\", "").replace(ROOT + "/", "")
      warn(false, `${rel}: ${why}`,
           `命中的是 ${hit.slice(0, 44)}`,
           why.includes("路径") ? "换成 join(homedir(), ...)" : "换成占位符")
    }
  }
}

// ── ⑩ usage 窗口的两条静默失败写法 ────────────────────────────────────
//
// 这两种写法都不会抛异常、magpie 也不报错，只是卡片悄悄变成「剩余额度未知」，
// 或者算出一个假占比。实测踩过（magpie-magicrew-auth 0.3.18，三条账号全中）。
// 判据与论证见 HOOKS.md 第三节「三条写错不报错的窗口规矩」。

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
const ISO_STRICT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

for (const target of ["src", "index.mjs"]) {
  const p = join(ROOT, target)
  if (!existsSync(p)) continue
  const files = statSync(p).isDirectory() ? walk(p) : [p]
  for (const f of files) {
    if (!/\.m?js$/.test(f)) continue
    const text = readFileSync(f, "utf8")
    if (!/usage|windows|aside|resetsAt/.test(text)) continue
    const rel = f.replace(ROOT + "\\", "").replace(ROOT + "/", "")
    const lines = text.split("\n")

    // ① aside: true 的窗口不该给 amount / limit —— 给了就是假占比
    lines.forEach((line, i) => {
      if (!/\baside\s*:\s*true\b/.test(line)) return
      if (/^\s*(\/\/|\*)/.test(line)) return // 注释里提一嘴不算
      const around = lines.slice(Math.max(0, i - 6), i + 7).join("\n")
      const hit = /\b(amount|limit)\s*:/.exec(around)
      if (!hit) return
      warn(
        false,
        `${rel}:${i + 1}  aside 窗口给了 ${hit[1]}`,
        "magpie 会把它当真额度算占比，而「总量=剩余」的假总量永远算成 100%",
        "aside 窗口只给 display + unit，把 amount/limit 去掉",
      )
    })

    // ② resetsAt / runsOutAt 的字符串字面量必须是 ISO —— 否则整条窗口被跳过
    const timeRe = /\b(resetsAt|runsOutAt)\s*:\s*(["'`])([^"'`\n]{4,60})\2/g
    let m
    while ((m = timeRe.exec(text)) !== null) {
      const val = m[3]
      if (!/^\d{4}-/.test(val)) continue // 不是时间字面量（表达式/变量）不管
      if (ISO_STRICT.test(val)) continue
      warn(
        false,
        `${rel}  ${m[1]} 不是 ISO 格式`,
        `命中 "${val}" —— magpie 解析不了会把整条窗口丢掉（卡片显示「剩余额度未知」）`,
        "厂商给的 \"2026-10-28 23:59:59\" 要先自己拆字段再 toISOString()",
      )
    }
  }
}

// ── ⑪ registry 条目与包名一致 ─────────────────────────────────────────
//
// 条目是提交给 magpie-community/plugins 的那份 JSON。它**不属于运行时** ——
// 插件不许把条目写进 magpie 的市场缓存（plugins#399 的 review 明确要求）。
//
// ⚠ 要核对的是 **npm 上的包名**，不是 package.json 的 name：显示名带大写的插件
// （OfficeAce、Loomy…）用 publish-npm.mjs 在发布时换名，registry 条目跟的是那个名字。
// 所以有发布脚本就取它里面的 PUBLISH_AS / NPM_NAME，没有才退回 package.json 的 name。

const publishScript = join(ROOT, "publish-npm.mjs")
let npmName = pkg?.name
if (existsSync(publishScript)) {
  const src = readFileSync(publishScript, "utf8")
  const m = src.match(/(?:PUBLISH_AS|NPM_NAME)\s*=\s*["']([^"']+)["']/)
  if (m) npmName = m[1]
}

const entryJson = join(ROOT, "registry-entry.json")
if (existsSync(entryJson) && pkg?.name) {
  let entry = null
  try {
    entry = JSON.parse(readFileSync(entryJson, "utf8"))
  } catch (e) {
    ok(false, "registry-entry.json 是合法 JSON", String(e.message))
  }
  if (entry) {
    if (entry.package === "your-package-name") {
      warn(false, "registry 条目还是模板占位名",
           "模板自己留着占位名；派生出来的仓库要改成自己的包名",
           "把 your-package-name / your-provider-id 换成真的")
    } else {
      ok(entry.package === npmName,
         "registry 条目的 package 与 npm 包名一致",
         "不一致会让市场认错包（UPDATING.md「改名的三处必须同步」）",
         `条目写 ${entry.package}，npm 包名是 ${npmName}`)
    }
    ok(typeof entry.name === "string" && entry.name.length > 0,
       "registry 条目有 name（市场里的显示名）")
    ok(entry.summary && typeof entry.summary.zh === "string" && typeof entry.summary.en === "string",
       "registry 条目有中英双语 summary")
  }
} else {
  warn(false, "没有 registry-entry.json",
       "想上 registry 才需要它；不上架也不影响使用",
       "从模板根目录复制一份，改 package / name / providers / summary")
}

{
  // 插件不该写 magpie 的缓存目录 —— 静态查一下入口与 src 里有没有市场缓存路径
  const abs = []
  if (entryFile && existsSync(join(ROOT, String(entryFile)))) abs.push(join(ROOT, String(entryFile)))
  const srcDir = join(ROOT, "src")
  if (existsSync(srcDir)) abs.push(...walk(srcDir))
  const hits = abs
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => /plugin-market\.json|startSelfRegister/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length + 1))
  ok(hits.length === 0,
     "不写 magpie 的市场缓存（plugin-market.json）",
     "那份文件属于 magpie：按包名 merge 会把 registry 条目盖掉",
     `命中的文件：${hits.join(", ")}`)
}

// ── 输出 ──────────────────────────────────────────────────────────────

const fails = results.filter((r) => r.level === "fail")
const warns = results.filter((r) => r.level === "warn")
const passes = results.filter((r) => r.level === "pass")

const mark = { pass: "\x1b[32m✓\x1b[0m", fail: "\x1b[31m✗\x1b[0m", warn: "\x1b[33m!\x1b[0m" }
console.log(`\n供应商插件规定检查 · ${ROOT}\n`)
for (const r of results) {
  console.log(`  ${mark[r.level]} ${r.name}`)
  if (r.level !== "pass" && r.note) console.log(`      ${r.note}`)
  if (r.level !== "pass" && r.fix) console.log(`      → ${r.fix}`)
}
console.log(`\n  通过 ${passes.length} · 警告 ${warns.length} · 失败 ${fails.length}\n`)

// 这个脚本只能查「能查的那部分」。剩下两件事它看不见，但漏了照样出事 ——
// 而且通常不报错。把出口指过去，别让「脚本绿了」被当成「能发布了」。
console.log(`  它还看不到的（${"CHECKLIST.md"}）：`)
console.log(`    交付前 —— A 表：钩子语义、上下文窗口实测、模型错误码用了 404 还是 401`)
console.log(`    发版前 —— B 表：只推功能分支，PR 全绿合并后才发布；直接推 main 会把坏包分发给用户\n`)
process.exit(fails.length ? 1 : 0)
