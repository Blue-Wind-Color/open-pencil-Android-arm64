import { describe, expect, test } from 'bun:test'

import type { LanguageModel } from 'ai'

import { AI_PROVIDERS } from '@open-pencil/core/constants'

import { resolveLanguageModelID } from '@/app/ai/chat/model'
import { resolveProviderModel } from '@/app/ai/chat/provider-models'
import { reasoningCallSettings } from '@/app/ai/chat/reasoning'
import { createAnthropicCompatibleAdapter } from '@/app/ai/providers/compatible'
import { modelProviderAdapter } from '@/app/ai/providers/registry'
import type { ModelConfig } from '@/app/ai/providers/types'
import type { FetchFunction } from '@/app/http/types'

function languageModelInstance(model: LanguageModel): Exclude<LanguageModel, string> {
  if (typeof model === 'string') throw new Error(`Expected a model instance, got ${model}`)
  return model
}

describe('resolveLanguageModelID', () => {
  test('uses the selected OpenRouter model when no custom model is configured', () => {
    expect(
      resolveLanguageModelID({
        providerID: 'openrouter',
        modelID: 'anthropic/claude-sonnet-4.6',
        customModelID: ''
      })
    ).toBe('anthropic/claude-sonnet-4.6')
  })

  test('uses a custom OpenRouter model ID when provided', () => {
    expect(
      resolveLanguageModelID({
        providerID: 'openrouter',
        modelID: 'anthropic/claude-sonnet-4.6',
        customModelID: '  meta-llama/llama-3.3-70b-instruct  '
      })
    ).toBe('meta-llama/llama-3.3-70b-instruct')
  })
})

describe('model provider registry', () => {
  test('offers Flash first and M3 as the MiniMax fallback', () => {
    const provider = AI_PROVIDERS.find(({ id }) => id === 'minimax')
    expect(provider?.defaultModel).toBe('MiniMax-M3.1-Flash')
    expect(provider?.models.map(({ id }) => id)).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3'])
  })

  test.each(['MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7'])(
    'sends %s through the OpenAI-compatible chat endpoint',
    async (modelID) => {
      let requestURL = ''
      let requestBody = ''
      const fetchSpy: FetchFunction = async (input, init) => {
        requestURL = String(input)
        requestBody = String(init?.body)
        throw new Error('stop')
      }
      const config: ModelConfig = {
        providerID: 'minimax',
        apiKey: 'test-key',
        modelID,
        customModelID: '',
        customBaseURL: '',
        customAPIType: 'completions'
      }

      const model = languageModelInstance(
        modelProviderAdapter('minimax').create(config, { fetch: fetchSpy })
      )
      await Promise.resolve(
        model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
      ).catch(() => undefined)

      const body: unknown = JSON.parse(requestBody)
      expect(requestURL).toBe('https://api.minimax.io/v1/chat/completions')
      expect(body).toMatchObject({ model: modelID })
      expect(body).not.toHaveProperty('reasoning_effort')
      expect(body).not.toHaveProperty('thinking')
    }
  )

  test.each(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const)(
    'sends a supported Flash effort for %s',
    async (level) => {
      let requestBody = ''
      const fetchSpy: FetchFunction = async (_input, init) => {
        requestBody = String(init?.body)
        throw new Error('stop')
      }
      const model = languageModelInstance(
        modelProviderAdapter('minimax').create(
          {
            providerID: 'minimax',
            apiKey: 'test-key',
            modelID: 'MiniMax-M3.1-Flash',
            customModelID: '',
            customBaseURL: '',
            customAPIType: 'completions'
          },
          { fetch: fetchSpy }
        )
      )
      await Promise.resolve(
        model.doGenerate({
          ...reasoningCallSettings(
            'minimax',
            level,
            (await resolveProviderModel('minimax', 'MiniMax-M3.1-Flash'))?.minReasoningEffort
          ),
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
        })
      ).catch(() => undefined)
      expect(JSON.parse(requestBody)).toMatchObject({
        model: 'MiniMax-M3.1-Flash',
        reasoning_effort: level === 'off' || level === 'minimal' ? 'low' : level
      })
    }
  )

  test('registers every direct provider without handling agent runtimes as models', () => {
    for (const provider of AI_PROVIDERS.filter((entry) => entry.id !== 'harness:pi')) {
      expect(modelProviderAdapter(provider.id).create).toBeFunction()
    }
    expect(() => modelProviderAdapter('harness:pi')).toThrow('Harness agents')
    expect(() => modelProviderAdapter('acp:claude-code')).toThrow(
      'ACP providers and Harness agents do not use direct API models'
    )
  })
})

describe('anthropic compatible adapter', () => {
  const config: ModelConfig = {
    providerID: 'anthropic',
    apiKey: 'test-key',
    modelID: 'claude-sonnet-4.6',
    customModelID: '',
    customBaseURL: '',
    customAPIType: 'completions'
  }

  async function capturedHeaders(): Promise<Record<string, string>> {
    let captured: Record<string, string> = {}
    const fetchSpy: FetchFunction = async (_input, init) => {
      captured = Object.fromEntries(new Headers(init?.headers).entries())
      throw new Error('stop')
    }

    const model = languageModelInstance(
      createAnthropicCompatibleAdapter().create(config, { fetch: fetchSpy })
    )
    await Promise.resolve(
      model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
    ).catch(() => undefined)

    return captured
  }

  test('opts into direct browser access so Anthropic returns CORS headers', async () => {
    // Anthropic omits Access-Control-Allow-Origin unless this header is sent, which makes the
    // web build fail with an opaque network error. See #436.
    expect(await capturedHeaders()).toHaveProperty(
      'anthropic-dangerous-direct-browser-access',
      'true'
    )
  })
})
