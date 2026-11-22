// PeaceAi Local — a deterministic, offline assistant that ships with the app.
// It requires no API key, network access, Python, or model download, so the home
// page is a working chat from the very first request. Admins can switch any agent
// to a hosted provider (OpenAI/Anthropic/Ollama) later in Admin → Agents.

export const LOCAL_MODEL = 'peaceai-local';

const STOPWORDS = new Set(`
  a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my
  of on or our so that the their them then there these this to was we were what when where which who why will with
  would you your please tell give show explain about over under again more most some any all one two three
`.trim().split(/\s+/));

export function localModels() {
  return [LOCAL_MODEL];
}

/** Stable bag-of-words embedding so RAG also works with the offline provider. */
export function embedLocal(input) {
  const texts = Array.isArray(input) ? input : [input];
  return texts.map((text) => {
    const vector = Array(64).fill(0);
    for (const token of tokens(String(text || ''))) {
      let hash = 2166136261;
      for (const char of token) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
      }
      vector[(hash >>> 0) % vector.length] += 1;
      if (token.length > 4) vector[(hash >>> 8) % vector.length] += 0.5;
    }
    return vector;
  });
}

function tokens(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
}

function keywords(text) {
  return tokens(text).filter((token) => !STOPWORDS.has(token));
}

/** Extract the `[1] document.txt (chunk 1)\ntext` blocks added by buildSystemPrompt. */
function parseSources(system) {
  const sources = [];
  for (const part of String(system || '').split(/\n(?=\[\d+\]\s)/)) {
    const match = part.match(/^\[(\d+)\]\s+([^\n]+?)\s*\(chunk\s+(\d+)\)\s*\n([\s\S]*)/);
    if (match) sources.push({ documentName: match[2].trim(), text: match[4].trim() });
  }
  return sources;
}

