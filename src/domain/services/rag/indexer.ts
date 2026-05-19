import { chunkMarkdown } from './chunker.js'
// Minimal inline port types to avoid cross-file resolution issues
type DBPort = { insertChunk(entry: { source: string; section: string; position: number; content: string; embedding: string }): Promise<void>; getAllChunks(): Promise<any[]>; countChunks(): Promise<number> }
type DocumentPort = { listFiles(): Promise<string[]>; readFile(path: string): Promise<string> }
type LLMPort = { getEmbedding(text: string): Promise<number[]> }

/**
 * Indexe les documents via des ports (document reader, llm, db)
 */
export async function indexDocs(ports: { db: DBPort; docs: DocumentPort; llm: LLMPort }): Promise<{ files: number; chunks: number }> {
  const files = (await ports.docs.listFiles()).filter((f: string) => f.endsWith('.md'))

  let totalChunks = 0

  for (const file of files) {
    const content = await ports.docs.readFile(file)
    const chunks = chunkMarkdown(content, file)

    for (const chunk of chunks) {
      const embedding = await ports.llm.getEmbedding(chunk.content)
      await ports.db.insertChunk({
        source: chunk.source,
        section: chunk.section,
        position: chunk.position,
        content: chunk.content,
        embedding: JSON.stringify(embedding)
      })
      totalChunks++
    }
  }

  return { files: files.length, chunks: totalChunks }
}
