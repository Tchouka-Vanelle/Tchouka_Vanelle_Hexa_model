const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2'

// Schémas réutilisables enregistrés sur l'instance Fastify
const messageSchema = {
  $id: 'Message',
  type: 'object',
  properties: {
    id: { type: 'integer' },
    conversationId: { type: 'integer' },
    role: { type: 'string' },
    content: { type: 'string' },
    createdAt: { type: 'string' }
  }
}

const conversationSchema = {
  $id: 'Conversation',
  type: 'object',
  properties: {
    id: { type: 'integer' },
    title: { type: 'string' },
    createdAt: { type: 'string' },
    messageCount: { type: 'integer' }
  }
}

import type { FastifyRequest, FastifyReply } from 'fastify'

/** @param {import('fastify').FastifyInstance} app */
export async function conversationsRoute(app: any) {
  // Enregistrement des schémas réutilisables ($ref)
  app.addSchema(messageSchema)
  app.addSchema(conversationSchema)

  // POST /conversations — crée une nouvelle conversation
  app.post('/conversations', {
    schema: {
      response: { 201: { $ref: 'Conversation#' } }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const conv = app.stmts.createConv.get('Nouvelle conversation')
    return reply.status(201).send(conv)
  })

  // GET /conversations — liste toutes les conversations
  app.get('/conversations', {
    schema: {
      response: { 200: { type: 'array', items: { $ref: 'Conversation#' } } }
    }
  }, async () => {
    return app.stmts.listConvs.all()
  })

  // GET /conversations/:id — détail + messages
  app.get('/conversations/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            createdAt: { type: 'string' },
            messages: { type: 'array', items: { $ref: 'Message#' } }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
  const params = request.params as any
  const conv = app.stmts.getConv.get(params.id)
  if (!conv) return reply.notFound(`Conversation ${params.id} introuvable`)
    const messages = app.stmts.getMessages.all(conv.id)
    return { ...conv, messages }
  })

  // DELETE /conversations/:id — supprime conversation et messages (CASCADE)
  app.delete('/conversations/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
  const params = request.params as any
  const result = app.stmts.deleteConv.run(params.id)
  if (result.changes === 0) return reply.notFound(`Conversation ${params.id} introuvable`)
    return reply.status(204).send()
  })

  // POST /conversations/:id/messages — message user + réponse assistant en SSE
  app.post('/conversations/:id/messages', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', minLength: 1, maxLength: 4096 }
        },
        additionalProperties: false
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
  const convId = (request.params as any).id
    const conv = app.stmts.getConv.get(convId)
    if (!conv) return reply.notFound(`Conversation ${convId} introuvable`)

  const { message } = request.body as any

    // Mise à jour du titre si c'est le premier message (tronqué à 60 chars)
    const history = app.stmts.getMessages.all(convId)
    if (history.length === 0) {
      app.db.prepare('UPDATE conversations SET title = ? WHERE id = ?')
        .run(message.slice(0, 60), convId)
    }

    // Sauvegarde du message utilisateur
    app.stmts.addMessage.get(convId, 'user', message)

    // Construction du contexte complet pour le LLM
    const updatedHistory = app.stmts.getMessages.all(convId)
  const ollamaMessages = updatedHistory.map((m: any) => ({ role: m.role, content: m.content }))

    const controller = new AbortController()
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model: MODEL, messages: ollamaMessages, stream: true })
    })

    if (!res.ok) {
      const text = await res.text()
      request.log.error({ status: res.status, body: text }, 'Ollama error')
      return reply.status(502).send({ error: 'Ollama request failed' })
    }

    request.raw.once('close', () => controller.abort())

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

  const sendEvent = (payload: unknown) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)

    let fullResponse = ''
    try {
      if (res.body) for await (const chunk of res.body) {
        const lines = Buffer.from(chunk).toString('utf8').split('\n').filter(Boolean)
        for (const line of lines) {
          const parsed = JSON.parse(line)
          if (parsed.message?.content) {
            fullResponse += parsed.message.content
            sendEvent({ type: 'token', value: parsed.message.content })
          }
          if (parsed.done) {
            // Persiste la réponse complète de l'assistant
            app.stmts.addMessage.get(convId, 'assistant', fullResponse)
            sendEvent({ type: 'done' })
          }
        }
      }
    } catch (err) {
      const isAbort = (err as any)?.name === 'AbortError'
      if (!isAbort) {
        request.log.error(err as Error, 'Streaming error')
        const message = err instanceof Error ? err.message : String(err)
        sendEvent({ type: 'error', message })
      }
    } finally {
      reply.raw.end()
    }
  })
}
