import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { UIMessageChunk } from 'ai'
import * as v from 'valibot'

import { OPEN_PENCIL_MCP_SERVER } from '@open-pencil/core/constants'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

type ToolCallReport = Extract<SessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>

/**
 * How a tool call shows in the chat. OpenPencil's own MCP tools take their plain names, input,
 * and result, as the built-in chat's do; another server's tools keep the MCP `mcp__server__tool`
 * form and result.
 */
type ToolKind = 'own' | 'mcp' | 'agent'

interface ToolIdentity {
  name: string
  kind: ToolKind
  /** The call's arguments, when the agent wraps them as Codex does. */
  input?: unknown
}

const OWN_PREFIX = `mcp__${OPEN_PENCIL_MCP_SERVER}__`

const codexMCPInputSchema = v.object({
  server: v.string(),
  tool: v.string(),
  arguments: v.optional(v.unknown())
})
/** Codex's `{ result, error }`; both keys are always there, and an array is never one. */
const codexMCPOutputSchema = v.pipe(
  v.custom<Record<string, unknown>>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      'result' in value &&
      'error' in value
  ),
  v.object({ result: v.unknown(), error: v.unknown() })
)
const claudeMetaSchema = v.object({ claudeCode: v.object({ toolName: v.string() }) })
const mcpResultSchema = v.object({
  content: v.array(v.unknown()),
  isError: v.optional(v.boolean())
})
const textBlockSchema = v.object({ type: v.literal('text'), text: v.string() })
const imageBlockSchema = v.object({
  type: v.literal('image'),
  data: v.string(),
  mimeType: v.string()
})
const jsonObjectSchema = v.pipe(v.string(), v.parseJson(), v.record(v.string(), v.unknown()))
const errorMessageSchema = v.object({ message: v.string() })

/** Codex reports an MCP call with its server, tool, and arguments as the input. */
function codexIdentity(update: ToolCallReport): ToolIdentity | null {
  const input = v.safeParse(codexMCPInputSchema, update.rawInput)
  if (!input.success || update.title !== `mcp.${input.output.server}.${input.output.tool}`) {
    return null
  }
  const { server, tool } = input.output
  return server === OPEN_PENCIL_MCP_SERVER
    ? { name: tool, kind: 'own', input: input.output.arguments ?? {} }
    : { name: `mcp__${server}__${tool}`, kind: 'mcp', input: input.output.arguments ?? {} }
}

/** Claude's adapter names the SDK tool, `mcp__server__tool` for an MCP one, in its metadata. */
function claudeIdentity(update: ToolCallReport): ToolIdentity | null {
  const meta = v.safeParse(claudeMetaSchema, update._meta)
  if (!meta.success) return null
  const { toolName } = meta.output.claudeCode
  if (toolName.startsWith(OWN_PREFIX)) {
    return { name: toolName.slice(OWN_PREFIX.length), kind: 'own' }
  }
  return toolName.startsWith('mcp__') ? { name: toolName, kind: 'mcp' } : null
}

function identify(update: ToolCallReport): ToolIdentity {
  return (
    codexIdentity(update) ??
    claudeIdentity(update) ?? { name: update.title || 'unknown', kind: 'agent' }
  )
}

/** A tool's text and image blocks, as MCP returns them and Claude's adapter passes them on. */
function contentBlocks(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  const result = v.safeParse(mcpResultSchema, value)
  return result.success ? result.output.content : null
}

function blockText(blocks: unknown[]): string | undefined {
  const texts = blocks.flatMap((block) => {
    const text = v.safeParse(textBlockSchema, block)
    return text.success ? [text.output.text] : []
  })
  return texts.length > 0 ? texts.join('\n') : undefined
}

/**
 * An OpenPencil tool's result as the built-in chat holds it: the JSON object the tool returned,
 * with an exported image as `base64` and `mimeType`.
 */
function ownToolOutput(blocks: unknown[]): unknown {
  const text = blockText(blocks)
  const output: Record<string, unknown> = {}
  if (text !== undefined) {
    const parsed = v.safeParse(jsonObjectSchema, text)
    Object.assign(output, parsed.success ? parsed.output : { text })
  }
  for (const block of blocks) {
    const image = v.safeParse(imageBlockSchema, block)
    if (image.success) {
      output.base64 = image.output.data
      output.mimeType = image.output.mimeType
    }
  }
  return output
}

/** An OpenPencil tool reports a failure as `{ "error": … }` text. */
function ownToolError(blocks: unknown[]): string | undefined {
  const text = blockText(blocks)
  if (text === undefined) return undefined
  const parsed = v.safeParse(jsonObjectSchema, text)
  return parsed.success && typeof parsed.output.error === 'string' ? parsed.output.error : text
}

function errorText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const error = v.safeParse(errorMessageSchema, value)
  return error.success ? error.output.message : undefined
}

type ToolResult = { ok: true; output: unknown } | { ok: false; errorText: string }

const FAILED = 'Tool call failed'

/** An MCP call's result, unwrapped from Codex's `{ result, error }`, or the error it reports. */
function mcpOutcome(update: ToolCallReport): ToolResult {
  const codex = v.safeParse(codexMCPOutputSchema, update.rawOutput)
  if (!codex.success) return { ok: true, output: update.rawOutput }
  const { error, result } = codex.output
  if (error === null || error === undefined) return { ok: true, output: result }
  return {
    ok: false,
    errorText: errorText(error) ?? textFromContent(update.content ?? undefined) ?? FAILED
  }
}

