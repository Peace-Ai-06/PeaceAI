# PeaceAi HTTP API contract (v0.1)

All responses are JSON unless stated otherwise. Errors are `{ "error": { "code": string, "message": string } }`.
Authentication uses a cookie `peaceai_session` set by login/register. Include `credentials: 'same-origin'` in fetch.
Every resource is scoped to the authenticated user's tenant. `admin` role is required for `/api/admin/*`.

## Auth / identity

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/health` | - | `{ ok: true, version, time, storage:'sqlite', sandbox:{mode,isolated,required,resourceLimits}, ocr:{enabled,required,pdftoppm,tesseract,ready} }` |
| POST | `/api/auth/register` | `{ email, password, name, tenantName }` | `{ user, tenant }` + cookie |
| POST | `/api/auth/login` | `{ email, password }` | `{ user, tenant }` + cookie |
| POST | `/api/auth/logout` | - | `{ ok: true }` |
| GET | `/api/auth/me` | - | `{ user, tenant }` |
| POST | `/api/auth/change-password` | `{ currentPassword, newPassword }` | `{ ok: true }` |
| PUT | `/api/me/theme` | `{ theme }` | `{ user }` |

User: `{ id, tenantId, email, name, role: 'admin'|'member', isPlatformAdmin, theme: { mode:'dark'|'light', accent, font, density:'comfortable'|'compact', sidebar:'left'|'right', customCss }, createdAt }`
Tenant: `{ id, name, slug, branding: { appName, logoText, accent, tagline }, createdAt }`

## Guest (no login required)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/guest/session` | - | `{ guest, tenant, agent, isGuest:true }` + guest cookie `peaceai_guest` |
| GET | `/api/guest/me` | - | `{ guest, tenant, agent, isGuest:true }` |
| GET | `/api/guest/limit` | - | `{ guest, remaining }` |

Guest info: `{ enabled, basis:'messages'|'sessions'|'minutes', limit, used, remaining, startedAt }`.
Chat/conversation endpoints accept the guest cookie and restrict the agent to the tenant's configured guest agent. When the limit is reached, JSON endpoints return `403 { error: { code:'guest_limit_reached' } }` and the SSE stream emits an `error` event with the same code.

