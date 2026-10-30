import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makePlugin } from './test-helpers.mjs'
const plugin = await makePlugin()
const auth = async () => ({cookie:'wps_sid=mock'})
const loader = await plugin.auth.loader(auth)
const nativeFetch = globalThis.fetch
const normal = 'data: {"type":"text","data":"你好"}\n\ndata: {"type":"end"}\n\n'
async function run(sse, stream=false, extra={}, sessionStatus=200) {
  const calls=[]
  globalThis.fetch=async(url,init)=>{
    calls.push({url,init})
    if(url.endsWith('/sessions')) return Response.json(sessionStatus===200?{data:{session_id:'test'}}:{}, {status:sessionStatus})
    const bytes=new TextEncoder().encode(sse)
    return new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close()}}))
  }
  const res=await loader.fetch('https://mock',{body:JSON.stringify({messages:[{role:'user',content:'test'}],stream,...extra})})
  return {status:res.status,text:await res.text(),calls}
}
test('regressions',async(t)=>{
  try {
    for(const stream of [false,true]) {
      for(const prefix of ['', 'data: {"type":"text","data":"partial"}\n\n']) {
        await t.test(`error propagated stream=${stream} partial=${!!prefix}`,async()=>{
          const r=await run(prefix+'event: error\ndata: {"code":"quota_exceeded","message":"Quota exhausted"}\n\n',stream)
          assert.equal(r.status,stream?200:502)
          assert.match(r.text,/quota_exceeded/)
          assert.doesNotMatch(r.text,/\[DONE\]/)
        })
      }
      await t.test(`empty error stream=${stream}`,async()=>{
        assert.match((await run('event: error\ndata:\n\n',stream)).text,/upstream_error/)
      })
    }
    for(const sep of ['\n','\r\n','\r']) await t.test(`UTF8 and separator ${JSON.stringify(sep)}`,async()=>{
      const r=await run(normal.replaceAll('\n',sep))
      assert.equal(JSON.parse(r.text).choices[0].message.content,'你好')
    })
    await t.test('truncated stream is an error',async()=>{
      assert.equal((await run('data: {"type":"text","data":"partial"}\n\n')).status,502)
    })
    for(const status of [401,429,500]) await t.test(`session ${status} stops completions`,async()=>{
      const r=await run(normal,false,{},status)
      assert.equal(r.status,status);assert.equal(r.calls.length,1)
    })
    for(const [effort,expected] of [[0,'0'],['0','0'],[1,'1'],[2,'2'],['low','0'],['high','1'],['max','2']]) await t.test(`effort ${effort}`,async()=>{
      const r=await run(normal,false,{reasoning_effort:effort})
      assert.equal(JSON.parse(r.calls[1].init.body).reasoning_effort,expected)
    })
    await t.test('invalid effort causes no upstream request',async()=>{
      const r=await run(normal,false,{reasoning_effort:'unknown'})
      assert.equal(r.status,400);assert.equal(r.calls.length,0)
    })
    await t.test('prototype names are not effort values',async()=>{
      const r=await run(normal,false,{reasoning_effort:'constructor'})
      assert.equal(r.status,400);assert.equal(r.calls.length,0)
    })
    await t.test('abort before request',async()=>{
      let calls=0;globalThis.fetch=async()=>{calls++;throw Error('should not run')}
      const ac=new AbortController();ac.abort()
      await assert.rejects(loader.fetch('https://mock',{signal:ac.signal}),{name:'AbortError'})
      assert.equal(calls,0)
    })
    await t.test('20 requests have independent sessions and signals',async()=>{
      let n=0;const ids=[];const ac=new AbortController()
      globalThis.fetch=async(url,init)=>{
        assert.equal(init.signal,ac.signal)
        if(url.endsWith('/sessions'))return Response.json({data:{session_id:String(++n)}})
        ids.push(url);return new Response(normal)
      }
      await Promise.all(Array.from({length:20},()=>loader.fetch('https://mock',{signal:ac.signal,body:JSON.stringify({messages:[{role:'user',content:'test'}],stream:false})}).then(r=>r.text())))
      assert.equal(new Set(ids).size,20)
    })
    await t.test('quota expiry is not reset; balance-only remains visible',async()=>{
      for(const data of [{total_balance:150,bonus_summary:{total_value:200,total_consumed:50},bonus_credits:[{balance:50,expire_time:'2026-11-01'},{balance:100,expire_time:'2026-12-01'}]}, {total_balance:100},{total_balance:0}]){
        globalThis.fetch=async()=>Response.json({data})
        const result=await plugin.auth.usage(auth)
        assert.equal(result.windows.length,1)
        assert.equal(result.windows[0].resetsAt,undefined)
        assert.equal(result.windows[0].runsOutAt,undefined)
      }
    })
    await t.test('quota invalid numbers are an error',async()=>{
      globalThis.fetch=async()=>Response.json({data:{total_balance:'bad'}})
      assert.match((await plugin.auth.usage(auth)).error,/Invalid/)
    })
    for(const response of [()=>Response.json({data:{}}),()=>new Response('not JSON')]) await t.test('invalid session response stops completions',async()=>{
      let calls=0;globalThis.fetch=async()=>{calls++;return response()}
      const res=await loader.fetch('https://mock',{body:JSON.stringify({stream:false})})
      assert.equal(res.status,502);assert.equal(calls,1)
    })
    await t.test('transport interruption becomes nonstream error',async()=>{
      globalThis.fetch=async(url)=>url.endsWith('/sessions')?Response.json({data:{session_id:'test'}}):new Response(new ReadableStream({start(c){c.error(Error('connection reset'))}}))
      const res=await loader.fetch('https://mock',{body:JSON.stringify({stream:false})})
      assert.equal(res.status,502);assert.match(await res.text(),/incomplete_stream/)
    })
    await t.test('multiline SSE data and final unterminated line',async()=>{
      const r=await run('data: {"type":"text",\ndata: "data":"你好"}\n\ndata: {"type":"end"}')
      assert.equal(JSON.parse(r.text).choices[0].message.content,'你好')
    })
  } finally {globalThis.fetch=nativeFetch}
})