function mcpFailed(update: ToolCallReport, output: unknown): boolean {
  const result = v.safeParse(mcpResultSchema, output)
  return update.status === 'failed' || (result.success && result.output.isError === true)
}

function toolResult(update: ToolCallReport, identity: ToolIdentity): ToolResult {
  const fallback = textFromContent(update.content ?? undefined)
  if (identity.kind === 'agent') {
    return update.status === 'failed'
      ? { ok: false, errorText: fallback ?? FAILED }
      : { ok: true, output: update.rawOutput ?? fallback }
  }
  const outcome = mcpOutcome(update)
  if (!outcome.ok) return outcome
  const blocks = contentBlocks(outcome.output)
  if (mcpFailed(update, outcome.output)) {
    const reason = blocks && (identity.kind === 'own' ? ownToolError(blocks) : blockText(blocks))
    return { ok: false, errorText: reason ?? fallback ?? FAILED }
  }
  if (identity.kind === 'mcp' || !blocks) return { ok: true, output: outcome.output ?? fallback }
  return { ok: true, output: ownToolOutput(blocks) }
}

/**
 * Turns one agent turn's ACP updates into the chat's message chunks. Consecutive text or
 * thought chunks form one part, which closes when anything else arrives, so text after a tool
 * call starts a new part and a run of thoughts shows as one.
 */
export function createUpdateMapper(idPrefix: string) {
  let parts = 0
  let text: string | null = null
  let reasoning: string | null = null
  const tools = new Map<string, ToolIdentity>()

  function nextId(kind: string): string {
    parts += 1
    return `${idPrefix}-${kind}-${parts}`
  }

  function closeText(chunks: UIMessageChunk[]): void {
    if (text) chunks.push({ type: 'text-end', id: text })
    text = null
  }

  function closeReasoning(chunks: UIMessageChunk[]): void {
    if (reasoning) chunks.push({ type: 'reasoning-end', id: reasoning })
    reasoning = null
  }

  function toolInput(update: ToolCallReport, identity: ToolIdentity): unknown {
    return identity.input ?? update.rawInput
  }

  function toolResultChunks(update: ToolCallReport, identity: ToolIdentity): UIMessageChunk[] {
    if (update.status !== 'completed' && update.status !== 'failed') return []
    const result = toolResult(update, identity)
    return [
      result.ok
        ? {
            type: 'tool-output-available',
            toolCallId: update.toolCallId,
            output: result.output,
            providerExecuted: true
          }
        : {
            type: 'tool-output-error',
            toolCallId: update.toolCallId,
            errorText: result.errorText,
            providerExecuted: true
          }
    ]
  }

  function map(update: SessionUpdate): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if (update.content.type !== 'text') {
          console.warn('[ACP] Unhandled content type:', update.content.type)
          break
        }
        if (!update.content.text) break
        closeReasoning(chunks)
        if (!text) {
          text = nextId('text')
          chunks.push({ type: 'text-start', id: text })
        }
        chunks.push({ type: 'text-delta', id: text, delta: update.content.text })
        break
      }
      case 'agent_thought_chunk': {
        if (update.content.type !== 'text' || !update.content.text) break
        closeText(chunks)
        if (!reasoning) {
          reasoning = nextId('reasoning')
          chunks.push({ type: 'reasoning-start', id: reasoning })
        }
        chunks.push({ type: 'reasoning-delta', id: reasoning, delta: update.content.text })
        break
      }
      case 'tool_call': {
        closeText(chunks)
        closeReasoning(chunks)
        if (!update.title) console.warn('[ACP] Tool call without title:', update.toolCallId)
        const identity = identify(update)
        tools.set(update.toolCallId, identity)
        const title = identity.kind === 'agent' ? update.title : undefined
        chunks.push({
          type: 'tool-input-start',
          toolCallId: update.toolCallId,
          toolName: identity.name,
          providerExecuted: true,
          title
        })
        const input = toolInput(update, identity)
        // A call can arrive already finished, as Codex reports an MCP server that failed to start.
        const finished = update.status === 'completed' || update.status === 'failed'
        if (input || finished) {
          chunks.push({
            type: 'tool-input-available',
            toolCallId: update.toolCallId,
            toolName: identity.name,
            input: input ?? {},
            providerExecuted: true,
            title
          })
        }
        chunks.push(...toolResultChunks(update, identity))
        break
      }
      case 'tool_call_update': {
        const identity = tools.get(update.toolCallId) ?? identify(update)
        // Claude's adapter sends a call's complete input once it has streamed in.
        if (update.rawInput && identity.input === undefined) {
          chunks.push({
            type: 'tool-input-available',
            toolCallId: update.toolCallId,
            toolName: identity.name,
            input: update.rawInput,
            providerExecuted: true
          })
        }
        chunks.push(...toolResultChunks(update, identity))
        break
      }
    }
    return chunks
  }

  /** Closes the text or thought still open when the turn ends. */
  function end(): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    closeText(chunks)
    closeReasoning(chunks)
    return chunks
  }

  return { map, end }
}

export function textFromContent(content: JSONObject[] | undefined): string | undefined {
  if (!content) return undefined
  const parts: string[] = []
  for (const c of content) {
    if (c.type !== 'content') continue
    const inner = c.content as JSONObject | undefined
    if (inner?.type === 'text' && typeof inner.text === 'string') {
      parts.push(inner.text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}