## Admin

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/overview` | - | `{ counts: { users, agents, knowledgeBases, documents, conversations }, tenant }` |
| GET | `/api/admin/providers` | - | `{ providers: [Provider] }` |
| POST | `/api/admin/providers` | `{ name, kind:'local'|'openai'|'anthropic'|'ollama', baseUrl, apiKey, enabled }` | `{ provider }` |
| PUT | `/api/admin/providers/:id` | same fields (omit `apiKey` to keep existing) | `{ provider }` |
| DELETE | `/api/admin/providers/:id` | - | `{ ok: true }` |
| POST | `/api/admin/providers/:id/test` | - | `{ ok, models: string[] }` |
| GET | `/api/admin/knowledge-bases` | - | `{ knowledgeBases: [KnowledgeBase] }` |
| POST | `/api/admin/knowledge-bases` | `{ name, description }` | `{ knowledgeBase }` |
| DELETE | `/api/admin/knowledge-bases/:id` | - | `{ ok: true }` |
| GET | `/api/admin/knowledge-bases/:id/documents` | - | `{ documents: [Document] }` |
| POST | `/api/admin/knowledge-bases/:id/documents` | multipart field `files` (repeatable) | `{ documents: [Document] }` |
| DELETE | `/api/admin/knowledge-bases/:id/documents/:docId` | - | `{ ok: true }` |
| GET | `/api/admin/agents` | - | `{ agents: [Agent] }` |
| POST | `/api/admin/agents` | Agent fields | `{ agent }` |
| PUT | `/api/admin/agents/:id` | Agent fields | `{ agent }` |
| DELETE | `/api/admin/agents/:id` | - | `{ ok: true }` |
| GET | `/api/admin/users` | - | `{ users: [User] }` |
| POST | `/api/admin/users` | `{ email, password, name, role }` | `{ user }` |
| PUT | `/api/admin/users/:id` | `{ name?, role?, active? }` | `{ user }` |
| DELETE | `/api/admin/users/:id` | - | `{ ok: true }` |
| PUT | `/api/admin/branding` | `{ branding }` | `{ tenant }` |
| GET | `/api/admin/guest-access` | - | `{ guestAccess, agent }` |
| PUT | `/api/admin/guest-access` | `{ enabled, basis, limit, agentId }` | `{ guestAccess, tenant }` |
| GET | `/api/admin/audit` | - | `{ entries }` |
| GET | `/api/templates` | - | `{ templates: [AgentTemplate] }` |

Provider: `{ id, tenantId, name, kind, baseUrl, hasApiKey, enabled, createdAt, isBuiltIn? }` (apiKey never returned). A built-in `local` provider (`peaceai-local`) is seeded per tenant and wired to the default guest agent; it needs no base URL or API key and cannot be deleted.
KnowledgeBase: `{ id, tenantId, name, description, documentCount, chunkCount, createdAt }`
Document: `{ id, tenantId, knowledgeBaseId, name, mimeType, size, chunkCount, status:'ready'|'error', error?, createdAt }`
Agent: `{ id, tenantId, name, description, icon, accent, persona, providerId, model, embeddingProviderId, embeddingModel, knowledgeBaseIds: string[], generation: { temperature, maxTokens }, tools: { enabled: string[], approvalRequired: boolean }, visibility:'tenant'|'link', createdAt }`
AgentTemplate: `{ id, name, description, icon, agent: Partial<Agent> }` — used by admin "Create from template" wizard.

Available tool ids: `list_files`, `read_file`, `search_files`, `write_file`, `edit_file`, `run_command`.

## Agents / conversations / chat (all authenticated users)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/agents` | - | `{ agents: [Agent] }` |
| GET | `/api/agents/:id` | - | `{ agent }` |
| GET | `/api/conversations` | `?agentId=` optional | `{ conversations: [ConversationSummary] }` |
| POST | `/api/conversations` | `{ agentId, title? }` | `{ conversation }` |
| GET | `/api/conversations/:id` | - | `{ conversation }` |
| DELETE | `/api/conversations/:id` | - | `{ ok: true }` |
| POST | `/api/chat` | `{ conversationId?, agentId, message, attachments?: [{name,text}] }` | `{ conversation, reply, sources, pending }` |
| POST | `/api/chat/stream` | same as `/api/chat` | `text/event-stream` |
| POST | `/api/chat/attachments` | multipart field `files` | `{ attachments: [{name, text}] }` |

Conversation: `{ id, tenantId, userId, agentId, title, messages: [Message], createdAt, updatedAt }`
ConversationSummary: same without `messages`.
Message: `{ id, role:'user'|'assistant'|'tool', content, ts, toolCalls?: [ToolCall], toolResults?: [ToolResult] }`

### SSE events for `/api/chat/stream`
```
event: meta\ndata: {"conversationId":"...","userMessageId":"...","assistantMessageId":"..."}\n\n
event: sources\ndata: {"sources":[{"documentName":"...","documentId":"...","chunkIndex":0,"section":"Setup","score":0.82,"preview":"..."}]}\n\n
event: delta\ndata: {"text":"..."}\n\n
event: tool\ndata: {"toolCall":{"id":"...","name":"read_file","arguments":{...}},"status":"pending","approvalToken":"..."}\n\n
event: tool\ndata: {"toolCall":{...},"status":"done","result":{"ok":true,...}}\n\n
event: message\ndata: {"message":{...}}\n\n
event: done\ndata: {"conversation":{...}}\n\n
event: error\ndata: {"message":"..."}\n\n
```

## Tools (all authenticated users)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/tools/:agentId/files` | `?path=` (relative to sandbox) | `{ cwd, path, entries:[{name,type:'file'|'dir',size}] }` |
| POST | `/api/tools/:agentId/files` | multipart `files` + optional `path` | `{ files:[{name,size}] }` — upload project files into the sandbox |
| GET | `/api/tools/pending` | - | `{ pending: [{ token, agentId, toolCall, createdAt }] }` |
| POST | `/api/tools/approve` | `{ token, action:'approve'|'deny' }` | `{ ok, result?, error?, reply?, conversation? }` |

Tools run inside the tenant's sandbox (`data/workspaces/<tenantId>/`). Dangerous tools require explicit approval via the `tool` SSE event / pending list. Denied calls return an error result to the model.

## Platform admin (first registered user)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/platform/tenants` | - | `{ tenants: [Tenant] }` |
| POST | `/api/platform/tenants` | `{ name }` | `{ tenant }` |
| PUT | `/api/platform/guest-tenant` | `{ tenantId }` | `{ tenant, guestTenantId }` |
| GET | `/api/platform/audit` | - | `{ entries }` |

