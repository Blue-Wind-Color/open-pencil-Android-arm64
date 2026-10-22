import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type {
  Client,
  Agent,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse
} from '@agentclientprotocol/sdk'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import type { ACPAgentDef } from '@open-pencil/core/constants'

import SYSTEM_PROMPT from '@/app/ai/chat/system-prompt'
import { describeDiagnosticError, recordACPTransportFailure } from '@/app/diagnostics'

import { parseAuthStatusUpdate } from './auth/status'
import { createUpdateMapper } from './map-update'
import { linkOwnTools } from './own-tools'
import { spawnACPProcess } from './process'

type TauriChild = Awaited<ReturnType<typeof spawnACPProcess>>['child']

interface ACPSession {
  connection: ClientSideConnection
  sessionId: string
  child: TauriChild
  onUpdate: ((params: SessionNotification) => void) | null
  dead: boolean
}

function isMissingCommandError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('enoent') || normalized.includes('program not found')
}

function missingCommandMessage(agentDef?: ACPAgentDef): string {
  if (!agentDef) return 'ACP agent CLI is not installed.'
  if (!agentDef.installCommand) {
    return `"${agentDef.command}" is not installed. Install it and restart OpenPencil.`
  }
  return `"${agentDef.command}" is not installed. Install it with: ${agentDef.installCommand}`
}

export function formatConnectionError(e: unknown, agentDef?: ACPAgentDef): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (
    msg.includes('ECONNREFUSED') ||
    msg.includes('fetch failed') ||
    msg.includes('Failed to fetch')
  ) {
    return 'MCP server is not running. Make sure the editor is open.'
  }
  if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('ETIMEDOUT')) {
    return 'MCP server did not respond in time.'
  }
  if (isMissingCommandError(msg)) {
    return missingCommandMessage(agentDef)
  }
  if (isAuthRequiredError(e)) {
    return `${agentDef?.name ?? 'The agent'} is not signed in. Sign in from Set up AI, then try again.`
  }
  return msg
}

/** ACP's `auth_required` error, which an agent returns for a new session before sign-in. */
function isAuthRequiredError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === -32000
}

/** The agent never opened its session with OpenPencil's MCP server, so it has no design tools. */
function toolsUnreachableError(agentDef: ACPAgentDef, reason: string | null): Error {
  return new Error(
    `${agentDef.name} couldn't reach OpenPencil's tools, so your message wasn't sent.` +
      (reason ? ` ${agentDef.name} reported: ${reason}` : '')
  )
}

function startupError(error: unknown, agentDef: ACPAgentDef): Error {
  recordACPTransportFailure({ operation: 'start', ...describeDiagnosticError(error) })
  return new Error(formatConnectionError(error, agentDef))
}

export function buildCrashChunks(
  destroying: boolean,
  textId: string,
  textStarted: boolean
): { chunks: UIMessageChunk[]; shouldNullSession: boolean } {
  if (destroying) return { chunks: [], shouldNullSession: false }
  const chunks: UIMessageChunk[] = []
  if (textStarted) chunks.push({ type: 'text-end', id: textId })
  chunks.push({ type: 'error', errorText: 'Agent process exited unexpectedly.' })
  chunks.push({ type: 'finish-step' })
  chunks.push({ type: 'finish', finishReason: 'error' })
  return { chunks, shouldNullSession: true }
}

export class ACPChatTransport implements ChatTransport<UIMessage> {
  private session: ACPSession | null = null
  private agentDef: ACPAgentDef
  private cwd: string
  private sentContext = false
  private destroying = false
  /** The agent while it starts, before it becomes the session, so destroying can stop it. */
  private starting: TauriChild | null = null

  constructor(options: { agentDef: ACPAgentDef; cwd?: string }) {
    this.agentDef = options.agentDef
    this.cwd = options.cwd ?? '.'
  }

