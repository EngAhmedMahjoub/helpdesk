import { type PgBoss, type PrismaTransactionLike, fromPrisma } from 'pg-boss'

/** The queue a saved inbound message waits on for the AI (task 5.2). */
export const PROCESS_TICKET = 'process-ticket'

/** Which message to act on, and the ticket it belongs to. Ids only: the job reads the rest fresh. */
export type ProcessTicketJob = { ticketId: number; messageId: number }

/**
 * Queues a process-ticket job inside the transaction `tx` that saves the
 * message, so the two commit or roll back together.
 */
export type QueueProcessTicket = (job: ProcessTicketJob, tx: PrismaTransactionLike) => Promise<void>

export function processTicketQueue(boss: PgBoss): QueueProcessTicket {
  return async (job, tx) => {
    // Sent through the caller's transaction, not pg-boss's own pool. Queued
    // separately, a failure between saving and queuing would leave a message
    // no job ever picks up: the webhook's 500 would have Resend redeliver, and
    // the redelivery would be dropped as a duplicate of the saved message.
    await boss.send(PROCESS_TICKET, job, { db: fromPrisma(tx) })
  }
}

/** The queues the API sends to, created on start; creating one that exists is a no-op. */
export async function createQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(PROCESS_TICKET)
}
