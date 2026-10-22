import test from 'node:test'
import assert from 'node:assert/strict'
import {policy, decide} from './policy.mjs'

function samples(speedup = 1.2, rssRatio = 1) {
  return [{name: 'example', base: Array.from({length: policy.rounds}, () => ({timesMs: [100, 101, 99], peakRssBytes: 1000})),
    candidate: Array.from({length: policy.rounds}, () => ({timesMs: [100 / speedup, 101 / speedup, 99 / speedup], peakRssBytes: 1000 * rssRatio}))}]
}
test('only repeatable gains within per-workload and memory guards qualify', () => {
  assert.equal(decide(samples()).status, 'keep')
  assert.equal(decide(samples(1)).status, 'discard')
  assert.equal(decide(samples(1.2, 1.3)).status, 'discard')
  const mixed = [...samples(2), {...samples(0.9)[0], name: 'regression'}]
  assert.equal(decide(mixed).status, 'discard')
  const noisy = samples()
  noisy[0].candidate[1].timesMs = [110, 110, 110]
  assert.equal(decide(noisy).status, 'discard')
  assert.throws(() => decide([]), /No benchmark/)
})
