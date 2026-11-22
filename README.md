# PeaceAi

PeaceAi is a self-hosted, multi-tenant AI workspace built entirely with Node.js and vanilla web technologies. An admin can connect model providers, upload books and files into knowledge bases, publish unique agent personas, and give every user their own themed interface. Agents can chat, answer from uploaded documents, and act as a coding agent inside a per-tenant sandbox with explicit tool approval.

> PeaceAi does **not** train model weights. "Model generation" here means generating **custom agents**: a persona + provider/model selection + uploaded knowledge + tools + branding. This is deliberate — real fine-tuning needs Python/GPU tooling and would break the "Node.js only" requirement.

## Features

- **Three-in-one experience**: conversational chat, document Q&A, and a coding agent that can list/read/search/write files and run allowlisted commands.
- **Admin-controlled model setup**: configure OpenAI-compatible, Anthropic, or local Ollama providers. Choose the provider and model for every agent. API keys are encrypted at rest.
- **RAG over uploads**: PDF, DOCX, Markdown, text, JSON, CSV, HTML and source files are parsed, chunked, and indexed. Uses vector embeddings when configured and falls back to lexical retrieval otherwise.
- **Agent templates**: General Assistant, Code Partner, Research Librarian, Technical Writer, Support Desk, Data Analyst.
- **Multi-tenant isolation**: every tenant has its own providers, documents, agents, conversations, audit log, and file sandbox.
- **Unique per user**: per-user themes (mode, accent, font, density, sidebar, scoped custom CSS) layered on top of tenant branding, plus conversation-aware, non-repetitive answers.
- **Safe tools**: paths are sandboxed, hidden/parent paths are rejected, commands are allowlisted, and write/edit/run tools require click-to-approve.
- **Streaming**: SSE chat with live tokens, source panels, and interactive tool approval cards.
- **Node.js only**: Express backend, vanilla HTML/CSS/JS frontend, JSON persistence — no Python, no external frontend build step.

## Quick start

Requirements: Node.js 20+ (tested on Node 26). Optional: Ollama for local models.

```bash
cd "PeaceAi"
npm install
cp .env.example .env
# Edit .env and set PEACEAI_SECRET to a long random string:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm start
```

Open <http://localhost:3000>. The first account registered becomes the workspace admin and platform admin.

### Development

```bash
npm run dev     # auto-restart server on file changes
npm test        # unit + integration tests (mock model provider, no API key needed)
```

## Admin workflow

1. **Providers** — add a model provider:
   - Hosted OpenAI-compatible: kind `openai`, base URL `https://api.openai.com/v1` (or any compatible endpoint), add an API key.
   - Anthropic: kind `anthropic`, add an API key; base URL can stay empty.
   - Local: install [Ollama](https://ollama.com), run `ollama pull llama3.2` and `ollama pull nomic-embed-text`, then add kind `ollama` with base URL `http://127.0.0.1:11434`.
   - Use **Test** to fetch the available model list.
2. **Knowledge bases** — create one, optionally choose an embedding provider/model (e.g. `nomic-embed-text` or `text-embedding-3-small`), and upload books/files. Status, chunk count and errors are shown per document.
3. **Agents** — create from a template or from scratch. Pick a provider + model, attach knowledge bases, write the persona, tune temperature/max tokens, and enable the tools the agent may use. Turn on approval-required for sensitive tools.
4. **Branding & users** — set the workspace name/accent/tagline and add members. Members can use agents but cannot change admin settings.
5. **Chat** — pick an agent, start a conversation, attach files for one-off context, approve tool calls, and inspect cited sources.

## Project layout

```
src/
  server.js            Express app + route wiring + SPA fallback
  env.js               .env loader (runs before other modules)
  lib/
    store.js           JSON persistence, IDs, audit, tenant workspaces
    security.js        scrypt passwords, AES-GCM key encryption, session signing
    auth.js            sessions, cookies, role middleware
    http.js            errors and validation helpers
    providers.js       OpenAI / Anthropic / Ollama chat, streaming, embeddings, model listing
    files.js           PDF/DOCX/text extraction and chunking
    rag.js             vector + lexical retrieval
    tools.js           sandboxed coding tools and approval queue
    agents.js          agent templates and system prompt builder
    chat.js            conversation orchestration, tool loop, streaming events
    theme.js           theme/branding sanitizers
  routes/              auth, admin, agents, chat, tools, platform
  public/              vanilla HTML/CSS/JS SPA
test/                  node:test unit + integration tests with a mock model provider
docs/API.md            HTTP API contract
data/                  created at runtime (gitignored): db.json, secret, workspaces/
```

## Security notes

- Change `PEACEAI_SECRET` before real use. It encrypts stored provider API keys and signs sessions. A generated fallback secret is written to `data/secret` if none is configured.
- Sessions are httpOnly cookies; passwords are salted scrypt hashes; keys are never returned by the API.
- The coding sandbox is defense-in-depth, not a full container. Run PeaceAi as a non-root user and do not expose it publicly without TLS and an auth proxy if you allow code execution.
- Custom user CSS is stripped of angle brackets to prevent markup injection, but only allow trusted users to write it.

## Known limitations

- JSON-file persistence suits single-instance deployments; multi-node scale would need a shared database.
- No model fine-tuning/training (see note above).
- Vector search is an in-process cosine scan — fine for thousands of chunks, not for millions.
- Only text-extractable PDFs are useful; scanned PDFs need OCR outside PeaceAi.

## API

See [`docs/API.md`](docs/API.md) for all endpoints, payloads, and SSE events.
