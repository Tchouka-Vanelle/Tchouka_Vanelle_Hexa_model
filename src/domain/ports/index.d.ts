import type { ChunkRow } from '../../types'

export interface DBPort {
  insertChunk(entry: { source: string; section: string; position: number; content: string; embedding: string }): Promise<void>
  getAllChunks(): Promise<ChunkRow[]>
  countChunks(): Promise<number>
}

export interface DocumentPort {
  listFiles(): Promise<string[]>
  readFile(path: string): Promise<string>
}

export interface LLMPort {
  getEmbedding(text: string): Promise<number[]>
}
