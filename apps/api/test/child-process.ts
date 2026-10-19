import { VALID_BOOT_ENV } from './boot-env.ts'

/**
 * Runs `source` in a fresh Bun process under `nodeEnv`, for the tests whose
 * subject is wired once at import, from an env.ts that validates once — neither
 * can be re-evaluated inside the runner. Each caller parses the output itself.
 */
export async function runUnder(
  nodeEnv: string,
  source: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // --no-env-file: inside apps/api Bun would otherwise load its .env files, and
  // fill anything missing from the list below with the developer's own values,
  // real keys included. The child sees exactly this environment and no other.
  const proc = Bun.spawn(['bun', '--no-env-file', '-e', source], {
    // Inside apps/api so express resolves.
    cwd: `${import.meta.dir}/..`,
    env: { PATH: process.env.PATH ?? '', ...VALID_BOOT_ENV, NODE_ENV: nodeEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}
