import { anthropic } from './ai/client.ts'
import { loadKnowledgeBase } from './ai/knowledge-base.ts'
import { createApp } from './app.ts'
import { prisma } from './db.ts'
import { sendEmail } from './email/outbound.ts'
import { env } from './env.ts'
import { createBoss } from './jobs/boss.ts'
import {
  PROCESS_TICKET,
  createQueues,
  processTicketQueue,
  processTicketWorker,
} from './jobs/process-ticket.ts'

// Jobs start before the API listens: an API that took requests while its queue
// was down would accept work it could not do. If the database is unreachable,
// start() throws and the process exits, as it would on the first query anyway.
const boss = createBoss()
await boss.start()
await createQueues(boss)
// Loaded once, before any job runs: the loader throws on an empty folder or a
// malformed article, and an API that started without its knowledge base would
// answer every ticket without it.
const knowledgeBase = await loadKnowledgeBase()
await boss.work(
  PROCESS_TICKET,
  processTicketWorker({ prisma, client: anthropic, knowledgeBase, sendEmail }),
)
console.log('Background jobs started')

const server = createApp({ queueProcessTicket: processTicketQueue(boss) }).listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`)
})

// Koyeb stops an instance with SIGTERM. Stop taking requests, then let a job
// already running finish, within the timeout, rather than cut it off mid-way.
async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`)
  server.close()
  await boss.stop({ graceful: true, timeout: 10_000 })
  process.exit(0)
}
process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))
