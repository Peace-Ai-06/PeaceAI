# PeaceAi HTTP API contract (v0.1)

All responses are JSON unless stated otherwise. Errors are `{ "error": { "code": string, "message": string } }`.
Authentication uses a cookie `peaceai_session` set by login/register. Include `credentials: 'same-origin'` in fetch.
Every resource is scoped to the authenticated user's tenant. `admin` role is required for `/api/admin/*`.

## Auth / identity

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/health` | - | `{ ok: true, version, time }` |
| POST | `/api/auth/register` | `{ email, password, name, tenantName }` | `{ user, tenant }` + cookie |
| POST | `/api/auth/login` | `{ email, password }` | `{ user, tenant }` + cookie |
| POST | `/api/auth/logout` | - | `{ ok: true }` |
| GET | `/api/auth/me` | - | `{ user, tenant }` |
| POST | `/api/auth/change-password` | `{ currentPassword, newPassword }` | `{ ok: true }` |
| PUT | `/api/me/theme` | `{ theme }` | `{ user }` |

User: `{ id, tenantId, email, name, role: 'admin'|'member', isPlatformAdmin, theme: { mode:'dark'|'light', accent, font, density:'comfortable'|'compact', sidebar:'left'|'right', customCss }, createdAt }`
Tenant: `{ id, name, slug, branding: { appName, logoText, accent, tagline }, createdAt }`

## Admin

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/overview` | - | `{ counts: { users, agents, knowledgeBases, documents, conversations }, tenant }` |
| GET | `/api/admin/providers` | - | `{ providers: [Provider] }` |
| POST | `/api/admin/providers` | `{ name, kind:'openai'|'anthropic'|'ollama', baseUrl, apiKey, enabled }` | `{ provider }` |
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
| GET | `/api/admin/audit` | - | `{ entries }` |
| GET | `/api/templates` | - | `{ templates: [AgentTemplate] }` |

Provider: `{ id, tenantId, name, kind, baseUrl, hasApiKey, enabled, createdAt }` (apiKey never returned)
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
event: sources\ndata: {"sources":[{"documentName":"...","chunkIndex":0,"score":0.82,"preview":"..."}]}\n\n
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
| GET | `/api/platform/audit` | - | `{ entries }` |
