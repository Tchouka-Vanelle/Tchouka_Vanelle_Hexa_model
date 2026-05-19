# Architecture Record — nodeai2_step5_rag_hexa

This document describes the architecture decisions and the current hexagonal layout used in this repository.

Goals

- Isolate business logic (RAG) from infrastructure and frameworks
- Make it easy to swap components (DB, LLM provider, document loader)
- Be explicit about the responsibilities of each layer

Overview

- Hexagonal core: `domain/` contains services and pure business logic.
  - `domain/services/rag` — RAG pipeline: chunking, embeddings (via a provided port), and retrieval.
  - The domain depends only on abstract "ports" (interfaces) for external concerns.

- Adapters: `adapters/` contain concrete implementations that "adapt" external systems to the ports.
  - `adapters/db` — SQLite via `better-sqlite3` (provides `dbPort` to the domain).
  - `adapters/document` — filesystem document reader (lists and reads docs in `./docs`).
  - `adapters/llm` — LLM provider adapter (Ollama in this project) exposing an embedding function.
  - `adapters/http` and `adapters/mcp` — placeholders for HTTP wrappers and MCP adapters.

- Framework/entry: `src/app.ts` and `src/server.ts` build and run the Fastify server and register plugins/routes.
  - `plugins/` (deprecated) previously held thin Fastify plugin re-exports. Adapters are imported directly from `adapters/` now.

- Tools and routes: `routes/` and `tools/` implement HTTP endpoints and small helper utilities (agent tools, registry).

Ports & Contracts (short)

- DBPort: insertChunk, getAllChunks, countChunks — domain uses these to persist and read chunk data.
- DocumentPort: listFiles, readFile — domain uses these to find and read documents for indexing.
- LLMPort: getEmbedding — domain calls this to obtain embeddings for text.

Rationale and trade-offs

- Using ports keeps domain code testable and independent of infrastructure. The adapters are purposely small and thin.
- Some added `.d.ts` shims and a Fastify type augmentation were introduced to ease the migration with Node ESM (`module: NodeNext`). These can be removed later after finalizing import conventions.
- The DB plugin still exposes `app.db` and `app.stmts` for backward compatibility with route code that expects the old API.

Operational notes

- Indexing is run at startup if the `chunks` table is empty. The DB adapter uses the document and LLM adapters to perform that indexing.
- If Ollama is unavailable at startup, indexing may fail; the logs will show `RAG: indexation échouée` with details.

Environment variables

- `PORT` — server port
- `OLLAMA_URL` — URL for Ollama
- `OLLAMA_MODEL` — model for generation
- `EMBED_MODEL` — embedding model

Follow-ups (recommended)

- Remove transitional type shims and settle on one import style (.js extensions vs tsconfig paths).
- Add a smoke test that runs index → query to detect regressions automatically.
- Add sample unit tests for `domain/services/rag/retriever.ts` and `indexer.ts` using mocked ports.

