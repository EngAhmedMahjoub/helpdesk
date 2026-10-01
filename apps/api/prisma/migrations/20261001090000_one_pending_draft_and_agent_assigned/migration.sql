-- AlterEnum
ALTER TYPE "EscalationReason" ADD VALUE 'agent_assigned';

-- CreateIndex
CREATE UNIQUE INDEX "ReplyDraft_one_pending_per_ticket" ON "ReplyDraft"("ticketId") WHERE (status = 'pending');