function bestSentences(sources, query, limit = 3) {
  const search = new Set(keywords(query));
  const hits = [];
  for (const source of sources) {
    for (const sentence of String(source.text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)) {
      const words = keywords(sentence);
      if (!words.length) continue;
      const overlap = words.filter((word) => search.has(word));
      if (!overlap.length) continue;
      hits.push({
        text: sentence,
        documentName: source.documentName,
        score: overlap.length / Math.sqrt(words.length),
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Tiny, safe arithmetic parser (no eval) for "12 * 4" style questions. */
function arithmetic(text) {
  let cleaned = String(text || '').trim()
    .replace(/^(?:what(?:'s| is)?|calculate|compute|solve|how much is|please)\s+/i, '')
    .replace(/[×÷]/g, (m) => (m === '×' ? '*' : '/'))
    .replace(/[=?]+\s*$/, '')
    .trim();
  if (!/^[\d\s.+\-*/()]+$/.test(cleaned) || !/[+\-*/]/.test(cleaned)) return null;
  const parts = cleaned.match(/\d+(?:\.\d+)?|[+\-*/()]/g) || [];
  let pos = 0;
  const peek = () => parts[pos];
  const take = () => parts[pos++];

  function primary() {
    const token = take();
    if (token === '-') return -primary();
    if (token === '+') return primary();
    if (token === '(') {
      const value = expression();
      if (take() !== ')') throw new Error('unbalanced');
      return value;
    }
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error('invalid number');
    return value;
  }
  function term() {
    let value = primary();
    while (peek() === '*' || peek() === '/') {
      const op = take();
      const next = primary();
      if (op === '/' && next === 0) throw new Error('divide by zero');
      value = op === '*' ? value * next : value / next;
    }
    return value;
  }
  function expression() {
    let value = term();
    while (peek() === '+' || peek() === '-') {
      const op = take();
      const next = term();
      value = op === '+' ? value + next : value - next;
    }
    return value;
  }

  try {
    const value = expression();
    return pos === parts.length && Number.isFinite(value) ? Number(value.toFixed(6)) : null;
  } catch {
    return null;
  }
}

function detectToolIntent(text, tools) {
  const available = (tools || []).map((tool) => (typeof tool === 'string' ? tool : tool.function?.name));
  const has = (name) => available.includes(name);
  const value = text.trim();
  const call = (name, args) => ({ id: `call_local_${Date.now().toString(36)}`, name, arguments: args });
  let match;

  if (has('list_files') && (match = value.match(/^(?:please\s+)?(?:list|show)\s+(?:me\s+)?(?:the\s+)?files?(?:\s+(?:in|at)\s+(.+?))?[.!]?$/i))) {
    return call('list_files', { path: (match[1] || '.').trim() });
  }
  if (has('read_file') && (match = value.match(/^(?:please\s+)?read\s+(?:the\s+)?(?:file\s+)?(.+?)[.!]?$/i))) {
    return call('read_file', { path: match[1].trim() });
  }
  if (has('search_files') && (match = value.match(/^(?:please\s+)?(?:search|find)\s+(?:files?\s+)?(?:for\s+)?(.+?)[.!]?$/i))) {
    return call('search_files', { query: match[1].trim() });
  }
  if (has('run_command') && (match = value.match(/^(?:please\s+)?run\s+(?:the\s+)?(?:command\s+)?(.+?)[.!]?$/i))) {
    const [command, ...args] = match[1].trim().split(/\s+/);
    if (['ls', 'pwd', 'git', 'node', 'npm', 'cat'].includes(command)) {
      return call('run_command', { command, args });
    }
  }
  return null;
}

function toolResultAnswer(messages) {
  const result = [...messages].reverse().find((message) => message.role === 'tool');
  const name = result?.toolName || 'tool';
  let payload = String(result?.content || '');
  try { payload = JSON.stringify(JSON.parse(payload), null, 2); } catch { /* keep raw text */ }
  return {
    content: `The **${name}** tool finished. Here is its result:\n\n\`\`\`json\n${payload.slice(0, 1600)}\n\`\`\`\n\nTell me what you would like to do next, or ask a follow-up about this result.`,
    toolCalls: [],
  };
}

function generalAnswer(raw, lower, messages, sources) {
  const appName = (String(messages.find((m) => m.role === 'system')?.content || '').match(/inside (.+?), workspace/) || [])[1] || 'PeaceAi';
  const followUp = messages.filter((m) => m.role === 'user').length > 1;

  if (sources.length) {
    const body = sources.map((hit) => `> ${hit.text}\n> — *${hit.documentName}*`).join('\n\n');
    return `I found this in your uploaded material:\n\n${body}\n\nThat is the relevant information available in the knowledge base. Ask me a more specific question if you want me to narrow it down.`;
  }

  if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))\b/.test(lower)) {
    return `Hello! I'm **PeaceAi**, your built-in offline assistant in **${appName}**. I can chat right away, answer from uploaded files, help with code, and work with any agents your admin has published. What would you like to do?`;
  }
  if (/\b(who are you|what are you|your name|introduce yourself)\b/.test(lower)) {
    return `I'm **${appName} Local**, the assistant built into this workspace. I run directly in Node.js, so I work without an API key or internet connection. An admin can connect a hosted model (OpenAI, Anthropic, Ollama) in **Admin → Agents** whenever you want a larger model.`;
  }
  if (/\b(help|what can you do|capabilities|features|how does this work)\b/.test(lower)) {
    return `Here's what I can help with:\n\n- **Everyday questions, writing and brainstorming** — just ask naturally.\n- **Your documents** — upload files to a knowledge base in Admin and I'll answer with citations.\n- **Coding tasks** — agents with file tools can explore the sandbox; risky actions ask for approval.\n- **Custom assistants** — admins can publish agents with their own persona, model and branding.\n\nAsk me something specific to get started.`;
  }
  if (/^(thanks|thank you|cheers|nice)\b/.test(lower)) {
    return 'You’re welcome! Anything else I can help with?';
  }
  if (/\b(what time|what's the time|current time|today's date|what date)\b/.test(lower)) {
    return `It's **${new Date().toLocaleString()}** in this workspace (UTC: ${new Date().toISOString()}).`;
  }
  if (/^(how are you|how's it going)\b/.test(lower)) {
    return 'I’m running smoothly and ready to help. What’s on your mind?';
  }
  const value = arithmetic(raw);
  if (value !== null) {
    const expression = raw
      .replace(/^(?:what(?:'s| is)?|calculate|compute|solve|how much is|please)\s+/i, '')
      .replace(/[=?\s]+$/, '')
      .trim();
    return `**${expression} = ${value}**`;
  }

  if (!raw) {
    return 'I received your attachment. Ask me a question about it and I’ll do my best to answer.';
  }

  const topic = keywords(raw).slice(0, 3).join(' ');
  if (/\b(summar|uploaded|document|knowledge base|book)\b/.test(lower)) {
    return `I don't have matching reference text for that yet. Add a file under **Admin → Knowledge Bases**, attach it to a message, or switch to an agent that has documents linked — then I can answer from it with citations.`;
  }
  return `${followUp ? 'Following up on our conversation — ' : ''}you asked about **${topic || raw.slice(0, 60)}**. I'm ${appName} Local, running offline inside this workspace. I can give a direct answer, draft or rewrite text, walk through code, and use material you upload.\n\nFor a deeper, model-backed answer, an admin can select a provider and model in **Admin → Agents**. What would you like me to try first?`;
}

/** Generate a reply without any external service. */
export function generateLocal(messages = [], options = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const system = list.find((message) => message.role === 'system')?.content || '';
  const raw = String([...list].reverse().find((message) => message.role === 'user')?.content || '').trim();
  const lower = raw.toLowerCase();

  if (list.some((message) => message.role === 'tool')) return toolResultAnswer(list);

  const intent = detectToolIntent(raw, options.tools);
  if (intent) return { content: '', toolCalls: [intent] };

  const sources = bestSentences(parseSources(system), raw);
  return { content: generalAnswer(raw, lower, list, sources), toolCalls: [] };
}