  async sendMessages({
    messages,
    abortSignal
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    const text =
      lastUserMessage?.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') ?? ''

    if (this.session?.dead) {
      this.session = null
    }

    if (!this.session) {
      const started = await this.spawnAgent()
      // Destroyed between startup and here: the agent is still `starting`, so stop it.
      if (this.destroying) {
        await started.child.kill().catch(() => undefined)
        throw new Error('The chat closed while its agent was starting.')
      }
      this.session = started
      this.starting = null
      this.sentContext = false
    }

    const carriesContext = !this.sentContext
    const promptText = carriesContext ? `${SYSTEM_PROMPT}\n\n${text}` : text
    this.sentContext = true

    const { connection, sessionId } = this.session
    const session = this.session

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const mapper = createUpdateMapper(`turn-${Date.now()}`)
        let closed = false

        function finish(reason: 'stop' | 'other' | 'error', errorText?: string) {
          if (closed) return
          closed = true
          if (errorText) controller.enqueue({ type: 'error', errorText })
          for (const chunk of mapper.end()) controller.enqueue(chunk)
          controller.enqueue({ type: 'finish-step' })
          controller.enqueue({ type: 'finish', finishReason: reason })
          session.onUpdate = null
          controller.close()
        }

        session.onUpdate = (params) => {
          if (closed) return
          for (const chunk of mapper.map(params.update)) controller.enqueue(chunk)
        }

        abortSignal?.addEventListener('abort', () => {
          void connection.cancel({ sessionId })
          finish('stop')
        })

        controller.enqueue({ type: 'start' })
        controller.enqueue({ type: 'start-step' })

        // Stopped while the agent started and reached its tools: the abort event already fired.
        if (abortSignal?.aborted) {
          // The instructions went out with nothing, so the next message carries them.
          if (carriesContext) this.sentContext = false
          finish('stop')
          return
        }

        connection
          .prompt({
            sessionId,
            prompt: [{ type: 'text', text: promptText }]
          })
          // The prompt answers once the agent's turn is over; nothing else ends the reply.
          .then((result) => finish(result.stopReason === 'end_turn' ? 'stop' : 'other'))
          .catch((e) => {
            recordACPTransportFailure({
              operation: 'message',
              ...describeDiagnosticError(e)
            })
            finish('error', formatConnectionError(e, this.agentDef))
          })
      }
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  async destroy(): Promise<void> {
    this.destroying = true
    const starting = this.starting
    this.starting = null
    await starting?.kill().catch(() => undefined)
    if (this.session) {
      await this.session.child.kill()
      this.session = null
    }
  }

  private async spawnAgent(): Promise<ACPSession> {
    let process: Awaited<ReturnType<typeof spawnACPProcess>>
    try {
      process = await spawnACPProcess({
        command: this.agentDef.command,
        args: this.agentDef.args,
        logId: this.agentDef.id,
        destroying: () => this.destroying,
        onUnexpectedClose: () => {
          if (!this.session) return
          this.session.dead = true
          this.session = null
        }
      })
    } catch (e) {
      recordACPTransportFailure({ operation: 'start', ...describeDiagnosticError(e) })
      throw new Error(formatConnectionError(e, this.agentDef))
    }
    const { child, input, output } = process
    const stream = ndJsonStream(input, output)
    let onUpdate: ACPSession['onUpdate'] = null

    const clientImpl: Client = {
      async requestPermission(
        params: RequestPermissionRequest
      ): Promise<RequestPermissionResponse> {
        const { requestPermissionFromUser } = await import('@/app/ai/acp/permission')
        return requestPermissionFromUser(params)
      },

      async sessionUpdate(params: SessionNotification): Promise<void> {
        onUpdate?.(params)
      },

      extNotification: async (method, params) => {
        const status = parseAuthStatusUpdate(method, params)
        if (!status) return
        const { agentAccounts } = await import('@/app/ai/agents/accounts')
        agentAccounts.report(this.agentDef.id, status)
      }
    }

    const connection = new ClientSideConnection((_agent: Agent) => clientImpl, stream)
    this.starting = child
    // The SDK leaves requests pending when the agent exits, so each startup request races it.
    const stopped = connection.closed.then((): never => {
      throw new Error('The agent stopped while it was starting.')
    })
    stopped.catch(() => undefined)
    const untilStopped = <T>(request: Promise<T>): Promise<T> => Promise.race([request, stopped])
    const { getAutomationAuthToken } = await import('@/app/automation/mcp/spawn')
    let automationAuthToken: string | null
    try {
      automationAuthToken = await getAutomationAuthToken()
    } catch (e) {
      await child.kill().catch(() => undefined)
      throw startupError(e, this.agentDef)
    }

    try {
      await untilStopped(
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {}
        })
      )
    } catch (e) {
      await child.kill().catch(() => undefined)
      throw startupError(e, this.agentDef)
    }

    // The agent must reach OpenPencil's tools before it gets a prompt.
    let tools: Awaited<ReturnType<typeof linkOwnTools>>
    try {
      tools = await linkOwnTools(automationAuthToken)
    } catch (e) {
      // An outside MCP connection whose credential cannot be read fails here.
      await child.kill().catch(() => undefined)
      throw startupError(e, this.agentDef)
    }
    onUpdate = ({ update }) => tools.noteUpdate(update)

    let sessionResult
    try {
      sessionResult = await untilStopped(
        connection.newSession({
          cwd: this.cwd,
          mcpServers: tools.mcpServers,
          _meta: tools.meta
        })
      )
    } catch (e) {
      tools.stop()
      await child.kill().catch(() => undefined)
      throw startupError(e, this.agentDef)
    }

    let outcome: Awaited<ReturnType<typeof tools.outcome>>
    try {
      outcome = await untilStopped(tools.outcome())
    } catch (e) {
      tools.stop()
      throw startupError(e, this.agentDef)
    }
    // Destroyed while starting, as when the chat closes: the agent must not get a prompt.
    if (this.destroying) {
      await child.kill().catch(() => undefined)
      throw new Error('The chat closed while its agent was starting.')
    }
    if (outcome.connected === false) {
      await child.kill().catch(() => undefined)
      const error = toolsUnreachableError(this.agentDef, outcome.reason)
      recordACPTransportFailure({ operation: 'start', ...describeDiagnosticError(error) })
      throw error
    }
    onUpdate = null

    const session: ACPSession = {
      connection,
      sessionId: sessionResult.sessionId,
      child,
      dead: false,
      get onUpdate() {
        return onUpdate
      },
      set onUpdate(fn) {
        onUpdate = fn
      }
    }

    return session
  }
}
