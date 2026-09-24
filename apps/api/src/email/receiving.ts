import type { Resend } from 'resend'
import type { ReceivedEmail } from './inbound.ts'
import { resend } from './resend.ts'

/** Reads a received email's body and headers, which the webhook event leaves out. */
export type FetchReceivedEmail = (emailId: string) => Promise<ReceivedEmail>

export class EmailFetchError extends Error {
  override name = 'EmailFetchError'
}

/** The part of the Resend client this module uses, so tests can pass a fake. */
export type ReceivingClient = Pick<Resend, 'emails'>

export function createReceivedEmailFetcher(client: ReceivingClient): FetchReceivedEmail {
  return async function fetchReceivedEmail(emailId) {
    const { data, error } = await client.emails.receiving.get(emailId)

    // Like sending, the SDK reports failure in the result rather than by
    // throwing, network failures included. Needs a Full access key: a
    // sending-only one answers restricted_api_key.
    if (error || !data) {
      throw new EmailFetchError(
        `Resend did not return the email: ${error?.name ?? 'no response'}`,
        {
          cause: error,
        },
      )
    }
    return data
  }
}

export const fetchReceivedEmail = createReceivedEmailFetcher(resend)
