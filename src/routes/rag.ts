import { retrieve } from '../domain/services/rag/retriever.js'
import { indexDocs } from '../domain/services/rag/indexer.js'

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const MODEL = process.env.OLLAMA_MODEL ?? 'tinyllama'

const RAG_SYSTEM_PROMPT = `Tu es un assistant qui répond UNIQUEMENT à partir du contexte ci-dessous.
Si le contexte ne contient pas la réponse, réponds exactement : "Je ne trouve pas l'information dans mes documents."
Cite tes sources entre crochets, format [fichier.md§section].`

import type { FastifyRequest, FastifyReply } from 'fastify'

/** @param {import('fastify').FastifyInstance} app */
export async function ragRoute(app: any) {
  // POST /rag/reindex — relance l'indexation complète
  app.post('/rag/reindex', async (request: FastifyRequest, reply: FastifyReply) => {
    request.log.info('RAG: réindexation manuelle déclenchée')
    // use ports if available, otherwise fallback to legacy
    if (app.ports && app.ports.db) {
      const { fsDocumentAdapter } = await import('../adapters/document/fs-document.js')
      const { ollamaLLMAdapter } = await import('../adapters/llm/ollama-llm.js')
      const { files, chunks } = await indexDocs({ db: app.ports.db, docs: fsDocumentAdapter, llm: ollamaLLMAdapter })
      return { indexed: true, files, chunks }
    }
  // legacy fallback: build lightweight ports from app.db/stmts
  const legacyDocs = { listFiles: async () => [], readFile: async (_: string) => '' }
  const legacyLLM = { getEmbedding: async (_: string) => [] }
  const { files, chunks } = await indexDocs({ db: { insertChunk: async (...a: any[]) => app.stmts.insertChunk.run(...a), getAllChunks: async () => app.stmts.getAllChunks.all(), countChunks: async () => app.stmts.countChunks.get().count }, docs: legacyDocs, llm: legacyLLM })
    return { indexed: true, files, chunks }
  })

  // POST /rag/search — recherche les K chunks les plus pertinents
  app.post('/rag/search', {
    schema: {
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1 },
          k: { type: 'integer', minimum: 1, maximum: 10, default: 4 }
        },
        additionalProperties: false
      }
    }
  }, async (request: FastifyRequest) => {
    const { query, k = 4 } = request.body as any
    // prefer ports
    if (app.ports && app.ports.db && app.ports.llm) {
      const results = await retrieve(app.ports.llm.getEmbedding.bind(app.ports.llm), app.ports.db, query, k)
      return results.map(r => ({
        source: r.source,
        section: r.section,
        content: r.content,
        similarity: Math.round(r.similarity * 1000) / 1000
      }))
    }
    const results = await retrieve(async (t: string) => {
      const res = await fetch(`${OLLAMA_URL}/api/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.EMBED_MODEL ?? 'nomic-embed-text', input: t }) })
      const data = await res.json()
      return data.embeddings[0]
    }, app.stmts, query, k)
    return results.map(r => ({
      source: r.source,
      section: r.section,
      content: r.content,
      similarity: Math.round(r.similarity * 1000) / 1000
    }))
  })

  // POST /chat/rag — chat qui utilise le RAG + SSE
  app.post('/chat/rag', {
    schema: {
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
    const { message } = request.body as any

    // 1. Retrieve — cherche les chunks pertinents
    let chunks
    if (app.ports && app.ports.db && app.ports.llm) {
      chunks = await retrieve(app.ports.llm.getEmbedding.bind(app.ports.llm), app.ports.db, message)
    } else {
      // fallback: call Ollama embed endpoint directly
      chunks = await retrieve(async (t: string) => {
        const res = await fetch(`${OLLAMA_URL}/api/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.EMBED_MODEL ?? 'nomic-embed-text', input: t }) })
        const data = await res.json()
        return data.embeddings[0]
      }, { getAllChunks: () => app.stmts.getAllChunks.all() }, message)
    }

    if (chunks.length === 0) {
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' })
      reply.raw.write(`data: ${JSON.stringify({ type: 'token', value: 'Je ne trouve pas l\'information dans mes documents.' })}\n\n`)
      reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      reply.raw.end()
      return
    }

    // 2. Construit le contexte injecté dans le prompt système
    const contextBlock = chunks.map(c =>
      `[${c.source}§${c.section}]\n${c.content}`
    ).join('\n\n---\n\n')

    const systemMessage = `${RAG_SYSTEM_PROMPT}\n\nContexte :\n${contextBlock}`

    // 3. Generate — appelle le LLM avec le contexte
    const controller = new AbortController()
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: message }
        ],
        stream: true
      })
    })

    if (!res.ok) {
      const text = await res.text()
      request.log.error({ status: res.status, body: text }, 'Ollama error')
      return reply.status(502).send({ error: 'Ollama request failed' })
    }

    request.socket.once('close', () => controller.abort())

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

  const sendEvent = (payload: unknown) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)

    // Envoie d'abord les sources utilisées
    sendEvent({ type: 'sources', sources: chunks.map(c => ({ source: c.source, section: c.section, similarity: Math.round(c.similarity * 1000) / 1000 })) })

    try {
      if (res.body) for await (const chunk of res.body) {
        const lines = Buffer.from(chunk).toString('utf8').split('\n').filter(Boolean)
        for (const line of lines) {
          const parsed = JSON.parse(line)
          if (parsed.message?.content) {
            sendEvent({ type: 'token', value: parsed.message.content })
          }
          if (parsed.done) sendEvent({ type: 'done' })
        }
      }
    } catch (err) {
      const isAbort = (err as any)?.name === 'AbortError'
      if (!isAbort) {
        request.log.error(err as Error, 'RAG streaming error')
        const message = err instanceof Error ? err.message : String(err)
        sendEvent({ type: 'error', message })
      }
    } finally {
      reply.raw.end()
    }
  })
}
