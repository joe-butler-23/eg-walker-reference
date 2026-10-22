import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import seedRandom from 'seed-random'
import { createWorkloads } from './workloads.mjs'

async function load(root) {
  const api = await import(pathToFileURL(resolve(root, 'dist/src/index.js')).href)
  const cg = await import(pathToFileURL(resolve(root, 'dist/src/causal-graph.js')).href)
  return { ...api, cg }
}

function rawFrontier(impl, log, version = log.cg.heads) {
  return impl.cg.lvToRawList(log.cg, version).slice().sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])
}

function doc(impl) {
  return { log: impl.createOpLog(), branch: impl.createEmptyBranch() }
}

function merge(impl, dest, source) {
  impl.mergeOplogInto(dest.log, source.log)
  impl.mergeChangesIntoBranch(dest.branch, dest.log)
}

function compareDocs(candidate, oracle, actual, expected) {
  assert.deepEqual(actual.branch.snapshot, expected.branch.snapshot)
  assert.deepEqual(rawFrontier(candidate, actual.log), rawFrontier(oracle, expected.log))
  assert.deepEqual(rawFrontier(candidate, actual.log, actual.branch.version),
    rawFrontier(oracle, expected.log, expected.branch.version))
  assert.deepEqual(candidate.getLatestVersion(actual.log).slice().sort(),
    oracle.getLatestVersion(expected.log).slice().sort())
}

function edit(impl, target, action) {
  const { agent, pos } = action
  if (action.type === 'ins') {
    impl.localInsert(target.log, agent, pos, ...action.values)
    target.branch.snapshot.splice(pos, 0, ...action.values)
  } else {
    impl.localDelete(target.log, agent, pos, action.length)
    target.branch.snapshot.splice(pos, action.length)
  }
  target.branch.version = target.log.cg.heads.slice()
}

function randomCase(candidate, oracle, seed) {
  const random = seedRandom(`eg-walker-research-v1/${seed}`)
  const int = n => Math.floor(random() * n)
  const actual = Array.from({ length: 3 }, () => doc(candidate))
  const expected = Array.from({ length: 3 }, () => doc(oracle))
  const tokens = ['a', 'é', '🧪', '👩‍💻', 'e\u0301', '\n', '中', '', '\0']
  let nextValue = 0
  let cases = 0
  for (let step = 0; step < 96; step++) {
    for (let e = 0; e < 2; e++) {
      const peer = int(3)
      const length = expected[peer].branch.snapshot.length
      const insert = length === 0 || random() < (length < 80 ? 0.58 : 0.40)
      const action = insert ? {
        type: 'ins', agent: `peer-${peer}`, pos: int(length + 1),
        values: Array.from({ length: 1 + int(4) }, () => {
          nextValue++
          return seed % 2 === 0 ? nextValue : `${tokens[int(tokens.length)]}:${nextValue}`
        }),
      } : {
        type: 'del', agent: `peer-${peer}`, pos: int(length),
      }
      if (!insert) action.length = 1 + int(Math.min(3, length - action.pos))
      edit(oracle, expected[peer], action)
      edit(candidate, actual[peer], action)
      compareDocs(candidate, oracle, actual[peer], expected[peer])
      cases++
    }
    const to = int(3)
    const from = (to + 1 + int(2)) % 3
    merge(oracle, expected[to], expected[from])
    merge(candidate, actual[to], actual[from])
    compareDocs(candidate, oracle, actual[to], expected[to])
    cases++
    if (step % 12 === 0) {
      for (let peer = 0; peer < 3; peer++) {
        const want = oracle.checkoutSimple(expected[peer].log)
        assert.deepEqual(candidate.checkoutSimple(actual[peer].log), want)
        assert.deepEqual(actual[peer].branch.snapshot, want)
        cases++
      }
    }
  }
  let converged
  let convergedFrontier
  for (const order of [[0, 1, 2], [2, 0, 1], [1, 2, 0]]) {
    const a = doc(candidate)
    const o = doc(oracle)
    for (const peer of order) {
      merge(oracle, o, expected[peer])
      merge(candidate, a, actual[peer])
      compareDocs(candidate, oracle, a, o)
      cases++
    }
    const before = {
      snapshot: a.branch.snapshot.slice(), ops: a.log.ops.length,
      frontier: rawFrontier(candidate, a.log),
    }
    merge(oracle, o, expected[order[0]])
    merge(candidate, a, actual[order[0]])
    compareDocs(candidate, oracle, a, o)
    assert.deepEqual(a.branch.snapshot, before.snapshot)
    assert.equal(a.log.ops.length, before.ops)
    assert.deepEqual(rawFrontier(candidate, a.log), before.frontier)
    assert.deepEqual(candidate.checkoutSimple(a.log), o.branch.snapshot)
    if (converged === undefined) {
      converged = o.branch.snapshot.slice()
      convergedFrontier = rawFrontier(oracle, o.log)
    } else {
      assert.deepEqual(a.branch.snapshot, converged)
      assert.deepEqual(rawFrontier(candidate, a.log), convergedFrontier)
      assert.deepEqual(o.branch.snapshot, converged)
    }
    cases++
  }
  return cases
}

