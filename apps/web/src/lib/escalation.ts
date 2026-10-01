import type { EscalationReason } from '@helpdesk/shared'

/**
 * Why a ticket is waiting for an agent, in words. One list for the ticket page
 * and the ticket list, so the two never name the same reason differently.
 */
export const escalationReasonLabels: Record<EscalationReason, string> = {
  refund_approval: 'refund approval',
  ai_failed: 'AI could not answer',
  unverified_sender: 'sender not verified',
  auto_reply_limit: 'AI reply limit reached',
  agent_assigned: 'assigned agent to reply',
}
