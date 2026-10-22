import {spawn} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {performance} from 'node:perf_hooks'
import {policy, decide} from './policy.mjs'
import {workloadNames} from './workloads.mjs'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const git = (...args) => {
  const {execFileSync} = process.getBuiltinModule('node:child_process')
  return execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim()
}
const resolve = rev => git('rev-parse', '--verify', `${rev}^{commit}`)
const save = (filename, value) => {
  fs.writeFileSync(filename + '.tmp', JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(filename + '.tmp', filename)
}

export function command(command, args, {cwd = root, log, deadlineMs = policy.commandDeadlineMs, detached = false} = {}) {
  const start = new Date().toISOString()
  const before = performance.now()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, stdio: ['ignore', 'pipe', 'pipe'], detached})
    const stdout = [], stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      // Supervisor commands own a group; evaluator workers inherit that group.
      try { detached ? process.kill(-child.pid, 'SIGKILL') : child.kill('SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e }
    }, deadlineMs)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer)
      const out = Buffer.concat(stdout).toString(), err = Buffer.concat(stderr).toString()
      const record = {command, args, cwd, start, end: new Date().toISOString(), elapsedMs: performance.now() - before,
        exitCode, signal, deadlineMs, expired, stdoutSha256: hash(out), stderrSha256: hash(err)}
      if (log) {
        fs.writeFileSync(log + '.stdout', out)
        fs.writeFileSync(log + '.stderr', err)
        save(log + '.json', record)
      }
      if (exitCode !== 0 || expired) {
        const error = Error(`${command} exited ${exitCode ?? signal}${expired ? ' (deadline)' : ''}: ${err.slice(-2000)}${out.slice(-1000)}`)
        error.record = record
        reject(error)
      } else resolve(out)
    })
  })
}

function fingerprint() {
  const evaluator = {}
  for (const name of fs.readdirSync(path.join(root, 'research')).filter(x => /\.(mjs|md)$/.test(x)).sort()) {
    evaluator[name] = hash(fs.readFileSync(path.join(root, 'research', name)))
  }
  return {evaluator, lock: hash(fs.readFileSync(path.join(root, 'package-lock.json'))),
    installedLock: hash(fs.readFileSync(path.join(root, 'node_modules', '.package-lock.json'))),
    compiler: hash(fs.readFileSync(path.join(root, 'node_modules/typescript/lib/tsc.js'))),
    node: process.version, nodeExecutable: fs.realpathSync(process.execPath),
    host: os.hostname(), os: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
    env: {NODE_OPTIONS: process.env.NODE_OPTIONS ?? '', UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? ''}, policy}
}

async function snapshot(rev, destination, logs) {
  fs.mkdirSync(destination, {recursive: true})
  const archive = destination + '.tar'
  await command('git', ['archive', '--format=tar', '-o', archive, rev], {log: path.join(logs, `archive-${path.basename(destination)}`)})
  await command('tar', ['-xf', archive, '-C', destination], {log: path.join(logs, `extract-${path.basename(destination)}`)})
  fs.unlinkSync(archive)
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(destination, 'node_modules'), 'dir')
  // All three sources compile against the evaluator's single locked dependency installation.
  await command(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', destination],
    {log: path.join(logs, `compile-${path.basename(destination)}`)})
  return destination
}

