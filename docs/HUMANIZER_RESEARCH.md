# Humanizer research notes used for AuthentiWrite v2.5

AuthentiWrite v2.5 was redesigned after reviewing open-source humanizer projects and comparing their engineering patterns with the previous Naturalize pipeline.

## Repositories reviewed

1. `blader/humanizer` (MIT)
   - Pattern-first editing rather than synonym swapping.
   - Detects many recurring AI-writing tells: staged introductions, "not X but Y", forced triads, repeated openings, stock AI vocabulary, inflated significance, decorative formatting, chatbot residue and over-explaining.
   - Uses a rewrite -> critique -> final rewrite workflow.
   - Supports matching a writer-provided voice sample.
   - Treats names, dates, numbers, quotes, citations and facts as source-locked details.

2. `epoko77-ai/im-not-ai` (MIT)
   - Separates deterministic diagnosis from model rewriting.
   - Uses severity-based pattern detection and genre/register preservation.
   - Treats meaning as immutable and discourages edits where no problem is detected.
   - Uses change-rate/over-editing guardrails and source verification.
   - Routes already-good text conservatively rather than forcing a large rewrite.

## Principles adapted into AuthentiWrite

- Rewriting quality is judged by reader-facing prose quality, not by lowering an AI detector score.
- A deterministic pre-scan identifies likely formulaic patterns before generation.
- Multiple rewrite strategies are generated and ranked.
- The best draft receives an explicit editorial critique and a final polish pass.
- Names, numbers, dates, URLs, direct quotes, citations, acronyms and proper-noun sequences are extracted as protected anchors.
- Candidate drafts that lose protected anchors are rejected.
- A semantic preservation check runs after rewriting, with a repair pass when needed.
- An optional genuine writing sample can guide rhythm, punctuation and diction without importing facts from that sample.
- Naturalize never invents facts, anecdotes or unrelated topic changes. Optional Subtle variation may add one tightly constrained capitalization or punctuation inconsistency after the meaning check; random typos are still prohibited.

## Compare / text-analysis changes

- Replaced naive `(?<=[.!?])\\s+` sentence splitting with abbreviation-protection and terminal-punctuation parsing that keeps closing quotes/brackets attached to the sentence.
- Added protection for titles and abbreviations (`Mr.`, `Dr.`, `e.g.`, `i.e.`), initials, decimals, URLs and email addresses.
- Added a visible parsed-sentence preview so sentence-count mistakes are inspectable.
- Added warnings below about 10 sentences and below 100 words.
- Replaced reliance on one lexical metric with both MATTR (50-word moving window) and MTLD.
- Expanded formal-connector detection to include multi-word discourse markers and counts longest-first to avoid overlap.
- Added a broad project reference profile for interpretation; it is deliberately not described as a universal human-vs-AI boundary.

## Important limitation

No detector can prove authorship. Human and AI writing distributions overlap, and editing changes detector behavior. AuthentiWrite exposes evidence and uncertainty rather than presenting a score as proof.


## Controlled roughness

The v2.6 Naturalize pipeline can optionally introduce a very small amount of surface roughness after semantic repair. The implementation deliberately avoids random typos and unrelated topic jumps. It permits only low-impact source-grounded continuity shifts and, on sufficiently long passages, a single safe capitalization or punctuation inconsistency. Protected source anchors are checked again after this pass; any variation that damages them is discarded.
