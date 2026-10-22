import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { createWorkloads, workloadNames } from './workloads.mjs'

async function load(root) {
  const api = await import(pathToFileURL(resolve(root, 'dist/src/index.js')).href)
  const cg = await import(pathToFileURL(resolve(root, 'dist/src/causal-graph.js')).href)
  return { ...api, cg }
}

async function main() {
  const [snapshotRoot, oracleRoot, name, repeatsArg] = process.argv.slice(2)
  const repeats = Number(repeatsArg)
  assert(snapshotRoot && oracleRoot && workloadNames.includes(name)
    && Number.isSafeInteger(repeats) && repeats > 0,
  'usage: node --expose-gc research/bench-worker.mjs <snapshot-root> <oracle-root> <workload-name> <repeats>')
  assert.equal(typeof global.gc, 'function', 'run node with --expose-gc')
  const impl = await load(snapshotRoot)
  const oracle = await load(oracleRoot)
  const workload = createWorkloads(oracleRoot, oracle).find(w => w.name === name)
  const expected = workload.expected
  let maxHeapUsedBytes = 0
  const timesMs = []
  for (let iteration = 0; iteration < 2 + repeats; iteration++) {
    const state = workload.prepare(impl)
    global.gc()
    const start = performance.now()
    const output = workload.run(impl, state)
    const elapsed = performance.now() - start
    maxHeapUsedBytes = Math.max(maxHeapUsedBytes, process.memoryUsage().heapUsed)
    assert.deepEqual(output, expected, `workload ${name}`)
    if (iteration >= 2) timesMs.push(elapsed)
  }
  const workloadModuleSha256 = createHash('sha256')
    .update(readFileSync(new URL('./workloads.mjs', import.meta.url))).digest('hex')
  process.stdout.write(JSON.stringify({ name, timesMs,
    peakRssBytes: process.resourceUsage().maxRSS * 1024, maxHeapUsedBytes,
    heapMeasurement: 'maximum sampled heapUsed immediately after each warmup and measured run; whole process',
    rssMeasurement: 'process lifetime maximum RSS, including setup, oracle and warmups',
    warmups: 2, checksum: createHash('sha256').update(JSON.stringify(expected)).digest('hex'),
    workloadModuleSha256, workload: workload.metadata,
  }) + '\n')
}

main().catch(error => {
  console.error(error.stack ?? error)
  process.exitCode = 1
})
