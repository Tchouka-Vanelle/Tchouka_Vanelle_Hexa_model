import type { LLMPort } from '../../domain/ports/index.js'

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'nomic-embed-text'

export const ollamaLLMAdapter: LLMPort = {
  async getEmbedding(text: string) {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: text })
    })
    if (!res.ok) throw new Error(`Ollama embeddings error: ${res.status}`)
    const data = await res.json()
    return data.embeddings[0]
  }
}
