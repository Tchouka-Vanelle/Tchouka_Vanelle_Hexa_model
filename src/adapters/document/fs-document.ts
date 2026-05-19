import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DocumentPort } from '../../domain/ports/index.js'

const DOCS_DIR = resolve(process.cwd(), 'docs')

export const fsDocumentAdapter: DocumentPort = {
  async listFiles() {
    const files = await readdir(DOCS_DIR, { recursive: true })
    return files.map(f => f)
  },
  async readFile(path: string) {
    const full = resolve(DOCS_DIR, path)
    return await readFile(full, 'utf8')
  }
}
