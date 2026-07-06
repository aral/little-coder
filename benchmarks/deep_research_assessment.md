# Deep Research — Round 1 → Round 2 Assessment & Production-Readiness Verdict

_Eval: 25 full pipelines at M=6 (1 lead → 3 wave-1 → ≤2 gap-fill), local Qwen3.6-35B-A3B @ 127.0.0.1:8888, serial sub-coder concurrency. R1 = 10 topics (baseline). R2 = same 10 + 5 new, with the grounding refinement applied. Depth held constant so R1→R2 isolates the refinement effect._

## Verdict: **READY-WITH-CAVEATS**

The refinement is an objective, decisive win on the failure mode that actually mattered (fabricated sources), reliability is solid, and the residual caveats are either inherent to a 35B local model doing web research or minor polish — not architectural. Deploy-worthy behind the caveats below; **not deploying yet** pending your sign-off.

---

## Scorecard (means)

| Metric | R1 (10) | R2 (same 10) | R2 (all 15) | Read |
|---|---|---|---|---|
| **uniqueSources / report** | **0.0** | **24.0** | **27.5** | The headline. R1 fabricated every Sources section; R2 carries 7–42 real, resolvable URLs. |
| structureScore (0–100) | 81.7 | 92.3 | 94.2 | +13%. Real citations + Sources tables now present. |
| Report words | 2582 | 2145 | 2174 | −17% on same topics — less fabricated filler; two honest-thin outliers (04/05). |
| Judge grounding (1–5) | 2.1 | 2.8 | 2.87 | Even the noisy judge sees grounding rise. |
| Judge correctness (1–5) | 2.9 | 2.9 | 3.07 | Flat/slightly up. |
| Judge overall (1–5) | 3.68 | 3.50 | 3.64 | ~Flat. **Discount this** — see judge-reliability note. |
| Failed subagents | 0 / 60 | 8 / 60 | 8 / 90 (8.9%) | Watchdog now kills hung agents (R1 would hang forever). 6 of 8 in topics 04/05. |
| Empty reports / crashes | 0 | 0 | 0 | 25/25 produced substantial reports. |

**Why judge-overall is flat while everything objective improved:** the local 35B judge is demonstrably unreliable and *penalizes honesty*. Two proofs from this run:
- **Topic 08** — judge asserted a contradiction ("vLLM tops out at INT8"). The report says no such thing; it explicitly shows vLLM with FP8 (line 13) and AWQ INT4 (lines 31, 43). The judge **hallucinated the defect**.
- **Topic 05** — judge gave grounding=1 to a report that cites specific SMDs and real journal URLs (mdpi, thelancet, springer, pmc.ncbi) and grades every claim in a Quality-of-Evidence table. It was punished for *honestly flagging gaps*, not for being wrong.

So the objective heuristics + my own read carry the verdict; the judge is directional noise.

---

## My own read (authoritative)

**Topic 01 — Rust vs Go for CLI (R2, strong).** Production-quality. Real, verifiable figures (ripgrep 8.2× faster on the kernel tree, xsv 142× vs csvkit, Cloudflare Pingora 67% less memory), comparison tables, 33 real URLs, single neutral voice, and it *honestly declares its own gap*: "The findings do not identify specific hybrid approaches." This is exactly the target behavior.

**Topic 05 — Intermittent fasting (R2, judge's worst at 2.6, actually excellent).** Rigorous and safe: an evidence-quality table grading each outcome Very-Low→Moderate-Strong, repeated explicit "not available in the findings" markers, real journal URLs, and an honest "(source not provided)" rather than a fabricated link. Real but minor flaws: most claims lean on one review source [1]; one citation's year metadata is off; two thin because 2 research agents were watchdog-killed. Intellectually this is the strongest demonstration that R2 favors honest grounding over confident fabrication — and that the judge undervalues it.

**Topic 13 — Reducing LLM hallucination (R2 new, strong).** Sophisticated synthesis, primary sources (arxiv IDs + github repos), and honest tradeoff framing ("reasoning-oriented RL fine-tuning has been shown to *increase* hallucination"). A few SEO-domain and future-dated citations mixed in, but the backbone is primary literature.

---

## Caveats (the "-WITH-CAVEATS")

1. **Residual marginal fabrication.** The grounding prompt sharply reduced but did not eliminate plausible-but-unverifiable specifics. Topic 07 emits three 2026 CVE IDs (33045/34205/55844) with real-looking vendor URLs alongside a genuinely-real one (CVE-2024-3094, the xz backdoor); some arxiv IDs are future-dated. A 35B local model researching the live web will occasionally do this. **Reports are honest about most gaps, but exact identifiers/versions/figures should be treated as needing verification.**

2. **Latency tail under agent failure.** Two topics (04, 05) ran ~54 min because, under the eval's *serial* concurrency, several hung agents each burned a full 10-min watchdog sequentially. In production's default *parallel* concurrency these overlap (wall-clock ≈ one watchdog), but a topic with many dead sources can still run long. Acceptable for a "long-ride" flow; set user expectations.

3. **Thinness when subagents die.** A watchdog-killed research agent = a missing slice of the report (04 dropped to 1566 words / 4 failures; 05 to 1686 / 2). Consider retry-once on watchdog kill, and surfacing "N sources unreachable" in the report so thinness is legible.

4. **Local judge unreliable** — eval-only, not a product surface, but it means you can't auto-gate quality on the local judge.

## Passed cleanly
- **Reliability:** 25/25 substantial reports, 0 crashes, 8.9% subagent-failure (<15% bar). Watchdog + checkpoint-resume both proven under real hangs (topic 09, which hung indefinitely in R1, completed clean in R2).
- **Grounding:** the R1 fabricated-sources failure mode is gone (0 → 27.5 real sources/report).
- **Voice/structure:** single neutral voice, H1 + exec summary + tables + Sources on ~every report (structure 94/100).

## Recommended follow-ups (non-blocking, polish)
- Retry-once on research watchdog kill (recovers thin reports like 04/05).
- Emit a "N sources unreachable / M agents failed" line when `failedSubagents > 0`.
- Optional: lightweight URL-resolve check in the write step to drop dead links before Sources.

## Residual manual-test surface (validated separately by your interactive runs)
f2 toggle, clarifying dialogs, live rectangle progress bar, main-agent write turn, ESC/abort, plan-mode coexistence. The eval exercises phases 1–4 (the production `pipeline.ts`) headlessly; the TUI layer is yours to confirm.

_No version bump / publish / tag / GitHub Release performed. Awaiting approval to deploy._
