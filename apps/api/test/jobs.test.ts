import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { PgBoss } from 'pg-boss'
import { createBoss } from '../src/jobs/boss.ts'

// Against the real test database, like the rest of the API suite: the point is
// that pg-boss, as the API configures it, runs on Bun and on this Postgres.
let boss: PgBoss

// A fresh queue per run: pg-boss keeps its own tables in the `pgboss` schema,
// which resetDatabase leaves alone, so a fixed name would share jobs with
// earlier runs.
const queue = `test-${crypto.randomUUID()}`

beforeAll(async () => {
  boss = createBoss()
  await boss.start()
  await boss.createQueue(queue)
})

afterAll(async () => {
  await boss.deleteQueue(queue)
  await boss.stop({ graceful: true, timeout: 5_000 })
})

describe('background jobs', () => {
  // A generous timeout: pg-boss polls for work every couple of seconds.
  test('a job sent to a queue is picked up and worked, with its data', async () => {
    const worked = new Promise<unknown>((resolve) => {
      void boss.work(queue, async ([job]) => {
        resolve(job?.data)
      })
    })

    const id = await boss.send(queue, { ticketId: 42 })

    expect(id).toBeString()
    expect(await worked).toEqual({ ticketId: 42 })
  }, 15_000)
})
