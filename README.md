# nodeai2_step5_rag_hexa

Small Fastify + RAG example refactored to a hexagonal architecture.

This repository is a learning/demo project that demonstrates:
- A Fastify web server exposing chat, agent and RAG endpoints
- A simple RAG pipeline (documents -> chunking -> embeddings -> sqlite storage -> retrieval)
- A hexagonal architecture (adapters <-> ports <-> domain/services)

Quick start

1. Install dependencies

```bash
npm install
```

2. Configure environment variables (see `ARCHITECTURE.md` for explanation). Common ones:

- `PORT` - server port (default 3000)
- `OLLAMA_URL` - URL for Ollama local server (default http://localhost:11434)
- `OLLAMA_MODEL` - model to use for generation
- `EMBED_MODEL` - model to use for embeddings

3. Start the dev server

```bash
npm run dev
```

4. Try the RAG chat endpoint (SSE streaming):

```bash
curl -N -X POST http://localhost:3000/chat/rag \
  -H "Content-Type: application/json" \
  -d '{"message":"Explique Fastify"}'
```

Project structure (high level)

- `src/`
  - `app.ts` / `server.ts` – Fastify app builder and server entry
  - `routes/` – Fastify route definitions (chat, rag, conversations, agent, health)
  - `plugins/` – (deprecated) compatibility layer; adapters are imported directly from `adapters/`
  - `adapters/` – concrete I/O implementations (db, document, llm, http, mcp)
  - `domain/` – business logic and services (RAG) which only depend on ports
  - `types*` – shared TypeScript types and small augmentations
  - `tools/` – small helper tools (e.g. the tool registry used by the agent)

Why hexagonal architecture?

- Keeps domain logic independent of frameworks and infra
- Makes it easier to swap implementations (e.g., replace Ollama with another provider)
- Facilitates testing: you can mock ports in unit tests

Notes

- The codebase was refactored to demonstrate this layout. There are some transitional shims and a few small type declaration files added to ease the migration between `.ts` and ESM runtime imports. These can be cleaned up if you prefer a different import style.

If you want, I can:
- Clean up the transitional shims and make imports consistent
- Add automated smoke tests (reindex → chat/rag streaming) to prevent regressions
- Add a short migration guide mapping old file locations to the new layout

# Tchouka_Vanelle_Hexa_model
