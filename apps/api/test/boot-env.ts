/**
 * An environment src/env.ts accepts, less NODE_ENV, for the tests that boot the
 * API in a child process. One list, so a variable that becomes required is added
 * here once; env.test.ts's "accepts a complete environment" proves it still
 * boots. None of it is a real credential.
 */
export const VALID_BOOT_ENV = {
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
  WEB_ORIGIN: 'https://app.example.com',
  RESEND_API_KEY: 're_test_not_a_real_key',
  EMAIL_FROM: 'Helpdesk Support <support@helpdesk.example.com>',
  RESEND_WEBHOOK_SECRET: 'whsec_dGVzdA==',
}
