export type JSONSchema = Record<string, any>

export type ToolFunction = {
  name: string
  description?: string
  parameters?: JSONSchema
}

export type ToolDefinition = {
  type: 'function'
  function: ToolFunction
}

export type ToolCall = {
  function: {
    name: string
    arguments: unknown
  }
}

export type ExecuteToolFn = (name: string, args: unknown) => Promise<unknown>

export interface ChunkRow {
  id: number
  source: string
  section: string
  position: number
  content: string
  embedding: string
  similarity?: number
}

export type Prepared = { get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[]; run: (...a: unknown[]) => unknown }
export interface Stmts {
  createConv: Prepared
  listConvs: Prepared
  getConv: Prepared
  deleteConv: Prepared
  getMessages: Prepared
  addMessage: Prepared
  insertChunk: Prepared
  getAllChunks: Prepared
  countChunks: Prepared
  [key: string]: Prepared
}

export type ChatBody = { message: string }
export type AgentBody = { message: string }
export type RagSearchBody = { query: string; k?: number }

export interface DBPort {
  insertChunk(entry: { source: string; section: string; position: number; content: string; embedding: string }): Promise<void>
  getAllChunks(): Promise<any[]>
  countChunks(): Promise<number>
}

export interface DocumentPort {
  listFiles(): Promise<string[]>
  readFile(path: string): Promise<string>
}

export interface LLMPort {
  getEmbedding(text: string): Promise<number[]>
}