function graphChecks(candidate, oracle) {
  const makeGraph = impl => {
    const cg = impl.cg.createCG()
    impl.cg.add(cg, 'a', 0, 5, [])
    impl.cg.add(cg, 'b', 0, 3, [])
    impl.cg.add(cg, 'c', 0, 4, [4, 7])
    impl.cg.add(cg, 'a', 5, 8, [11])
    return cg
  }
  const cg = makeGraph(candidate)
  const ref = makeGraph(oracle)
  const frontiers = [[], [4], [7], [4, 7], [7, 4], [11], [14], [4, 4], [14, 4, 7]]
  let cases = 0
  for (const from of frontiers) {
    for (const to of frontiers) {
      const a = Object.freeze(from.slice())
      const b = Object.freeze(to.slice())
      const graphBefore = structuredClone(cg)
      const refBefore = structuredClone(ref)
      const expected = oracle.cg.diff(ref, a, b)
      assert.deepEqual(candidate.cg.diff(cg, a, b), expected, 'causal diff ranges/order')
      assert.deepEqual(cg, graphBefore, 'causal diff mutated graph')
      assert.deepEqual(ref, refBefore, 'oracle diff mutated graph')
      assert.deepEqual(a, from)
      assert.deepEqual(b, to)
      cases++
    }
    const same = Object.freeze(from.slice())
    assert.deepEqual(candidate.cg.diff(cg, same, same), oracle.cg.diff(ref, same, same))
    cases++
  }
  return cases
}

