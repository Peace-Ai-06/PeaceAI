// Shared client state. Views import this module instead of passing state around.

export const state = {
  me: null,
  tenant: null,
  isGuest: false,
  guest: null,
  guestAgent: null,
  route: 'chat',
  authMode: 'login',
  previewTheme: null, // unsaved settings edits, applied live

  // chat
  agents: [],
  currentAgentId: null,
  conversations: [],
  currentConversationId: null,
  conversation: null,
  pendingTools: [],
  draftAttachments: [],
  messageSources: {}, // messageId -> [{ documentName, score, preview, chunkIndex }]
  toolStates: {}, // toolCallId -> { status, result, error, token, toolCall }
  activeStream: null,
  streamAbort: null,

  // admin / settings
  adminTab: 'overview',
  selectedKbId: null,
};

export function setSession(payload = {}) {
  state.me = payload.user || null;
  state.tenant = payload.tenant || null;
  state.isGuest = false;
  state.guest = null;
  state.guestAgent = null;
  state.previewTheme = null;
}

export function setGuestSession(payload = {}) {
  state.me = null;
  state.tenant = payload.tenant || null;
  state.isGuest = true;
  state.guest = payload.guest || null;
  state.guestAgent = payload.agent || null;
  state.previewTheme = null;
}

export function clearSession() {
  state.me = null;
  state.tenant = null;
  state.isGuest = false;
  state.guest = null;
  state.guestAgent = null;
  state.previewTheme = null;
  state.conversation = null;
  state.currentConversationId = null;
  state.conversations = [];
  state.pendingTools = [];
  state.draftAttachments = [];
  state.toolStates = {};
  state.messageSources = {};
  state.activeStream = null;
  state.streamAbort = null;
}

const THEME_DEFAULTS = {
  mode: 'dark',
  accent: '#8b7bff',
  font: 'system',
  density: 'comfortable',
  sidebar: 'left',
  customCss: '',
};

// Tenant branding supplies the fallback accent; user preferences win.
export function getTheme() {
  const branding = state.tenant?.branding || {};
  const userTheme = state.me?.theme || {};
  return {
    ...THEME_DEFAULTS,
    accent: branding.accent || THEME_DEFAULTS.accent,
    ...userTheme,
    ...(state.previewTheme || {}),
  };
}
