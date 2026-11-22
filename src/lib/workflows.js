import { filter, find } from './store.js';
import { ApiError } from './http.js';
import { createConversation, getAgent, runChat } from './chat.js';

const MAX_STEPS = 8;

export function publicWorkflow(workflow) {
  return { ...workflow };
}

export function workflowsFor(tenantId) {
  return filter('workflows', (item) => item.tenantId === tenantId);
}

export function findWorkflow(tenantId, idValue) {
  return find('workflows', (item) => item.id === idValue && item.tenantId === tenantId);
}

function stepInput(workflow, step, index, message, previous) {
  if (index === 0) return message;
  return [
    step.instruction ? `Your role in this workflow: ${step.instruction}` : 'Continue the workflow.',
    `Original request from the user:\n${message}`,
    `Output from the previous agent:\n${previous || '(none)'}`,
  ].join('\n\n');
}

export async function runWorkflow({ tenant, user, workflow, message, onEvent, stream = false }) {
  const incoming = typeof message === 'string' ? message.trim() : '';
  if (!incoming) throw new ApiError(400, 'A message is required', 'validation_error');
  const steps = Array.isArray(workflow.steps) ? workflow.steps.slice(0, MAX_STEPS) : [];
  if (!steps.length) throw new ApiError(400, 'This workflow has no steps', 'validation_error');

  const results = [];
  let previous = '';
  let error = null;
  for (const [index, step] of steps.entries()) {
    const emit = (event, data) => {
      if (typeof onEvent === 'function') onEvent(event, { index, total: steps.length, ...data });
    };
    emit('workflow_step', { status: 'running', agentId: step.agentId });
    try {
      const agent = getAgent(tenant.id, step.agentId);
      const conversation = createConversation({
        tenantId: tenant.id,
        userId: user.id,
        agentId: agent.id,
        title: `${workflow.name} · ${index + 1}/${steps.length}`,
      });
      const result = await runChat({
        tenant,
        user,
        agent,
        conversation,
        message: stepInput(workflow, step, index, incoming, previous),
        stream,
        onEvent,
      });
      previous = result.reply || '';
      results.push({
        index,
        agentId: agent.id,
        agentName: agent.name,
        conversationId: conversation.id,
        output: previous,
        sources: result.sources || [],
      });
      emit('workflow_step', { status: 'done', agentId: agent.id, conversationId: conversation.id, output: previous });
    } catch (err) {
      error = err;
      emit('workflow_step', { status: 'error', agentId: step.agentId, error: err.message });
      break;
    }
  }
  return {
    reply: previous,
    steps: results,
    conversationId: results.at(-1)?.conversationId || null,
    error: error ? { message: error.message, code: error.code || 'workflow_error' } : null,
  };
}