function directApiChecks(candidate, oracle) {
  const build = impl => {
    const log = impl.createOpLog()
    const rootValues = ['🧪', 'é', '👩‍💻', '', 7, null, { label: 'object' }]
    impl.localInsert(log, 'root', 0, ...rootValues)
    const initialVersion = log.cg.heads.slice()
    for (let i = 0; i < 18; i++) {
      impl.localInsert(log, 'editor', i % 3, `front:${i}`)
      impl.localInsert(log, 'editor', i % 3 + 1, `adjacent:${i}`)
      impl.localDelete(log, 'editor', i % 3)
    }
    const id = ['raw', 0]
    const parents = impl.getLatestVersion(log)
    assert.equal(impl.pushOp(log, id, parents, 'ins', 0, 'raw-token'), true)
    assert.equal(impl.pushOp(log, id, parents, 'ins', 0, 'raw-token'), false)
    return { log, initialVersion, rootValues }
  }
  const a = build(candidate)
  const o = build(oracle)
  assert.deepEqual(candidate.checkoutSimple(a.log), oracle.checkoutSimple(o.log))
  assert.equal(candidate.checkoutSimpleString(a.log), oracle.checkoutSimpleString(o.log))
  assert.deepEqual(rawFrontier(candidate, a.log), rawFrontier(oracle, o.log))

  // Start at an earlier legal version, then apply only the declared target.
  const ab = { snapshot: a.rootValues.slice(), version: a.initialVersion.slice() }
  const ob = { snapshot: o.rootValues.slice(), version: o.initialVersion.slice() }
  candidate.mergeChangesIntoBranch(ab, a.log, a.log.cg.heads.slice())
  oracle.mergeChangesIntoBranch(ob, o.log, o.log.cg.heads.slice())
  compareDocs(candidate, oracle, { log: a.log, branch: ab }, { log: o.log, branch: ob })

  let cases = 4
  for (const [branchIds, targetIds] of [
    [a.log.cg.heads, a.log.cg.heads],
    [[...a.log.cg.heads, a.initialVersion[0], a.log.cg.heads[0]], a.log.cg.heads],
    [a.log.cg.heads, a.initialVersion],
    [a.log.cg.heads, [...a.log.cg.heads, a.log.cg.heads[0], a.initialVersion[0]]],
  ]) {
    const actual = { snapshot: ab.snapshot.slice(), version: branchIds.slice() }
    const expected = { snapshot: ob.snapshot.slice(), version: branchIds.slice() }
    const actualSnapshot = actual.snapshot
    const expectedSnapshot = expected.snapshot
    const actualTarget = Object.freeze(targetIds.slice())
    const expectedTarget = Object.freeze(targetIds.slice())
    candidate.mergeChangesIntoBranch(actual, a.log, actualTarget)
    oracle.mergeChangesIntoBranch(expected, o.log, expectedTarget)
    assert.equal(actual.snapshot, actualSnapshot, 'no-new-op merge changed snapshot identity')
    assert.equal(expected.snapshot, expectedSnapshot)
    assert.deepEqual(actual.snapshot, expected.snapshot)
    assert.deepEqual(actual.version, expected.version, 'no-new-op merge frontier normalization')
    assert.deepEqual(actualTarget, targetIds, 'merge changed requested version')
    cases++
  }
  const makeConcurrent = impl => {
    const log = impl.createOpLog()
    for (const agent of ['c', 'a', 'b']) {
      const peer = impl.createOpLog()
      impl.localInsert(peer, agent, 0, agent)
      impl.mergeOplogInto(log, peer)
    }
    return log
  }
  const concurrent = makeConcurrent(candidate)
  const concurrentRef = makeConcurrent(oracle)
  for (const ids of [concurrent.cg.heads, concurrent.cg.heads.slice().reverse(),
    [...concurrent.cg.heads, concurrent.cg.heads[0]]]) {
    const actual = candidate.checkout(concurrent)
    const expected = oracle.checkout(concurrentRef)
    actual.version = ids.slice()
    expected.version = ids.slice()
    const identity = actual.snapshot
    candidate.mergeChangesIntoBranch(actual, concurrent, ids.slice().reverse())
    oracle.mergeChangesIntoBranch(expected, concurrentRef, ids.slice().reverse())
    assert.equal(actual.snapshot, identity)
    assert.deepEqual(actual, expected, 'concurrent no-new-op frontier normalization')
    cases++
  }
  return cases
}

async function main() {
  const [candidateRoot, oracleRoot, option] = process.argv.slice(2)
  assert(candidateRoot && oracleRoot && (option === undefined || option === '--holdout'),
    'usage: node research/check.mjs <candidate-root> <oracle-root> [--holdout]')
  const candidate = await load(candidateRoot)
  const oracle = await load(oracleRoot)
  assert.deepEqual(Object.keys(candidate).sort(), Object.keys(oracle).sort(), 'public API changed')
  assert.deepEqual(Object.keys(candidate.cg).sort(), Object.keys(oracle.cg).sort(), 'causal graph API changed')
  const workloads = createWorkloads(oracleRoot, oracle)
  let cases = graphChecks(candidate, oracle) + directApiChecks(candidate, oracle)
  const corpus = []
  for (const workload of workloads) {
    const expected = workload.expected
    const output = workload.run(candidate, workload.prepare(candidate))
    assert.deepEqual(output, expected, `workload ${workload.name}`)
    corpus.push({ name: workload.name, ...workload.metadata })
    cases++
  }
  const seeds = option === '--holdout'
    ? Array.from({ length: 24 }, (_, i) => 90_000 + i)
    : Array.from({ length: 16 }, (_, i) => 1000 + i)
  for (const seed of seeds) {
    try {
      cases += randomCase(candidate, oracle, seed)
    } catch (error) {
      error.message = `seed ${seed}: ${error.message}`
      throw error
    }
  }
  const workloadModuleSha256 = createHash('sha256')
    .update(readFileSync(new URL('./workloads.mjs', import.meta.url))).digest('hex')
  process.stdout.write(JSON.stringify({ status: 'pass', cases,
    suite: option === '--holdout' ? 'holdout' : 'development', seeds, corpus,
    workloadModuleSha256 }) + '\n')
}

main().catch(error => {
  console.error(error.stack ?? error)
  process.exitCode = 1
})
