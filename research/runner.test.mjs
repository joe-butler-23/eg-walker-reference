import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {command} from './evaluate.mjs'

test('runner preserves nonzero exit and partial output; deadline cannot become success', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egw-runner-test-'))
  try {
    const failed = path.join(dir, 'failed')
    await assert.rejects(command(process.execPath, ['-e', 'console.log("partial"); process.exit(7)'], {log: failed}), /exited 7/)
    assert.equal(JSON.parse(fs.readFileSync(failed + '.json')).exitCode, 7)
    assert.match(fs.readFileSync(failed + '.stdout', 'utf8'), /partial/)
    const expired = path.join(dir, 'expired')
    await assert.rejects(command(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {log: expired, deadlineMs: 100}), /deadline/)
    const record = JSON.parse(fs.readFileSync(expired + '.json'))
    assert.equal(record.expired, true)
    assert.notEqual(record.exitCode, 0)
  } finally { fs.rmSync(dir, {recursive: true, force: true}) }
})
