import fp from 'fastify-plugin'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { DBPort } from '../../domain/ports/index.js'
import { indexDocs } from '../../domain/services/rag/indexer.js'

const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'data.db')

async function dbPlugin(app: FastifyInstance): Promise<void> {
  const db = new Database(DB_PATH)

  // WAL : lectures et écritures simultanées sans conflit
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      title     TEXT    NOT NULL,
      createdAt TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      conversationId INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role           TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content        TEXT    NOT NULL,
      createdAt      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      source    TEXT    NOT NULL,
      section   TEXT    NOT NULL,
      position  INTEGER NOT NULL,
      content   TEXT    NOT NULL,
      embedding TEXT    NOT NULL
    );
  `)

  // Préparer les requêtes une seule fois (performances + sécurité)
  const stmts = {
    createConv:   db.prepare('INSERT INTO conversations (title) VALUES (?) RETURNING *'),
    listConvs:    db.prepare(`
      SELECT c.id, c.title, c.createdAt,
             COUNT(m.id) AS messageCount
      FROM conversations c
      LEFT JOIN messages m ON m.conversationId = c.id
      GROUP BY c.id ORDER BY c.createdAt DESC
    `),
    getConv:      db.prepare('SELECT * FROM conversations WHERE id = ?'),
    deleteConv:   db.prepare('DELETE FROM conversations WHERE id = ?'),
    getMessages:  db.prepare('SELECT * FROM messages WHERE conversationId = ? ORDER BY id'),
    addMessage:   db.prepare('INSERT INTO messages (conversationId, role, content) VALUES (?, ?, ?) RETURNING *'),
    // RAG
    insertChunk:  db.prepare('INSERT INTO chunks (source, section, position, content, embedding) VALUES (?, ?, ?, ?, ?)'),
    getAllChunks: db.prepare('SELECT id, source, section, position, content, embedding FROM chunks'),
    countChunks:  db.prepare('SELECT COUNT(*) as count FROM chunks'),
  }

  app.decorate('db', db)
  app.decorate('stmts', stmts)

  // Expose a DBPort compatible object for domain services
  const dbPort: DBPort = {
    async insertChunk(entry) {
      stmts.insertChunk.run(entry.source, entry.section, entry.position, entry.content, entry.embedding)
    },
    async getAllChunks() {
      return stmts.getAllChunks.all()
    },
    async countChunks() {
      const r = stmts.countChunks.get()
      return r.count ?? 0
    }
  }

  // expose ports on app for other plugins to use
  app.decorate('ports', { db: dbPort })

  // Try to attach document and LLM adapters to ports so other code can use them
  try {
    const { fsDocumentAdapter } = await import('../document/fs-document.js')
    const { ollamaLLMAdapter } = await import('../llm/ollama-llm.js')
    // mutate the ports object we already decorated
    ;(app.ports as any).docs = fsDocumentAdapter
    ;(app.ports as any).llm = ollamaLLMAdapter
  } catch (err) {
    // non-fatal: we may still run with legacy fallbacks
    app.log.debug({ err: (err as Error).message }, 'Adapters not attached at startup')
  }

  // Fermeture propre de la DB à l'arrêt du serveur
  app.addHook('onClose', () => db.close())

  // Indexation au démarrage si la collection est vide
  app.addHook('onReady', async () => {
    const { count } = stmts.countChunks.get()
    if (count === 0) {
      app.log.info('RAG: aucun chunk en base, indexation des documents...')
      try {
        // Prefer adapters attached to app.ports, fallback to dynamic import
        const docs = (app.ports as any)?.docs ?? (await import('../document/fs-document.js')).fsDocumentAdapter
        const llm = (app.ports as any)?.llm ?? (await import('../llm/ollama-llm.js')).ollamaLLMAdapter

        const { files, chunks } = await indexDocs({ db: dbPort, docs, llm })
        app.log.info(`RAG: Indexed ${chunks} chunks from ${files} files`)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        app.log.warn({ err: message }, 'RAG: indexation échouée (docs vides ou Ollama indisponible)')
      }
    } else {
      app.log.info(`RAG: ${count} chunks déjà indexés`)
    }
  })
}

// fp() = fastify-plugin : le décorateur est visible en dehors de l'encapsulation
export default fp(dbPlugin, { name: 'db' })
