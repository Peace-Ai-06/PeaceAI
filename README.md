# PeaceAi

PeaceAi is a self-hosted, multi-tenant AI workspace built entirely with Node.js and vanilla web technologies. An admin can connect model providers, upload books and files into knowledge bases, publish unique agent personas, and give every user their own themed interface. Agents can chat, answer from uploaded documents, and act as a coding agent inside a per-tenant sandbox with explicit tool approval.

> PeaceAi does **not** train model weights. "Model generation" here means generating **custom agents**: a persona + provider/model selection + uploaded knowledge + tools + branding. This is deliberate — real fine-tuning needs Python/GPU tooling and would break the "Node.js only" requirement. A built-in offline engine (`peaceai-local`) makes chat work immediately; hosted models can be added later.

## Features

- **Three-in-one experience**: conversational chat, document Q&A, and a coding agent that can list/read/search/write files and run allowlisted commands.
- **Works out of the box**: a built-in `peaceai-local` engine answers chat, greetings, math and document questions with zero setup, no API key and no network.
- **Admin-controlled model setup**: switch any agent to OpenAI-compatible, Anthropic, or local Ollama providers. Choose the provider and model for every agent. API keys are encrypted at rest.
- **RAG over uploads**: PDF, DOCX, Markdown, text, JSON, CSV, HTML and source files are parsed, structure-aware chunked (with heading sections and overlap), and indexed in SQLite. Hybrid lexical + vector retrieval with heuristic reranking, optional OCR for scanned PDFs, and optional model-based cross-encoder reranking; falls back to lexical when embeddings are unavailable.
- **Agent templates**: General Assistant, Code Partner, Research Librarian, Technical Writer, Support Desk, Data Analyst.
- **Multi-tenant isolation**: every tenant has its own providers, documents, agents, conversations, audit log, and file sandbox.
- **Unique per user**: per-user themes (mode, accent, font, density, sidebar, scoped custom CSS) layered on top of tenant branding, plus conversation-aware, non-repetitive answers.
- **Safe tools**: paths are sandboxed, hidden/parent paths are rejected, commands are allowlisted, write/edit/run tools require click-to-approve, and commands run in a bubblewrap namespace with CPU/time/output caps when available. Guest sessions never get tools.
- **Streaming**: SSE chat with live tokens, source panels, and interactive tool approval cards.
- **Multi-agent workflows**: chain up to 8 agents in sequence, passing each step's output to the next. Run from the API or as MCP tools, with per-step SSE events.
- **Shareable agent links**: publish any agent as a branded public chat page with a hard message/session quota. Visitors never see your persona, tools, or workspace.
- **Node.js only**: Express backend, vanilla HTML/CSS/JS frontend, built-in `node:sqlite` persistence — no Python, no native database module, no frontend build step.

## Quick start

Requirements: Node.js 22.5+ (tested on Node 26) for built-in `node:sqlite`. Optional: bubblewrap (`bwrap`) + `prlimit` for OS-level command isolation; `pdftoppm` + `tesseract` for OCR of scanned PDFs; Ollama or a hosted API key for larger models — the built-in offline model needs neither.

```bash
cd "PeaceAi"
npm install
cp .env.example .env
# Edit .env and set PEACEAI_SECRET to a long random string:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm start
```

Open <http://localhost:3000>. You land straight in a working chat as a guest — no sign-up needed. The first account registered becomes the workspace admin and platform admin.

### Development

```bash
npm run dev     # auto-restart server on file changes
npm test        # unit + integration tests (mock model provider, no API key needed)
```

## Guest-first chat (ChatGPT-style)

The app opens **directly in chat** as a guest — no login screen blocks the first message.

- A default workspace and `PeaceAi Assistant` agent are created automatically on first boot.
- Guests get **10 free messages** by default. In **Admin → Guest Access** you can change the limit basis to `messages`, `sessions` (new conversations), or `minutes`, set the limit (1–10000), disable guest chat, or pick a different guest agent.
- When the limit is reached, chat shows a **Sign in to continue** prompt. Signing up or logging in starts a fresh account conversation; guest history is discarded by design.
- The first account registered claims the auto-created guest workspace, so its admin settings apply to guest chat immediately.
- The home page is **chat, not a login page**. Sign in is optional and only requested after the guest limit (or whenever you click **Sign in**).

