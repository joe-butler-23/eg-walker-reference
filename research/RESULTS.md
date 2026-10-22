# Speed research results — 2026-10-22

Final measured candidate `cbede7cf36788092e46c24dcb054bc167c67ec36`; landed source-equivalent commit `5badb6380587eeb9ae155267c4129191cd9323e7`. Original-source control `ff523b71f5360f80c0df7b487d19c2e991905aac` has exactly the same `src/` as upstream `7287f4bc2c054984838b3582a27b4fea8f6d8161`, with matching evaluator scaffold. Upstream is unchanged.

Three small implementation changes survive: reuse the final insertion cursor for adjacent inserts within one causal run; reuse the cursor for repeated same-position deletes within that run; skip branch reconstruction when a merge adds no operations. The deletion change was proposed by the native autonomous CLI and accepted only after independent frozen evaluation. Public TypeScript declarations remain byte-identical.

## Final paired results

Node 26.12.0; TypeScript 4.9.5; AMD Ryzen 7 5825U; Minworker. Three paired fresh-process rounds, two warmups and three measured samples per side. Setup and GC are outside the fixed-work timer.

| Workload | Original ms | Winner ms | Speedup | Peak RSS ratio |
| --- | ---: | ---: | ---: | ---: |
| ff-full | 455.482 | 98.429 | 4.63× | 1.007 |
| git-prefix | 591.850 | 181.278 | 3.26× | 1.011 |
| node-prefix | 454.719 | 62.521 | 7.27× | 1.007 |
| append | 43.967 | 1.977 | 22.24× | 1.012 |
| middle-edits | 9.143 | 8.041 | 1.14× | 0.999 |
| deletion-heavy | 14.007 | 6.878 | 2.04× | 1.008 |
| concurrent-inserts | 5.559 | 4.464 | 1.25× | 1.003 |
| incremental-merge | 37.921 | 15.100 | 2.51× | 0.998 |
| redundant-merge | 30.060 | 0.089 | 339.40× | 0.805 |

All workload medians improved. Corpus geometric mean is 5.66×, influenced strongly by redundant merges; it is not a universal application speedup. The final deletion change independently passed against the first winner at 1.28× geometric mean, despite small sub-5% slowdowns on some short workloads. The shared host is not thermally/CPU isolated. Prefix results are not full-trace speedups. Sub-millisecond timings are especially noisy. RSS is whole-process lifetime peak including runtime/oracle/setup, not pure algorithm memory; sampled heap is not allocation peak.

## Correctness and rejected experiments

- Existing 1,000 conformance cases and 100 fuzz seeds pass unchanged on the landed source.
- The final candidate passes 7,886 holdout differential checks, including generic payloads, Unicode, graph diffs, idempotence, version frontiers and merge permutations. The earlier pilot also passed 5,294 development checks; these are not counted as additional independent holdout evidence.
- Public generated declarations are byte-identical.
- All three full trace outputs match stored expected text on the final source: Firefox **26,078 ops**, Git Makefile **348,819 ops**, and Node **947,337 ops**. The earlier insert-only winner timed out on full Node; the final delete-cursor winner completed it within the same 180-second total budget. These are correctness runs, not paired full-trace speed measurements. Raw outputs and own exits are in `evidence/full-traces-2026-10-22.json`.
- Unchanged-code self-comparison was rejected (apparent 2.6% gain did not repeat). The equal-frontier shortcut was discarded. Cursor-only was discarded for a redundant-merge regression; combined cursor + no-op shortcut passed. Acceptance thresholds were never weakened.
- A deliberately wrong checkout implementation failed before any benchmark, proving semantic failures cannot buy speed.

## Deletion-first campaign

Campaign `2026-10-22T09-26-53.468Z` started from `ae622e123b3e36b96f3dc9272aabb8151a330458`, with source identical to the first pilot winner. The proposal priority changed to removing entire pieces of work; evaluator rules, workloads, tests and resource limits did not change.

| Proposal | Corpus speedup | Decision | Reason |
| --- | ---: | --- | --- |
| Delete full-history sentinel allocation/fills; grow lookup arrays on demand | 0.984× | Discard | Incremental merge slowed 19.8%; aggregate gain failed. |
| Build fresh checkout output once instead of splicing it for every edit | 1.333× | Discard | Incremental merge slowed 5.19%, redundant merge 9.24%. |
| Remove repeated insert-right-boundary lookup | 1.017× | Discard | Below 3% gain; aggregate improvement did not repeat in every paired round. |

All three passed unchanged conformance/fuzz tests, 5,294 development differential checks each, and exact generated declaration comparison. These repeat the development suite, not independent holdout evidence. No new source was retained; the prior winner's holdout and full-trace evidence remains applicable to its byte-identical source. Rejected candidates did not receive additional holdout or full-trace certification.

The second proposal removes every intermediate output-array mutation from fresh checkout: the ordered CRDT items already encode its final visible values. Independent source review supports this invariant, including generic payload identity; incremental merge must keep its existing snapshot mutation path. It is a promising deletion, not an admitted speed improvement. All seven checkout workloads improved in this measurement, including append at 4.37×, but the merge guards still reject it. Setup is outside the timer but can affect later runtime/JIT state; these data do not establish why the merge timings regressed. No rejected candidate was repeatedly rerun to seek a favourable result, and no threshold was relaxed.

## Autonomous driver status

The bounded driver has now completed a clean unattended three-proposal campaign: propose → source-only commit → frozen correctness and paired timing → discard → durable campaign record. All proposal, commit and evaluation subprocesses exited 0; the supervisor exited 0, with three completed evaluations, zero admitted candidates and zero failed experiments. Evaluator fingerprints were stable across all three runs. A completed discard proves orchestration, not a speed win. No campaign is left running.

Earlier failures remain historical evidence: the initial 80k cumulative token cap was exceeded, documentation changed during one measurement, and provider WebSocket/overload errors blocked later attempts. Those runs failed closed and did not advance the incumbent. The 200k model cap and all frozen acceptance rules were unchanged for this campaign.

## Evidence

`evidence/final-2026-10-22.json` contains the final identities, samples, decisions, environment, candidate generation outcomes and limitations. `evidence/final-2026-10-22.tar.gz` preserves raw outputs/own exits for the final comparison, incremental comparison and wrong-output control. Model prompts/transcripts are excluded. The earlier six-run pilot remains in `evidence/pilot-2026-10-22.*` for attribution, not as the final source result.

Final archive SHA-256: `9fbd1464dd658116fbed3408fc6e8e30c4c58903adb813ba6f9b45ef971404fa`.

`evidence/deletion-2026-10-22.json` records the completed deletion-first campaign, exact candidates, all three decisions, raw samples, unchanged evaluator identities and own exits. `evidence/deletion-2026-10-22.tar.gz` preserves verifier outputs, sanitized native command metadata, completed campaign record and source patches for the rejected candidates. Native proposal prompts/transcripts are excluded. Archive SHA-256: `45f0434f31afebeacfde9a6ebb7a090c8936a4a0b94aec2ef75eedc9f815e61c`.

Contracts and finite campaign commands: [README.md](README.md). Do not run while editing evaluator or result files. Native model draft completion is not certification: the frozen correctness/performance evaluator alone admits a candidate.
