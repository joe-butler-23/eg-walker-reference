# Eg-walker speed research

This fork optimises CPU time and memory, preserving the public TypeScript API and upstream sequence/merge semantics. Upstream reference: `7287f4bc2c054984838b3582a27b4fea8f6d8161`. Nothing is pushed upstream. The model proposes changes; the fixed evaluator alone decides admission. A speed result is not a proof of complete CRDT correctness.

## Run

Use Node **26.12.0**, npm **11.20.0**, and the committed lockfile (TypeScript **4.9.5**). These are the first pilot's measured environment, not a claim of cross-runtime parity.

```sh
npm ci --ignore-scripts
agent-heavy npm test
node --test research/policy.test.mjs research/runner.test.mjs
# Both revisions must exist locally. Candidate differences must be src-only.
agent-heavy node research/evaluate.mjs BASE_COMMIT CANDIDATE_COMMIT
# First measure unchanged code against itself to assess the harness/noise.
agent-heavy node research/evaluate.mjs HEAD HEAD
# Repeat with unseen random seeds before landing a winner.
agent-heavy node research/evaluate.mjs BASE_COMMIT CANDIDATE_COMMIT --holdout
```

The evaluator requires committed inputs, snapshots each exact revision with `git archive`, and compiles all sources with the same installed locked dependencies. It runs the original test programs, differential/generated checks against the immutable oracle, and every benchmark. It records actual child exits, raw stdout/stderr, source identities, evaluator/dependency hashes, hardware, runtime and per-workload samples in `research/runs/`. Completed records use atomic rename. No cached evidence is reused. It serializes local evaluators; `agent-heavy` provides shared-host heavy-work admission. Other host activity/thermal conditions can still affect results.

A stopped process can leave `research/.work/evaluation.lock` or `campaign.lock`. Check that its owning process has exited before removing that exact stale lock. Incomplete runs are never admissible; rerun rather than resume partial evidence.

## Fixed pilot contract

`research/policy.mjs` is the single acceptance authority:

- Three paired rounds, each in fresh baseline/candidate processes, alternating which runs first.
- Two warmups and three timed iterations per process. Every iteration starts with fresh input; setup and GC are outside the timer. Workload completion is the timed boundary, not a fixed training-time score.
- At least **3% geometric-mean speedup** over the incumbent, with an aggregate gain in every paired round.
- No individual workload median slower by more than **5%**.
- No individual workload whole-process peak RSS greater than **1.20×** the incumbent. RSS includes runtime/setup/oracle overhead; post-run heap samples are not peak allocation measurements.
- Correctness always precedes timing. Any failure or incomplete evidence rejects a candidate. A **180-second per-command safety deadline** bounds frozen evaluator subprocesses, not an inferred readiness wait. Crash and timeout are statuses, never numeric winning scores.

These are initial experiment-policy choices, not guarantees of statistical significance. Borderline/noisy results are discarded rather than repeatedly retried until favourable. Do not weaken this contract to accept an experiment. Equal-score cleanup may be reviewed separately, but is not an automatic speed win.

The fixed corpus combines full `ff-raw.json`, explicit whole-transaction prefixes from the Git Makefile and Node traces capped at **32,000 operations**, plus synthetic append, middle insert/delete, deletion-heavy, concurrent insert, incremental merge and redundant-merge workloads. The original 30,000-op pilot cap would have excluded Node's first transaction (30,126 ops), so it was calibrated to 32,000 before any candidate existed. Trace prefixes are NOT full-trace validation. Workload names, sizes and constructors live only in `workloads.mjs`; expected outputs come from the immutable reference. Full bundled conformance and upstream 100 fuzz seeds remain unchanged, with additional and holdout differential seeds.

## Bounded autonomous campaigns

```sh
# Explicit finite experiment count, 1..20. Start with 3.
node research/campaign.mjs 3 HEAD
```

Requires the already-authenticated `prime-agent` CLI; no provider account or paid compute is created. It explicitly uses `openai-codex/gpt-6.1-sol` with high reasoning, so this consumes that account's quota. The explicit model was smoke-tested; the unpinned CLI selected an unsupported model during setup. Each proposal is limited to **200,000 cumulative tokens, 30 turns, 10 minutes**, with one continuation and a 30-second CLI-exit safety margin. The native proposal gate checks only that a source diff exists and passes whitespace validation; it does not certify correctness or speed. The model runtime counts repeated input context, not only generated output: the initial 80,000-token proposal smoke exceeded that budget after producing a patch, so the supervisor correctly rejected it and its proposal budget was calibrated to 200,000. Evaluator acceptance thresholds did not change. Evaluation has a separate one-hour safety bound (including admission wait); the outer proposal loop cannot run forever.

Do not edit the evaluator, result Markdown or dependencies while a campaign evaluates: fingerprint changes invalidate its evidence. Each proposal starts from the current best in a disposable worktree. Only `src/index.ts` and `src/causal-graph.ts` may change. The supervisor checks scope, commits the candidate, evaluates through `agent-heavy`, and records keep/discard/failure. It never resets your checkout, edits tests to pass, pushes, or auto-merges. Every new campaign uses fresh branches; successful candidates advance `research/best-<campaign-id>`. Inspect results and fast-forward/cherry-pick deliberately. No improvement is promised.

The scope boundary catches ordinary accidental evaluator edits; this is not a sandbox for a hostile model. Candidate code has normal local process privileges. Run on a dedicated machine for stronger performance isolation, and use an OS sandbox for untrusted code.

Current measured results and known limits: [RESULTS.md](RESULTS.md). The first deletion-first campaign completed three unattended propose/commit/evaluate/discard cycles with intact evidence and stable evaluator fingerprints. None met every performance gate; the incumbent source is unchanged. No background campaign is running.