> Guest chat works immediately with the built-in **PeaceAi Local** engine — no provider setup required. It is a deterministic offline assistant (not a neural LLM): it answers greetings, common questions, simple math, tool requests, and questions grounded in uploaded files. For deeper reasoning, an admin can edit `PeaceAi Assistant` in **Admin → Agents** and select a hosted/Ollama provider and model.

## Admin workflow

Every admin action is available from the expanded **Admin** section in the sidebar: Overview, Providers, Model catalog, Knowledge bases, Agents, Guest access, Users, Usage & limits, Feedback, API keys, Workflows, Shares, Branding, Audit, and Platform (platform admins only).

1. **Providers** — add a model provider:
   - Hosted OpenAI-compatible: kind `openai`, base URL `https://api.openai.com/v1` (or any compatible endpoint), add an API key.
   - Anthropic: kind `anthropic`, add an API key; base URL can stay empty.
   - Local: install [Ollama](https://ollama.com), run `ollama pull llama3.2` and `ollama pull nomic-embed-text`, then add kind `ollama` with base URL `http://127.0.0.1:11434`.
   - Use **Test** to fetch the available model list, or **Read key** to reveal a saved key (admin-only and audit-logged).
2. **Model catalog** — fetches models from every enabled provider at once, server-side, using the stored keys. Keys are never sent to the browser.
3. **Knowledge bases** — create one, optionally choose an embedding provider/model (e.g. `nomic-embed-text` or `text-embedding-3-small`), and upload books/files. This is the app's RAG "training" material — PeaceAi does not train model weights.
4. **Agents** — create from a template or from scratch. Pick a provider + model, attach knowledge bases, write the persona, tune temperature/max tokens, and enable the tools the agent may use. Turn on approval-required for sensitive tools.
5. **Guest access, users, branding** — control the no-login experience, invite members, and set the workspace name/accent/tagline.
6. **Usage & limits, feedback, workflows, shares, API keys** — monitor cost, publish agents, automate multi-agent runs, and issue scoped programmatic tokens.
7. **Chat** — pick an agent, start a conversation, attach files for one-off context, approve tool calls, and inspect cited sources.

## Project layout

```
src/
  server.js            Express app + route wiring + SPA fallback
  env.js               .env loader (runs before other modules)
  lib/
    store.js           SQLite persistence, migrations, IDs, audit, chunk store
    security.js        scrypt passwords, AES-GCM key encryption, session signing
    auth.js            sessions, cookies, role middleware
    http.js            errors and validation helpers
    providers.js       Local / OpenAI / Anthropic / Ollama chat, streaming, embeddings, model listing
    local-model.js     built-in offline assistant, deterministic embeddings, tool intents
    files.js           PDF/DOCX/text extraction and structure-aware chunking
    ocr.js             optional scanned-PDF OCR via poppler + tesseract
    rag.js             hybrid vector + lexical retrieval, heuristic and model reranking
    providers.js       Local / OpenAI / Anthropic / Ollama chat, embeddings, reranking
    tools.js           sandboxed coding tools and approval queue
    sandbox.js         optional bubblewrap namespace isolation
    agents.js          agent templates and system prompt builder
    chat.js            conversation orchestration, tool loop, streaming events
    guest.js           guest limits and default-agent resolution
    workflows.js       multi-agent workflow orchestration
    share.js           shareable agent link tokens and quotas
    usage.js           token/cost recording and budget checks
    apikeys.js         scoped API key creation and verification
    theme.js           theme/branding sanitizers
  routes/              auth, guest, admin, agents, chat, tools, platform, mcp, keys, insights, workflows, share
  public/              vanilla HTML/CSS/JS SPA + share.html
test/                  node:test unit + integration tests with a mock model provider
docs/API.md            HTTP API contract
data/                  created at runtime (gitignored): peaceai.sqlite, secret, workspaces/
```

## Security notes

- Change `PEACEAI_SECRET` before real use. It encrypts stored provider API keys and signs sessions. A generated fallback secret is written to `data/secret` if none is configured.
- Sessions are httpOnly cookies; passwords are salted scrypt hashes; keys are never returned by the API.
- Check `GET /api/health` → `sandbox.mode` at startup. `host` means only path/command allowlists apply; `bwrap` means commands run in a namespace with only the tenant workspace writable. Run PeaceAi as a non-root user and do not expose it publicly without TLS and an auth proxy if you allow code execution.
- Custom user CSS is stripped of angle brackets to prevent markup injection, but only allow trusted users to write it.

## Known limitations

- SQLite persistence suits single-instance deployments; multi-node scale would need a shared database or a replicated engine.
- No model fine-tuning/training (see note above).
- Vector search is an in-process cosine scan — fine for thousands of chunks, not for millions.
- Scanned PDFs need `pdftoppm` and `tesseract` installed for OCR; otherwise only their existing text layer is indexed.

## API

See [`docs/API.md`](docs/API.md) for all endpoints, payloads, and SSE events.

## MCP hub, API keys, usage and feedback

- **MCP endpoint** — `POST /api/mcp` speaks JSON-RPC 2.0 (`initialize`, `ping`, `tools/list`, `tools/call`). Every agent and every enabled workflow in the workspace is exposed as an MCP tool, so Claude Desktop, Cursor and other MCP clients can call them directly. Authenticate with a workspace API key.
- **API keys** — admins create scoped keys (`chat`, `agents`, `mcp`) via `POST /api/admin/api-keys`. The token is shown once; only its hash and prefix are stored. Keys can be revoked instantly.
- **Usage & budgets** — token usage returned by providers is recorded per request. Admins can see totals by model/day and set monthly token or cost budgets (`PUT /api/admin/limits`). Exceeding a budget returns HTTP 429.
- **Feedback** — `POST /api/feedback` stores a 1–5 rating for an assistant message; admins get summaries in `/api/admin/feedback/summary`.
- **Rate limits** — auth, guest, chat and MCP endpoints have in-process sliding-window limits. Multi-node deployments should replace this with a shared limiter.
- **Storage hardening** — forward-only schema migrations run on startup, and chat turns are serialized per conversation so concurrent requests cannot overwrite each other.
- **Workflows & share links** — admins chain agents into named workflows (`POST /api/admin/workflows`) and publish agents as branded public links (`POST /api/admin/agents/:id/share`) with a hard usage quota.
- **Docker & CI** — `docker build -t peaceai . && docker run -p 3000:3000 -v peaceai-data:/app/data peaceai`. The image includes bubblewrap and OCR binaries. GitHub Actions runs `npm test` on Node 22 and 24.

> Guests never receive file or command tools, regardless of the agent's tool configuration.

## Storage, retrieval and isolation notes

- On first start, an existing `data/db.json` is imported into `data/peaceai.sqlite` and renamed `db.json.migrated`. Vectors are moved out of documents into an indexed `chunks` table.
- `PEACEAI_SANDBOX=auto|bwrap|none` controls command isolation. `auto` uses bubblewrap when installed and warns if it has to fall back; `bwrap` requires it and fails closed.
- `PEACEAI_TOOL_TIMEOUT_MS` and `PEACEAI_TOOL_MAX_OUTPUT` cap command runtime and output. Commands get a minimal environment, a killed process group on timeout, and (when `prlimit` exists) a 512 MB address-space and 64-process limit.
- Sources returned by retrieval include a `section` label taken from Markdown headings when present.
- `PEACEAI_OCR=auto|on|off` controls scanned-PDF OCR (`on` fails the upload when the binaries are missing). `PEACEAI_OCR_LANG` sets the tesseract language and `PEACEAI_OCR_PAGES` caps pages (default 12).
- Set an agent's `rerankModel` (and optionally `rerankProviderId`) to use any chat-capable model as a cross-encoder: it scores the top 12 candidates and the result is blended 50/50 with the hybrid score. Failures never break retrieval. `GET /api/health` reports OCR availability.
