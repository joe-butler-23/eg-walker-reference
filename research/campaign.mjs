import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {command, root} from './evaluate.mjs'

const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trimEnd()
const [countText, startRevision = 'HEAD'] = process.argv.slice(2)
const count = Number(countText)
if (!Number.isSafeInteger(count) || count < 1 || count > 20) throw Error('Usage: node research/campaign.mjs EXPERIMENTS(1..20) [START_REVISION]')
if (git('status', '--porcelain', '--untracked-files=no')) throw Error('Commit current work before a campaign')
const campaignId = new Date().toISOString().replaceAll(':', '-')
const directory = path.join(root, 'research/runs', `campaign-${campaignId}`)
fs.mkdirSync(directory, {recursive: true})
const workRoot = path.join(root, 'research/.work')
fs.mkdirSync(workRoot, {recursive: true})
const lock = path.join(workRoot, 'campaign.lock')
let best = git('rev-parse', '--verify', `${startRevision}^{commit}`)
fs.mkdirSync(lock)
const results = []
const modelBudget = {maxTokens: 200000, maxTurns: 30, timeoutMs: 600000}
const model = {provider: 'openai-codex', id: 'gpt-6.1-sol', thinking: 'high'}
try {
  for (let i = 0; i < count; i++) {
    const name = `experiment/${campaignId}/${i + 1}`
    const checkout = path.join(workRoot, `proposal-${campaignId}-${i + 1}`)
    const log = path.join(directory, `proposal-${i + 1}`)
    const record = {experiment: i + 1, base: best, branch: name, status: 'proposing'}
    try {
      await command('git', ['worktree', 'add', '-b', name, checkout, best], {log: log + '-worktree'})
      fs.symlinkSync(path.join(root, 'node_modules'), path.join(checkout, 'node_modules'), 'dir')
      const prompt = `Authorised local performance research in this disposable checkout. Parent owns claimed Bead egw-m50; do not write tracker or change commits/branches/remotes. Make ONE speed/efficiency improvement in src/index.ts or src/causal-graph.ts, preserving the entire public TypeScript API, generic payloads, ordering, merge and version semantics. Only those two files may change. Do not edit evaluator, tests, fixtures, dependencies, generated files, reference, or code outside this checkout. No special-casing workloads, environment detection, precomputed answers, delayed work, removing validation, or caching mutable inputs. Do not run heavy commands: parent runs frozen correctness and paired benchmarks under admission after you finish. Read research/README.md and targeted source slices, not whole-file dumps. Choose a concrete optimization, implement it, then stop with a short hypothesis summary. Aim to remove repeated work before adding machinery. No network or upstream writes. Previous experiments (derived results): ${JSON.stringify(results)}. Resource budget: ${JSON.stringify(modelBudget)}.`
      const proposal = await command('prime-agent', ['--print', '--mode', 'json', '--provider', model.provider, '--model', model.id, '--thinking', model.thinking, '--cwd', checkout, '--autonomous', '--autonomous-max-continuations', '1',
        '--autonomous-gate', 'git diff --check && ! git diff --quiet -- src/index.ts src/causal-graph.ts',
        '--autonomous-max-turns', String(modelBudget.maxTurns), '--autonomous-max-tokens', String(modelBudget.maxTokens),
        '--autonomous-timeout-ms', String(modelBudget.timeoutMs), prompt], {cwd: checkout, log, deadlineMs: modelBudget.timeoutMs + 30000, detached: true})
      const messages = proposal.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
      record.model = model
      record.proposalSession = messages.find(event => event.type === 'session')?.id
      const response = messages.filter(event => event.type === 'message_end' && event.message?.role === 'assistant').at(-1)?.message
      record.hypothesis = response?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? ''
      if (response?.stopReason === 'error' || !response) throw Error(`Proposal failed: ${response?.errorMessage ?? 'no assistant completion'}`)
      if (!messages.some(event => event.type === 'agent_end')) throw Error('Proposal did not finish')
      if (git('-C', checkout, 'rev-parse', 'HEAD') !== record.base) throw Error('Proposer changed commits')
      const modified = git('-C', checkout, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean)
      if (modified.length === 0 || modified.some(line => !['src/index.ts', 'src/causal-graph.ts'].includes(line.slice(3)))) {
        throw Error(`Proposer changed out-of-scope files or no source: ${modified.join(', ')}`)
      }
      await command('git', ['-C', checkout, 'add', '--', 'src/index.ts', 'src/causal-graph.ts'])
      await command('git', ['-C', checkout, 'commit', '-m', `perf: research experiment ${campaignId}/${i + 1}`], {log: log + '-commit'})
      const candidate = git('-C', checkout, 'rev-parse', 'HEAD')
      record.candidate = candidate
      const out = await command('agent-heavy', [process.execPath, path.join(root, 'research/evaluate.mjs'), best, candidate],
        {log: log + '-evaluation', deadlineMs: 3600000, detached: true})
      const events = out.trim().split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
      const final = events.findLast(event => event.event === 'complete')
      if (!final) throw Error('Evaluation did not complete')
      Object.assign(record, {status: final.status, speedup: final.speedup, reasons: final.reasons, evidence: final.output})
      if (final.status === 'keep') {
        best = candidate
        // Advance only a result branch. The user's current checkout is never reset.
        git('update-ref', `refs/heads/research/best-${campaignId}`, best)
      }
    } catch (error) {
      Object.assign(record, {status: 'failed', error: error.message})
    } finally {
      if (fs.existsSync(checkout)) await command('git', ['worktree', 'remove', '--force', checkout])
    }
    results.push(record)
    fs.writeFileSync(path.join(directory, 'campaign.json.tmp'), JSON.stringify({campaignId, modelBudget, model, best, results}, null, 2) + '\n')
    fs.renameSync(path.join(directory, 'campaign.json.tmp'), path.join(directory, 'campaign.json'))
    console.log(JSON.stringify(record))
  }
} finally {
  fs.rmdirSync(lock)
}
console.log(JSON.stringify({event: 'campaign-complete', best, experiments: results.length, accepted: results.filter(x => x.status === 'keep').length, failed: results.filter(x => x.status === 'failed').length, directory}))
if (results.every(x => x.status === 'failed')) process.exitCode = 1