export async function evaluate(baseRevision, candidateRevision, {holdout = false, destination} = {}) {
  const base = resolve(baseRevision), candidate = resolve(candidateRevision), oracle = resolve(policy.oracle)
  const changes = git('diff', '--name-only', base, candidate).split('\n').filter(Boolean)
  if (changes.some(name => !['src/index.ts', 'src/causal-graph.ts'].includes(name))) {
    throw Error(`Candidate changed files outside implementation: ${changes.join(', ')}`)
  }
  if (git('status', '--porcelain', '--untracked-files=no')) throw Error('Commit evaluator and implementation before measuring')
  if (process.env.NODE_OPTIONS) throw Error('Unset NODE_OPTIONS; evaluator uses explicit runtime flags')
  const output = path.resolve(destination ?? path.join(root, 'research/runs', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`))
  fs.mkdirSync(path.dirname(output), {recursive: true})
  fs.mkdirSync(output, {recursive: false})
  const logs = path.join(output, 'raw')
  fs.mkdirSync(logs)
  const workRoot = path.join(root, 'research/.work')
  fs.mkdirSync(workRoot, {recursive: true})
  const lock = path.join(workRoot, 'evaluation.lock')
  fs.mkdirSync(lock)
  let work
  const evidence = {base, candidate, oracle, evaluatorCommit: resolve('HEAD'), changes,
    holdout, start: new Date().toISOString(), output, status: 'running', measurements: []}
  try {
    work = fs.mkdtempSync(path.join(workRoot, 'snapshot-'))
    const identity = fingerprint()
    evidence.identity = identity
    save(path.join(output, 'run.json'), evidence)
    console.log(JSON.stringify({event: 'start', base, candidate, output}))
    const oracleRoot = await snapshot(oracle, path.join(work, 'oracle'), logs)
    const baseRoot = await snapshot(base, path.join(work, 'base'), logs)
    const candidateRoot = candidate === base ? baseRoot : await snapshot(candidate, path.join(work, 'candidate'), logs)
    for (const name of ['index', 'causal-graph']) {
      const file = `dist/src/${name}.d.ts`
      if (!fs.readFileSync(path.join(baseRoot, file)).equals(fs.readFileSync(path.join(candidateRoot, file)))) {
        throw Error(`Public TypeScript declaration changed: ${file}`)
      }
    }
    // Frozen upstream tests execute from each snapshot. Their own exit is retained.
    for (const [name, directory] of [['base', baseRoot], ['candidate', candidateRoot]]) {
      if (name === 'candidate' && candidate === base) continue
      for (const test of ['test', 'fuzzer']) {
        await command(process.execPath, [`dist/test/${test}.js`], {cwd: directory, log: path.join(logs, `${name}-${test}`)})
      }
    }
    for (const [name, directory] of [['base', baseRoot], ['candidate', candidateRoot]]) {
      if (name === 'candidate' && candidate === base) continue
      const out = await command(process.execPath, [path.join(root, 'research/check.mjs'), directory, oracleRoot, ...(holdout ? ['--holdout'] : [])],
        {log: path.join(logs, `${name}-differential`)})
      evidence[`${name}Correctness`] = JSON.parse(out)
      if (evidence[`${name}Correctness`].status !== 'pass') throw Error(`${name} correctness not passed`)
    }
    console.log(JSON.stringify({event: 'correctness-pass'}))
    if (workloadNames.length === 0 || new Set(workloadNames).size !== workloadNames.length) throw Error('Invalid workload selection')
    for (const name of workloadNames) {
      const result = {name, base: [], candidate: []}
      for (let round = 0; round < policy.rounds; round++) {
        const order = round % 2 ? ['candidate', 'base'] : ['base', 'candidate']
        for (const side of order) {
          const out = await command(process.execPath, ['--expose-gc', path.join(root, 'research/bench-worker.mjs'),
            side === 'base' ? baseRoot : candidateRoot, oracleRoot, name, String(policy.repeats)],
            {log: path.join(logs, `${name}-${round}-${side}`)})
          const measured = JSON.parse(out)
          if (measured.name !== name || measured.timesMs?.length !== policy.repeats ||
              measured.timesMs.some(ms => !Number.isFinite(ms) || ms <= 0) || !(measured.peakRssBytes > 0)) throw Error('Invalid worker output')
          result[side].push(measured)
        }
      }
      evidence.measurements.push(result)
      save(path.join(output, `workload-${name}.json`), result)
      console.log(JSON.stringify({event: 'workload-done', name}))
    }
    if (JSON.stringify(identity) !== JSON.stringify(fingerprint())) throw Error('Evaluator/toolchain changed during run')
    const decision = decide(evidence.measurements)
    Object.assign(evidence, {status: 'complete', end: new Date().toISOString(), decision})
    save(path.join(output, 'run.json'), evidence)
    console.log(JSON.stringify({event: 'complete', ...decision, output}))
    return evidence
  } catch (error) {
    Object.assign(evidence, {status: 'failed', end: new Date().toISOString(), error: error.message})
    save(path.join(output, 'run.json'), evidence)
    throw error
  } finally {
    if (work) fs.rmSync(work, {recursive: true, force: true})
    fs.rmdirSync(lock)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, candidate, ...options] = process.argv.slice(2)
  if (!base || !candidate || options.some(x => x !== '--holdout')) throw Error('Usage: node research/evaluate.mjs BASE CANDIDATE [--holdout]')
  await evaluate(base, candidate, {holdout: options.includes('--holdout')})
}
