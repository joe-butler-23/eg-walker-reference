# First speed pilot — 2026-10-22

Baseline `80e521c40fcb65d7f294828473812e072e774bff`; measured winner `7761ec37c7a43bceee74d5e68bb62561c433f84e`. The landed source is identical to that winner. Upstream reference is unchanged at `7287f4bc2c054984838b3582a27b4fea8f6d8161`.

Two source changes survive: reuse the final insertion cursor for immediately adjacent inserts within one causal run, and skip reconstruction when an incremental merge adds no operations. Neither changes the public TypeScript declarations. The equal-frontier graph shortcut was discarded. The cursor-only candidate was also discarded under the unchanged no-regression policy; the combined change passed against the accepted merge shortcut and then against the original baseline.

## Final paired results

Node 26.12.0; TypeScript 4.9.5; AMD Ryzen 7 5825U; Minworker. Three paired fresh-process rounds, two warmups and three samples per side. Medians below are fixed-work elapsed time, with input setup/GC outside the timed boundary.

| Workload | Original ms | Winner ms | Speedup | Peak RSS ratio |
| --- | ---: | ---: | ---: | ---: |
| ff-full | 412.584 | 119.417 | 3.45× | 1.011 |
| git-prefix | 535.032 | 308.376 | 1.73× | 1.009 |
| node-prefix | 435.241 | 180.241 | 2.41× | 1.022 |
| append | 41.119 | 1.969 | 20.89× | 1.011 |
| middle-edits | 8.693 | 7.363 | 1.18× | 1.006 |
| deletion-heavy | 13.452 | 7.910 | 1.70× | 1.003 |
| concurrent-inserts | 5.664 | 4.299 | 1.32× | 0.991 |
| incremental-merge | 33.313 | 15.374 | 2.17× | 1.003 |
| redundant-merge | 30.152 | 0.087 | 346.80× | 0.811 |

All workload medians improved. Corpus geometric mean is 4.39×, but the very large redundant-merge gain contributes strongly: this is not a universal application speedup. Prefix results are not full-trace speedups. Short sub-millisecond timings are especially sensitive to noise. RSS is whole-process lifetime peak including runtime, oracle, warmups and setup; post-run heap samples are not allocation peaks.

## Correctness and limits

- Existing 1,000 conformance cases and 100 fuzz seeds pass unchanged.
- 5,294 development differential checks and 7,886 separate holdout checks pass, including generic payloads, Unicode tokens, graph diffs, ordering/idempotence, branch versions and merge permutations.
- Original and winner generated public declarations are byte-identical.
- Full Firefox (26,078 ops) and Git Makefile (348,819 ops) outputs match stored expected text. Full Node (947,337 ops) exceeded the 180-second total validation budget and remains unresolved. Its measured prefix has 30,514 ops / 2 transactions.
- The unchanged-code self-comparison was rejected. A nominal 2.6% geometric gain did not repeat across rounds. Acceptance thresholds were not weakened for candidates.
- The host is shared and thermal/CPU activity is not fully isolated. This is repeatable local evidence, not a cross-machine claim or formal correctness proof.

## Reproducible evidence

`evidence/pilot-2026-10-22.json` contains exact identities, environment, corpus hashes, samples and decisions. `evidence/pilot-2026-10-22.tar.gz` preserves the six complete evaluator runs and their raw child outputs/own exits. It excludes model prompts and transcripts. `evidence/full-traces-2026-10-22.json` records the partial full-trace check and its nonzero timeout exit honestly.

Archive SHA-256: `5108c0278663160fb98c39b217d22550e4ac938658b294b0050fed1a28d1e2ac`.

Run contracts, thresholds and bounded campaign commands: [README.md](README.md). A native model draft gate is only draft completion; frozen evaluator correctness and performance remain the acceptance authority.
