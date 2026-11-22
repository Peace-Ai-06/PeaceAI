import { Router } from 'express';
import { filter, find } from '../lib/store.js';
import { requireApiKey, requireScope } from '../lib/apikeys.js';
import { asyncHandler } from '../lib/http.js';
import { createConversation, getAgent, runChat } from '../lib/chat.js';
import { assertBudget } from '../lib/usage.js';
import { findWorkflow, runWorkflow, workflowsFor } from '../lib/workflows.js';

export const mcpRouter = Router();
mcpRouter.use(requireApiKey, requireScope('mcp'));

function toolFor(agent) {
  return {
    name: `peaceai_${agent.id.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    description: `${agent.name}${agent.description ? ` — ${agent.description}` : ''}`.slice(0, 400),
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to send to the agent' },
        conversationId: { type: 'string', description: 'Optional existing conversation id to continue' },
      },
      required: ['message'],
    },
  };
}

function agentForTool(tenantId, name) {
  const id = String(name || '').replace(/^peaceai_/, '');
  return find('agents', (agent) => agent.tenantId === tenantId && agent.id === id) || null;
}

function ok(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function error(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function dispatch(req) {
  const { id = null, method, params = {} } = req.body || {};
  const tenantId = req.tenant.id;

  if (method === 'ping') return ok(id, {});
  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: `peaceai-${req.tenant.slug || tenantId}`, version: '0.1.0' },
    });
  }
  if (method === 'notifications/initialized') return ok(id, {});

  if (method === 'tools/list') {
    const agents = filter('agents', (agent) => agent.tenantId === tenantId);
    const workflows = workflowsFor(tenantId).filter((item) => item.enabled !== false);
    return ok(id, {
      tools: [
        ...agents.map(toolFor),
        ...workflows.map((workflow) => ({
          name: `peaceai_wf_${workflow.id.replace(/[^a-zA-Z0-9_-]/g, '')}`,
          description: `Workflow: ${workflow.name} — ${workflow.steps?.length || 0} agents working in sequence`.slice(0, 400),
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string', description: 'The request to run through the workflow' } },
            required: ['message'],
          },
        })),
      ],
    });
  }

  if (method === 'tools/call') {
    const message = typeof params.arguments?.message === 'string' ? params.arguments.message.trim() : '';
    if (!message) return error(id, -32602, 'message is required');
    assertBudget(req.tenant);

    const workflow = String(params.name || '').startsWith('peaceai_wf_')
      ? findWorkflow(tenantId, String(params.name).replace(/^peaceai_wf_/, ''))
      : null;
    if (workflow) {
      const result = await runWorkflow({ tenant: req.tenant, user: req.user, workflow, message });
      return ok(id, {
        content: [{
          type: 'text',
          text: result.steps.map((step) => `[${step.agentName}]\n${step.output}`).join('\n\n') || result.reply,
        }],
        isError: Boolean(result.error),
      });
    }

    const agent = agentForTool(tenantId, params.name);
    if (!agent) return error(id, -32602, `Unknown tool: ${params.name}`);
    const conversation = params.arguments.conversationId
      ? find('conversations', (item) => item.id === params.arguments.conversationId && item.tenantId === tenantId && item.agentId === agent.id)
      : null;
    if (params.arguments.conversationId && !conversation) return error(id, -32602, 'Conversation not found for this agent');
    const active = conversation || createConversation({ tenantId, userId: req.user.id, agentId: agent.id });
    const result = await runChat({ tenant: req.tenant, user: req.user, agent, conversation: active, message });
    const content = [{ type: 'text', text: result.reply || '' }];
    if (result.sources?.length) {
      content.push({
        type: 'text',
        text: `\n\nSources: ${result.sources.map((source) => source.documentName).join(', ')}`,
      });
    }
    return ok(id, { content, isError: false, conversationId: active.id });
  }

  return error(id, -32601, `Method not found: ${method}`);
}

mcpRouter.get('/', (req, res) => {
  res.json({
    name: `peaceai-${req.tenant.slug || req.tenant.id}`,
    protocol: 'MCP over Streamable HTTP',
    protocolVersion: '2024-11-05',
    toolsEndpoint: '/api/mcp',
    authentication: 'Authorization: Bearer <API key with mcp scope>',
  });
});

mcpRouter.post('/', asyncHandler(async (req, res) => {
  const requests = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];
  for (const request of requests) {
    try {
      results.push(await dispatch({ body: request, tenant: req.tenant, user: req.user }));
    } catch (err) {
      results.push(error(request?.id ?? null, -32603, err.message || 'Internal error'));
    }
  }
  res.json(Array.isArray(req.body) ? results : results[0]);
}));
