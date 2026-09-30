import { anthropic } from '../src/ai/client.ts'
import { type Score, evaluate, summarise } from '../src/ai/evaluate.ts'
import { loadKnowledgeBase } from '../src/ai/knowledge-base.ts'
import { samples } from '../eval/samples.ts'

/**
 * Scores the prompt against the evaluation set (5.18) with real calls to
 * Anthropic. By hand only — `bun run ai:eval` — since every run is billed:
 * about 28 calls, a few cents on Haiku.
 */
const percent = ({ correct, total }: Score) =>
  `${String(correct)}/${String(total)} (${total === 0 ? '-' : ((correct / total) * 100).toFixed(0)}%)`

const results = await evaluate(anthropic, await loadKnowledgeBase(), samples)

for (const result of results) {
  const mark = result.failure ? 'FAIL' : result.routed === result.expected ? 'ok  ' : 'MISS'
  const got = result.failure
    ? result.failure
    : result.model === result.routed
      ? String(result.model)
      : `${String(result.model)} -> ${String(result.routed)} (safeguard: ${result.forcedBy.join(', ')})`
  console.log(`${mark} ${result.label.padEnd(28)} expected ${result.expected.padEnd(9)} got ${got}`)
}

const summary = summarise(results)
// Haiku 4.5 at $1 / $5 per million tokens, uncached: the prompt is under its
// 4,096-token caching minimum, so every call pays full input.
const cost = (summary.usage.input * 1 + summary.usage.output * 5) / 1_000_000

console.log(`
Model's category:      ${percent(summary.model)}
After the safeguard:   ${percent(summary.routed)}
  general              ${percent(summary.byCategory.general)}
  technical            ${percent(summary.byCategory.technical)}
  refund               ${percent(summary.byCategory.refund)}
Safeguard overrode:    ${String(summary.forced)}
Failed calls:          ${String(summary.failed)}
Tokens:                ${String(summary.usage.input)} in, ${String(summary.usage.output)} out, about $${cost.toFixed(4)}`)
