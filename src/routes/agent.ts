import { toolDefinitions, executeTool } from '../tools/registry.js'

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2'
const MAX_ITERATIONS = 5

const agentBodySchema = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { type: 'string', minLength: 1, maxLength: 4096 }
  },
  additionalProperties: false
}

/**
 * Crée un AbortController lié à la déconnexion du client.
 * Le listener est posé sur request.socket pour éviter les faux positifs
 * liés au cycle de vie de la requête HTTP (body parsed, headers sent…).
 */
import type { FastifyRequest, FastifyReply } from 'fastify'

function makeAbortOnDisconnect(request: FastifyRequest) {
  const controller = new AbortController()
  const onClose = () => controller.abort()
  request.socket.once('close', onClose)
  const cleanup = () => request.socket.removeListener('close', onClose)
  return { controller, cleanup }
}

/** @param {import('fastify').FastifyInstance} app */
export async function agentRoute(app: any) {
  /**
   * POST /chat/agent
   * Boucle agentique : LLM → tool → LLM → ... → réponse finale (SSE)
   */
  app.post('/chat/agent', {
    schema: { body: agentBodySchema }
  }, async (request: FastifyRequest<{ Body: { message: string } }>, reply: FastifyReply) => {
    const { message } = request.body as { message: string }

    // Historique de la conversation
    const messages = [{ role: 'user', content: message }]

    // ── SSE headers ───────────────────────────────────────────────────────
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

  const sendEvent = (payload: unknown) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
    const { controller, cleanup } = makeAbortOnDisconnect(request)

    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: MODEL,
            messages,
            tools: toolDefinitions,
            stream: true
          })
        })

        if (!res.ok) {
          const text = await res.text()
          request.log.error({ status: res.status, body: text }, 'Ollama error')
          sendEvent({ type: 'error', message: 'Ollama request failed' })
          break
        }

        // Collecte de la réponse complète (texte + éventuels tool_calls)
        let assistantContent = ''
        const toolCalls = []

  if (!res.body) break
  for await (const chunk of res.body) {
          const lines = Buffer.from(chunk).toString('utf8').split('\n').filter(Boolean)
          for (const line of lines) {
            const parsed = JSON.parse(line)

            if (parsed.message?.content) {
              assistantContent += parsed.message.content
              sendEvent({ type: 'token', value: parsed.message.content })
            }

            if (parsed.message?.tool_calls?.length) {
              toolCalls.push(...parsed.message.tool_calls)
            }
          }
        }

        // Ajoute la réponse assistant à l'historique
        messages.push({
          role: 'assistant',
          content: assistantContent,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {})
        })

        // ── Pas de tool calls → réponse finale ──────────────────────────
        // Ollama met done=true même avec des tool_calls — on se base sur toolCalls.length
        if (!toolCalls.length) {
          sendEvent({ type: 'done' })
          break
        }

        // ── Exécution des tools demandés par le LLM ──────────────────────
        for (const tc of toolCalls) {
          const name = tc.function.name
          const args = tc.function.arguments

          request.log.info({ name, args }, 'Tool call')
          sendEvent({ type: 'tool_call', name, args })

          let result
          try {
            result = await executeTool(name, args)
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            result = `Erreur: ${message}`
            request.log.warn({ name, err: message }, 'Tool error')
          }

          request.log.info({ name, result }, 'Tool result')
          sendEvent({ type: 'tool_result', name, result })

          messages.push({ role: 'tool', content: String(result) })
        }
      }
    } catch (err: unknown) {
      const isAbort = (err as any)?.name === 'AbortError'
      if (!isAbort) {
        request.log.error(err as Error, 'Agent error')
        const message = err instanceof Error ? err.message : String(err)
        sendEvent({ type: 'error', message })
      }
    } finally {
      cleanup()
      reply.raw.end()
    }
  })
}