## Usage, budgets and feedback

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/me/usage` | `?since=` ISO date | `{ periodStart, totals:{requests,promptTokens,completionTokens,totalTokens,cost}, byModel, byDay }` |
| GET | `/api/admin/usage` | `?since=&userId=` | same, optionally for one user |
| PUT | `/api/admin/limits` | `{ monthlyTokens?, monthlyCost? }` (null clears) | `{ tenant }` |
| POST | `/api/feedback` | `{ conversationId, messageId, rating:1-5, comment? }` | `{ feedback }` |
| GET | `/api/admin/feedback` | - | `{ feedback: [...] }` |
| GET | `/api/admin/feedback/summary` | - | `{ total, positive, negative, average, byAgent }` |

## API keys

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/api-keys` | - | `{ apiKeys: [...], scopes:['chat','agents','mcp'] }` |
| POST | `/api/admin/api-keys` | `{ name?, scopes? }` | `{ apiKey, token }` — token shown once |
| DELETE | `/api/admin/api-keys/:id` | - | `{ ok: true }` |

API keys authenticate with `Authorization: Bearer <token>`. Only a SHA-256 hash and prefix are stored.

## MCP (Model Context Protocol)

`POST /api/mcp` accepts a JSON-RPC 2.0 object or array, authenticated with an API key that has the `mcp` scope.

| Method | Params | Result |
| --- | --- | --- |
| `initialize` | - | `{ protocolVersion, capabilities:{tools:{}}, serverInfo }` |
| `ping` | - | `{}` |
| `tools/list` | - | `{ tools: [{ name:'peaceai_<agentId>' or 'peaceai_wf_<workflowId>', description, inputSchema }] }` |
| `tools/call` | `{ name, arguments:{ message, conversationId? } }` | `{ content:[{type:'text',text}], isError, conversationId }` |

Errors use JSON-RPC codes: `-32601` unknown method, `-32602` invalid params, `-32603` internal error. Budget limits apply to MCP calls as well.

Agent fields additionally accept `rerankProviderId` and `rerankModel`. When both resolve to a chat-capable provider, the top 12 retrieval candidates are scored by that model and blended 50/50 with the hybrid score.

## Multi-agent workflows

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/workflows` | - | `{ workflows: [Workflow] }` |
| POST | `/api/admin/workflows` | `{ name, description?, enabled?, steps:[{agentId,instruction?}] }` | `{ workflow }` |
| PUT | `/api/admin/workflows/:id` | same fields | `{ workflow }` |
| DELETE | `/api/admin/workflows/:id` | - | `{ ok: true }` |
| GET | `/api/workflows` | - | `{ workflows: [...] }` — enabled only |
| GET | `/api/workflows/:id` | - | `{ workflow }` |
| POST | `/api/workflows/:id/run` | `{ message }` | `{ reply, steps:[{index,agentId,agentName,conversationId,output,sources}], conversationId, error }` |
| POST | `/api/workflows/:id/run/stream` | `{ message }` | SSE: `workflow_step`, plus chat `delta`/`sources`/`message`/`tool` events, then `done` or `error` |

A workflow runs at most 8 steps. Each step receives the original message plus the previous step's output. Tenant isolation is enforced on every `agentId`.

## Shareable agent links

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/admin/agents/:id/share` | `{ limit?, basis:'messages'\|'sessions' }` | `{ agent, token, shareUrl:'/share/<token>' }` |
| DELETE | `/api/admin/agents/:id/share` | - | `{ ok: true }` |
| GET | `/api/share/:token` | - | `{ agent: {id,name,description,icon,accent,tenant,limits}, isShared:true }` |
| POST | `/api/share/:token/session` | - | `{ agent, remaining:{basis,limit,used,remaining}, isShared:true }` + guest cookie |
| POST | `/api/share/:token/chat` | `{ message }` | `{ reply, sources, conversationId, remaining }` |
| POST | `/api/share/:token/chat/stream` | `{ message }` | SSE: `meta`, chat events, then `done` |

Shared visitors are guests: they get no tools, and the public payload omits the persona and provider details. Exceeding the quota returns `403 { error: { code:'share_limit_reached' } }`. The browser page is served at `/share/:token`.
