import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { healthRoute } from './routes/health.js'
import { chatRoute } from './routes/chat.js'
import { conversationsRoute } from './routes/conversations.js'
import { agentRoute } from './routes/agent.js'
import { ragRoute } from './routes/rag.js'
import dbPlugin from './adapters/db/db.js'

export async function buildApp(opts = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined
    },
    ...opts
  })

  // ── Plugins globaux ───────────────────────────────────────────────────────
  await app.register(sensible)  // reply.notFound(), reply.badRequest(), etc.
  await app.register(dbPlugin)  // app.db, app.stmts

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(healthRoute)
  await app.register(chatRoute)
  await app.register(conversationsRoute)
  await app.register(agentRoute)
  await app.register(ragRoute)

  return app
}
