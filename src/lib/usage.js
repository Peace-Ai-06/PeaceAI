import { filter, insert, now } from './store.js';
import { ApiError } from './http.js';

// Rough public list prices in USD per 1M tokens. Used only for estimates;
// tenants can override nothing here, so treat totals as indicative.
const PRICES = {
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4o': [2.5, 10],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1': [2, 8],
  'o3-mini': [1.1, 4.4],
  'claude-3-5-haiku': [0.8, 4],
  'claude-3-5-sonnet': [3, 15],
  'claude-3-7-sonnet': [3, 15],
  'claude-sonnet-4': [3, 15],
};

export function estimateCost(model, promptTokens = 0, completionTokens = 0) {
  const price = PRICES[String(model || '').toLowerCase()];
  if (!price) return 0;
  return Number(((promptTokens / 1e6) * price[0] + (completionTokens / 1e6) * price[1]).toFixed(6));
}

export function normalizeUsage(raw = {}) {
  const promptTokens = Number(raw.promptTokens ?? raw.prompt_tokens ?? raw.input_tokens ?? 0) || 0;
  const completionTokens = Number(raw.completionTokens ?? raw.completion_tokens ?? raw.output_tokens ?? 0) || 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: Number(raw.totalTokens ?? raw.total_tokens ?? promptTokens + completionTokens) || 0,
  };
}

export function recordUsage({ tenantId, userId = null, agentId = null, conversationId = null, providerId = null, model = '', usage = {}, stream = false }) {
  const tokens = normalizeUsage(usage);
  if (!tokens.promptTokens && !tokens.completionTokens) return null;
  return insert('usage', {
    id: `use_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId,
    userId,
    agentId,
    conversationId,
    providerId,
    model,
    stream,
    ...tokens,
    cost: estimateCost(model, tokens.promptTokens, tokens.completionTokens),
    ts: now(),
  });
}

function monthStart() {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

export function usageFor(tenantId, { since = null, userId = null } = {}) {
  const from = since || monthStart();
  const rows = filter('usage', (row) => row.tenantId === tenantId && row.ts >= from && (!userId || row.userId === userId));
  const totals = rows.reduce((acc, row) => {
    acc.requests += 1;
    acc.promptTokens += row.promptTokens || 0;
    acc.completionTokens += row.completionTokens || 0;
    acc.totalTokens += row.totalTokens || 0;
    acc.cost += row.cost || 0;
    return acc;
  }, { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 });
  totals.cost = Number(totals.cost.toFixed(4));

  const byModel = {};
  const byDay = {};
  for (const row of rows) {
    const model = row.model || 'unknown';
    byModel[model] ||= { requests: 0, totalTokens: 0, cost: 0 };
    byModel[model].requests += 1;
    byModel[model].totalTokens += row.totalTokens || 0;
    byModel[model].cost = Number((byModel[model].cost + (row.cost || 0)).toFixed(4));
    const day = String(row.ts).slice(0, 10);
    byDay[day] ||= { requests: 0, totalTokens: 0, cost: 0 };
    byDay[day].requests += 1;
    byDay[day].totalTokens += row.totalTokens || 0;
    byDay[day].cost = Number((byDay[day].cost + (row.cost || 0)).toFixed(4));
  }
  return { periodStart: from, totals, byModel, byDay };
}

export function assertBudget(tenant) {
  const limits = tenant?.limits || {};
  if (!limits.monthlyTokens && !limits.monthlyCost) return;
  const { totals } = usageFor(tenant.id);
  if (limits.monthlyTokens && totals.totalTokens >= Number(limits.monthlyTokens)) {
    throw new ApiError(429, 'This workspace has reached its monthly token budget', 'budget_exceeded');
  }
  if (limits.monthlyCost && totals.cost >= Number(limits.monthlyCost)) {
    throw new ApiError(429, 'This workspace has reached its monthly cost budget', 'budget_exceeded');
  }
}
