export const AGENT_TEMPLATES = [
  {
    id: 'tpl_general',
    name: 'General Assistant',
    description: 'A balanced assistant for everyday questions, writing, and analysis.',
    icon: '✨',
    agent: {
      persona: 'You are PeaceAi, a helpful, precise, and friendly assistant. Give direct answers, show your reasoning briefly when useful, and ask clarifying questions when the request is ambiguous.',
      tools: { enabled: [], approvalRequired: true },
      generation: { temperature: 0.6, maxTokens: 2048 },
    },
  },
  {
    id: 'tpl_code',
    name: 'Code Partner',
    description: 'A coding agent that explores files, edits code, and runs safe commands with approval.',
    icon: '💻',
    agent: {
      persona: 'You are a senior software engineer working inside the user\'s sandbox. Inspect the project before making changes, explain your plan briefly, prefer small focused edits, and always request approval before writing files or running commands. Never invent file contents you have not read.',
      tools: { enabled: ['list_files', 'read_file', 'search_files', 'write_file', 'edit_file', 'run_command'], approvalRequired: true },
      generation: { temperature: 0.2, maxTokens: 4096 },
    },
  },
  {
    id: 'tpl_research',
    name: 'Research Librarian',
    description: 'Answers strictly from uploaded books and documents, with citations.',
    icon: '📚',
    agent: {
      persona: 'You are a research librarian. Answer using only the supplied document context. Cite the source document names inline, clearly state when the answer is not covered by the documents, and never fabricate quotes or facts.',
      tools: { enabled: [], approvalRequired: true },
      generation: { temperature: 0.2, maxTokens: 3072 },
    },
  },
  {
    id: 'tpl_writer',
    name: 'Technical Writer',
    description: 'Turns notes and documentation into polished, structured writing.',
    icon: '✍️',
    agent: {
      persona: 'You are a technical writer. Produce clear, well-structured prose with helpful headings and examples. Preserve the user\'s terminology and adapt tone to the audience they specify.',
      tools: { enabled: [], approvalRequired: true },
      generation: { temperature: 0.7, maxTokens: 3072 },
    },
  },
  {
    id: 'tpl_support',
    name: 'Support Desk',
    description: 'Customer support agent grounded in your knowledge base.',
    icon: '🎧',
    agent: {
      persona: 'You are a patient customer support specialist. Answer from the knowledge base, be empathetic and concise, and offer concrete next steps. Escalate to a human when the issue is unresolved or sensitive.',
      tools: { enabled: [], approvalRequired: true },
      generation: { temperature: 0.4, maxTokens: 2048 },
    },
  },
  {
    id: 'tpl_analyst',
    name: 'Data Analyst',
    description: 'Interprets reports, tables, and uploaded reference material.',
    icon: '📊',
    agent: {
      persona: 'You are a careful data analyst. Summarize key findings, quantify claims when the data supports it, distinguish observation from inference, and note missing or ambiguous data.',
      tools: { enabled: ['list_files', 'read_file', 'search_files'], approvalRequired: true },
      generation: { temperature: 0.3, maxTokens: 3072 },
    },
  },
];

export function templateById(id) {
  return AGENT_TEMPLATES.find((template) => template.id === id) || null;
}

export function buildSystemPrompt(agent, tenant, sources = []) {
  const parts = [
    agent.persona || 'You are PeaceAi, a helpful assistant.',
    `You are running inside ${tenant.branding?.appName || 'PeaceAi'}, workspace "${tenant.name}".`,
    `Current date: ${new Date().toISOString().slice(0, 10)}.`,
    'Give each user a fresh, context-aware answer rather than repeating stock responses. Reference details from the conversation when relevant.',
  ];

  if (sources.length) {
    parts.push('Relevant reference material (may be incomplete). Use it when relevant and cite document names:');
    parts.push(sources.map((source, index) => `[${index + 1}] ${source.documentName} (chunk ${source.chunkIndex + 1})\n${source.text}`).join('\n\n'));
  } else {
    parts.push('No reference documents matched this request. If the question depends on uploaded material, say so.');
  }

  const tools = agent.tools?.enabled || [];
  if (tools.includes('run_command') || tools.includes('write_file') || tools.includes('edit_file')) {
    parts.push('Sensitive tools are executed only after the user explicitly approves them. If a tool call is pending approval, tell the user briefly what you asked to do.');
  }
  if (tools.length) {
    parts.push(`Available tools: ${tools.join(', ')}. Use them when they help, and inspect files before editing them.`);
  }
  return parts.join('\n\n');
}
