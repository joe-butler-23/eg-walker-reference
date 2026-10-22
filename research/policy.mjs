export const policy = Object.freeze({
  oracle: '7287f4bc2c054984838b3582a27b4fea8f6d8161',
  rounds: 3,
  repeats: 3,
  minSpeedup: 1.03,
  minWorkloadSpeedup: 1 / 1.05,
  maxRssRatio: 1.20,
  commandDeadlineMs: 180_000,
})

export const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
export const geometricMean = values => Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length)

export function decide(measurements) {
  if (measurements.length === 0) throw Error('No benchmark workloads selected')
  const workloads = measurements.map(({name, base, candidate}) => {
    const baseMs = median(base.flatMap(x => x.timesMs))
    const candidateMs = median(candidate.flatMap(x => x.timesMs))
    if (!(baseMs > 0 && candidateMs > 0)) throw Error(`Invalid measurement for ${name}`)
    return {name, baseMs, candidateMs, speedup: baseMs / candidateMs,
      rssRatio: Math.max(...candidate.map(x => x.peakRssBytes)) / Math.max(...base.map(x => x.peakRssBytes)),
      roundSpeedups: base.map((x, i) => median(x.timesMs) / median(candidate[i].timesMs))}
  })
  const speedup = geometricMean(workloads.map(x => x.speedup))
  const roundSpeedups = Array.from({length: policy.rounds}, (_, i) => geometricMean(workloads.map(x => x.roundSpeedups[i])))
  const reasons = []
  if (speedup < policy.minSpeedup) reasons.push('aggregate gain below 3%')
  for (const x of workloads) {
    if (x.speedup < policy.minWorkloadSpeedup) reasons.push(`${x.name}: latency regression above 5%`)
    if (x.rssRatio > policy.maxRssRatio) reasons.push(`${x.name}: process peak RSS regression above 20%`)
  }
  if (roundSpeedups.some(x => x <= 1)) reasons.push('gain did not repeat in every paired round')
  return {status: reasons.length ? 'discard' : 'keep', speedup, roundSpeedups, reasons, workloads}
}
