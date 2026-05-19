const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2'

const chatBodySchema = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { type: 'string', minLength: 1, maxLength: 4096 }
  },
  additionalProperties: false
}

import type { FastifyRequest, FastifyReply } from 'fastify'

/** @param {import('fastify').FastifyInstance} app */
export async function chatRoute(app: any) {
  // ── Étape 1 : réponse complète ──────────────────────────────────────────
  app.post('/chat', {
    schema: {
      body: chatBodySchema,
      response: {
        200: {
          type: 'object',
          properties: { response: { type: 'string' } }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { message } = request.body as any

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: message }],
        stream: false
      })
    })

    if (!res.ok) {
      const text = await res.text()
      request.log.error({ status: res.status, body: text }, 'Ollama error')
      return reply.status(502).send({ error: 'Ollama request failed' })
    }

    const data = await res.json()
    return { response: data.message.content }
  })

  // ── Étape 2 : streaming SSE ─────────────────────────────────────────────
  app.post('/chat/stream', {
    schema: { body: chatBodySchema }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { message } = request.body as any
    const controller = new AbortController()

    // Premier appel Ollama pour obtenir la réponse streaming
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: message }],
        stream: true
      })
    })

    if (!res.ok) {
      const text = await res.text()
      request.log.error({ status: res.status, body: text }, 'Ollama error')
      return reply.status(502).send({ error: 'Ollama request failed' })
    }

    // ── On a la réponse streaming d'Ollama : on passe en SSE ──────────────
    // Le listener de déconnexion est posé ICI, après que Ollama a démarré,
    // pour éviter qu'il ne fire pendant le fetch initial.
    request.raw.once('close', () => {
      request.log.info('Client disconnected — aborting Ollama stream')
      controller.abort()
    })

    // Court-circuite Fastify : on écrit directement dans la socket HTTP
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'  // désactive le buffering nginx
    })

  const sendEvent = (payload: unknown) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)

    try {
      // L'API Ollama renvoie du NDJSON — une ligne JSON par token
  if (res.body) for await (const chunk of res.body) {
        const lines = Buffer.from(chunk).toString('utf8').split('\n').filter(Boolean)
        for (const line of lines) {
          const parsed = JSON.parse(line)
          if (parsed.message?.content) {
            sendEvent({ type: 'token', value: parsed.message.content })
          }
          if (parsed.done) {
            sendEvent({ type: 'done' })
          }
        }
      }
    } catch (err: unknown) {
      const isAbort = (err as any)?.name === 'AbortError'
      if (!isAbort) {
        request.log.error(err as Error, 'Streaming error')
        const message = err instanceof Error ? err.message : String(err)
        sendEvent({ type: 'error', message })
      }
      // AbortError = client parti, on ferme silencieusement
    } finally {
      reply.raw.end()
    }
  })
}
