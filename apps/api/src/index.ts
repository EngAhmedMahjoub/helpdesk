import { createApp } from './app.ts'
import { env } from './env.ts'

createApp().listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`)
})
