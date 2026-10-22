import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Prefixes stop before the first transaction that would exceed this bound.
export const TRACE_OP_CAP = 32_000
export const workloadNames = Object.freeze([
  'ff-full', 'git-prefix', 'node-prefix', 'append', 'middle-edits',
  'deletion-heavy', 'concurrent-inserts', 'incremental-merge', 'redundant-merge',
])

function importDT(impl, txns) {
  const log = impl.createOpLog()
  for (const txn of txns) {
    assert.equal(txn.span[0], log.ops.length, 'trace must be a causal prefix')
    const length = txn.span[1] - txn.span[0]
    impl.cg.add(log.cg, txn.agent, txn.seqStart, txn.seqStart + length, txn.parents)
    for (const [start, remove, content] of txn.ops) {
      assert.notEqual(remove > 0, content !== '', 'trace patch must insert or delete')
      if (remove > 0) {
        for (let i = 0; i < remove; i++) log.ops.push({ type: 'del', pos: start })
      } else {
        let pos = start
        for (const token of content) log.ops.push({ type: 'ins', pos: pos++, content: token })
      }
    }
    assert.equal(log.ops.length, txn.span[1], 'trace span must match expanded operations')
  }
  return log
}

function descriptor(name, mode, prepare, run, reference, metadata, fullEndContent) {
  let expected
  return {
    name, mode, prepare, run,
    get metadata() { return metadata() },
    get expected() {
      if (expected === undefined) {
        expected = run(reference, prepare(reference))
        if (fullEndContent) assert.equal(expected.join(''), fullEndContent())
        Object.freeze(expected)
      }
      return expected
    },
  }
}

function makeTrace(name, filename, cap, dataRoot, reference) {
  let selected
  function source() {
    if (selected === undefined) {
      const bytes = readFileSync(join(dataRoot, 'testdata', filename))
      const trace = JSON.parse(bytes)
      const txns = []
      let operations = 0
      for (const txn of trace.txns) {
        const length = txn.span[1] - txn.span[0]
        if (cap !== null && operations + length > cap) break
        txns.push(txn)
        operations += length
      }
      assert(operations > 0, `${name}: no complete transaction fits the operation cap`)
      selected = {
        txns, endContent: trace.endContent,
        metadata: {
          fixture: filename, fixtureSha256: createHash('sha256').update(bytes).digest('hex'),
          operations, transactions: txns.length, fullTrace: txns.length === trace.txns.length,
          operationCap: cap,
        },
      }
    }
    return selected
  }
  return descriptor(name, 'checkout', impl => importDT(impl, source().txns),
    (impl, log) => impl.checkoutSimple(log), reference, () => source().metadata,
    cap === null ? () => source().endContent : undefined)
}

function makeLinear(name, build, operations, reference) {
  return descriptor(name, 'checkout', build, (impl, log) => impl.checkoutSimple(log),
    reference, () => ({ operations, synthetic: true }))
}

function baseLog(impl, size, agent = 'base') {
  const log = impl.createOpLog()
  impl.localInsert(log, agent, 0, ...Array.from({ length: size }, (_, i) => `b${i}`))
  return log
}

function cloneLog(impl, log) {
  const copy = impl.createOpLog()
  impl.mergeOplogInto(copy, log)
  return copy
}

function prepareConcurrent(impl) {
  const base = baseLog(impl, 128)
  const result = cloneLog(impl, base)
  const peers = []
  for (let p = 0; p < 6; p++) {
    const peer = cloneLog(impl, base)
    impl.localInsert(peer, `peer-${p}`, 64,
      ...Array.from({ length: 400 }, (_, i) => `${p}:${i}`))
    impl.localDelete(peer, `peer-${p}`, 32, 32)
    peers.push(peer)
  }
  for (const p of [5, 0, 4, 1, 3, 2]) impl.mergeOplogInto(result, peers[p])
  return result
}

function prepareMerge(impl) {
  const base = baseLog(impl, 512)
  const dest = cloneLog(impl, base)
  impl.localInsert(dest, 'local', 256,
    ...Array.from({ length: 256 }, (_, i) => `local:${i}`))
  impl.localDelete(dest, 'local', 128, 64)
  const branch = impl.checkout(dest)
  const sources = []
  for (let p = 0; p < 4; p++) {
    const peer = cloneLog(impl, base)
    impl.localInsert(peer, `remote-${p}`, 256,
      ...Array.from({ length: 512 }, (_, i) => `remote-${p}:${i}`))
    impl.localDelete(peer, `remote-${p}`, 128, 64)
    sources.push(peer)
  }
  return { dest, branch, sources }
}

function runMerge(impl, { dest, branch, sources }) {
  for (const source of [...sources, sources[0]]) {
    impl.mergeOplogInto(dest, source)
    impl.mergeChangesIntoBranch(branch, dest)
  }
  return branch.snapshot
}

function prepareRedundantMerge(impl) {
  const log = baseLog(impl, 7000)
  return { log, branch: impl.checkout(log) }
}

function runRedundantMerge(impl, { log, branch }) {
  const snapshot = branch.snapshot
  for (let i = 0; i < 12; i++) impl.mergeChangesIntoBranch(branch, log)
  assert.equal(branch.snapshot, snapshot, 'redundant merge must preserve snapshot identity')
  return branch.snapshot
}

export function createWorkloads(dataRoot, reference) {
  const workloads = [
    makeTrace('ff-full', 'ff-raw.json', null, dataRoot, reference),
    makeTrace('git-prefix', 'git-makefile-raw.json', TRACE_OP_CAP, dataRoot, reference),
    makeTrace('node-prefix', 'node_nodecc-raw.json', TRACE_OP_CAP, dataRoot, reference),
    makeLinear('append', impl => baseLog(impl, 6000, 'append'), 6000, reference),
    makeLinear('middle-edits', impl => {
      const log = baseLog(impl, 1200)
      for (let i = 0; i < 1600; i++) {
        const pos = i % 2 === 0 ? 600 : (i * 37) % 1200
        impl.localInsert(log, 'editor', pos, `e${i}`)
        impl.localDelete(log, 'editor', (pos + 17) % 1200)
      }
      return log
    }, 4400, reference),
    makeLinear('deletion-heavy', impl => {
      const log = baseLog(impl, 3000)
      for (let i = 0; i < 2400; i++) {
        impl.localDelete(log, 'deleter', Math.floor((3000 - i) / 2))
      }
      return log
    }, 5400, reference),
    makeLinear('concurrent-inserts', prepareConcurrent, 2720, reference),
    descriptor('incremental-merge', 'merge', prepareMerge, runMerge, reference,
      () => ({ operations: 3136, merges: 5, synthetic: true })),
    descriptor('redundant-merge', 'merge', prepareRedundantMerge, runRedundantMerge, reference,
      () => ({ operations: 7000, merges: 12, synthetic: true })),
  ]
  assert.deepEqual(workloads.map(w => w.name), workloadNames)
  return workloads
}
