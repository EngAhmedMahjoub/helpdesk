import Anthropic from '@anthropic-ai/sdk'
import { AI_EFFORT, AI_MODEL, anthropic } from '../src/ai/client.ts'

/**
 * One real call to Anthropic, to prove the key and the model id work before a
 * job depends on them. Run it by hand — `bun run ai:ping` — never from a test:
 * it costs money and needs the network, which is why nothing in `bun test`
 * reaches the API.
 */
const started = Date.now()

try {
  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    output_config: { effort: AI_EFFORT },
    system: 'Answer in one short sentence.',
    messages: [{ role: 'user', content: 'Reply with: the helpdesk can reach Claude.' }],
  })

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')

  console.log(`model:  ${response.model}`)
  console.log(`stop:   ${response.stop_reason ?? 'none'}`)
  console.log(
    `tokens: ${String(response.usage.input_tokens)} in, ${String(response.usage.output_tokens)} out`,
  )
  console.log(`took:   ${String(Date.now() - started)}ms`)
  console.log(`reply:  ${text.trim()}`)
} catch (error) {
  // The typed classes, so the message says which wall was hit rather than
  // leaving whoever ran this to guess from a stack trace.
  if (error instanceof Anthropic.AuthenticationError) {
    console.error('Anthropic refused the key. Check ANTHROPIC_API_KEY in apps/api/.env.')
  } else if (error instanceof Anthropic.RateLimitError) {
    console.error('Rate limited. Wait and run it again.')
  } else if (error instanceof Anthropic.APIError) {
    console.error(`Anthropic answered ${String(error.status)}: ${error.message}`)
  } else {
    console.error(error)
  }
  process.exit(1)
}
