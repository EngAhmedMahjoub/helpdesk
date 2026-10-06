import { PgBoss } from 'pg-boss'
import { env } from '../env.ts'

/**
 * The background job queue: pg-boss, in the API process itself, since Render's
 * free plan runs web services only, with no room for a separate worker. Its tables
 * live in their own `pgboss` schema in the same database, which it creates on
 * start; Prisma migrates `public` only, so the two never touch.
 *
 * Verified on Bun 1.4.2 with pg-boss 12.34: a job sent, picked up and worked,
 * with Prisma's `?schema=public` left on the connection string.
 */
export function createBoss(connectionString: string = env.DATABASE_URL): PgBoss {
  const boss = new PgBoss({
    connectionString,
    // Its own small pool beside Prisma's: the jobs run one at a time on a
    // 0.1 vCPU instance, and Neon's free tier has few connections to spare.
    max: 3,
    // Tells its connections apart from Prisma's in pg_stat_activity.
    application_name: 'helpdesk-jobs',
  })
  // pg-boss emits errors from its own polling and maintenance rather than
  // throwing them; an EventEmitter with no 'error' listener would crash the
  // process on the first one. The message only: the error can carry the query.
  boss.on('error', (err: Error) => console.error(`pg-boss error: ${err.message}`))
  return boss
}
