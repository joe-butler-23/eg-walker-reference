import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {performance} from 'node:perf_hooks'
const root = process.argv[2]
const api = await import(pathToFileURL(path.resolve(root, 'dist/src/index.js')))
const cg = await import(pathToFileURL(path.resolve(root, 'dist/src/causal-graph.js')))
for (const name of ['ff-raw', 'git-makefile-raw', 'node_nodecc-raw']) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'testdata', name + '.json')))
  const log = api.createOpLog()
  for (const txn of data.txns) {
    cg.add(log.cg, txn.agent, txn.seqStart, txn.seqStart + txn.span[1] - txn.span[0], txn.parents)
    for (let [pos, del, content] of txn.ops) {
      if (del) for (let i=0;i<del;i++) log.ops.push({type:'del',pos})
      else for (const token of content) log.ops.push({type:'ins',pos:pos++,content:token})
    }
  }
  const start=performance.now()
  const actual=api.checkoutSimpleString(log)
  const elapsedMs=performance.now()-start
  assert.equal(actual,data.endContent)
  console.log(JSON.stringify({name,operations:log.ops.length,status:'pass',elapsedMs,peakRssBytes:process.resourceUsage().maxRSS*1024}))
}
