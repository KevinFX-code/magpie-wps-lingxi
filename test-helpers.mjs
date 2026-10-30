import { WPSLingxiAuthPlugin } from './index.mjs'

/**
 * 0.2.1 起 loader 会在「原生目录未预热」时先拉一次目录再决定路由。
 * 早期用例全部针对网页通路，且按 calls[0]/calls[1] 取请求，
 * 这里用一个假目录把预热做掉，之后它们的 fetch 桩就不会再收到目录请求。
 */
export async function prewarmNativeCatalog(plugin) {
  const prev = globalThis.fetch
  globalThis.fetch = async () => Response.json({
    data: { models: [{ key: '__native_probe__', name: 'Probe' }], plans: [] },
  })
  try {
    await plugin.provider.models({ id: 'wps-lingxi' }, { auth: { cookie: 'probe' } })
  } finally {
    globalThis.fetch = prev
  }
}

export async function makePlugin() {
  const plugin = await WPSLingxiAuthPlugin()
  await prewarmNativeCatalog(plugin)
  return plugin
}
