export type HealthResponse = {
  status: 'ok' | 'error'
  database: 'up' | 'down'
  timestamp: string
}
