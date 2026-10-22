import type { McpServer, SessionUpdate } from '@agentclientprotocol/sdk'
import { promiseTimeout } from '@vueuse/core'

import { OPEN_PENCIL_MCP_SERVER } from '@open-pencil/core/constants'
import { randomHex } from '@open-pencil/scene-graph/random'

import { textFromContent } from './map-update'

/**
 * Lets the agent use OpenPencil's own tools without asking each time: their edits are undoable
 * and stay in the document the chat works on. Claude's adapter passes these options to the
 * Claude Agent SDK, where a bare server name allows every tool on it; other agents ignore it.
 */
export const OWN_TOOLS_ALLOWED = {
  claudeCode: { options: { allowedTools: [`mcp__${OPEN_PENCIL_MCP_SERVER}`] } }
}

/** How long an agent may take to reach OpenPencil's tools once its session starts. */
export const TOOLS_CONNECT_TIMEOUT_MS = 20_000

/** Whether an agent's session reached OpenPencil's tools; null when the server cannot tell. */
export type OwnToolsOutcome =
  | { connected: true }
  | { connected: false; reason: string | null }
  | { connected: null }

/** What an agent's new session needs to reach OpenPencil's tools, and how to tell it did. */
export interface OwnToolsLink {
  mcpServers: McpServer[]
  meta: typeof OWN_TOOLS_ALLOWED
  /** Reads an update sent before any prompt, where a failed tool call is a server that failed. */
  noteUpdate(update: SessionUpdate): void
  /** Waits, once the session exists, for the server to say the agent opened its MCP session. */
  outcome(timeoutMs?: number): Promise<OwnToolsOutcome>
  stop(): void
}

/**
 * Names a new agent session to OpenPencil's MCP server by a chat id, so the server can report
 * when this agent connects. Watch before creating the session: the agent connects during it.
 */
export async function linkOwnTools(authorizationToken: string | null): Promise<OwnToolsLink> {
  const [{ buildACPMCPServers }, { mcpRuntime }, { watchChatAgent }] = await Promise.all([
    import('@/app/integrations/mcp'),
    import('@/app/automation/mcp/runtime'),
    import('@/app/automation/agents')
  ])
  const chat = randomHex(16)
  // Built before watching, so a server list that fails to build leaves no chat waiting.
  const mcpServers = await buildACPMCPServers({ authorizationToken, chat })
  // An older MCP server reports no sessions, so only a current one can confirm the agent.
  const watch = mcpRuntime.agentSessionEvents ? watchChatAgent(chat) : null
  const failures: string[] = []
  return {
    mcpServers,
    meta: OWN_TOOLS_ALLOWED,
    noteUpdate(update) {
      if (update.sessionUpdate !== 'tool_call' || update.status !== 'failed') return
      const text = textFromContent(update.content ?? undefined)
      if (text?.includes(OPEN_PENCIL_MCP_SERVER)) failures.push(text)
    },
    async outcome(timeoutMs = TOOLS_CONNECT_TIMEOUT_MS) {
      if (!watch) return { connected: null }
      try {
        const connected = await Promise.race([
          watch.connected.then(() => true),
          promiseTimeout(timeoutMs).then(() => false)
        ])
        return connected
          ? { connected: true }
          : { connected: false, reason: failures.at(-1) ?? null }
      } finally {
        watch.stop()
      }
    },
    stop() {
      watch?.stop()
    }
  }
}
