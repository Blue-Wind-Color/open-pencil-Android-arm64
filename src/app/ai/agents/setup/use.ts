import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { ACP_AGENTS, type ACPAgentDef, type ACPAgentID } from '@open-pencil/core/constants'

import { readPiAccount } from '@/app/ai/agents/pi/settings'

import { agentAccounts } from './accounts'
import { agentDiscovery } from './discovery'
import type { AgentSetupState, MCPServerSetupState, PiSetupState } from './view'

type AgentDiscovery = typeof agentDiscovery
type AgentAccounts = typeof agentAccounts

/** Setup state of the coding agents and Pi, for guided setup and model settings. */
export function useAgentSetup(
  discovery: AgentDiscovery = agentDiscovery,
  readPi: typeof readPiAccount = readPiAccount,
  accounts: AgentAccounts = agentAccounts
) {
  const piDefaultModel = ref<string | null>(null)
  const piSignedIn = ref<boolean | null>(null)
  const readingPi = ref(false)

  function agentID(providerID: string): ACPAgentID | null {
    return ACP_AGENTS.find((agent) => `acp:${agent.id}` === providerID)?.id ?? null
  }

  function agentSetup(providerID: string): AgentSetupState {
    const id = agentID(providerID)
    return {
      ...mcpServerSetup(),
      scanning: discovery.scanning.value,
      detected: discovery.agents.value.find((agent) => agent.definition.id === id) ?? null,
      adapterNeedsAdmin: discovery.adapterNeedsAdmin.value,
      installingAgent: discovery.installing.value === id,
      account: id ? accounts.account(id) : undefined
    }
  }

  function installedAgent(providerID: string): ACPAgentDef | undefined {
    const detected = agentSetup(providerID).detected
    return detected?.status === 'available' ? detected.definition : undefined
  }

  /**
   * Reads the account of each installed agent setup can sign in to, all at once. Others, such
   * as Gemini CLI, do not report a login, so starting them would show nothing.
   */
  function checkAccounts(): Promise<void> {
    const installed = discovery.agents.value.filter(
      (agent) => agent.status === 'available' && agent.definition.signIn
    )
    return Promise.all(installed.map((agent) => accounts.check(agent.definition))).then(
      () => undefined
    )
  }

  function piSetup(providerID: string): PiSetupState | undefined {
    if (providerID !== 'harness:pi') return undefined
    return {
      ...mcpServerSetup(),
      scanning: discovery.scanning.value || readingPi.value,
      companion: discovery.harnessAvailable.value,
      companionOutdated: discovery.harnessOutdated.value,
      companionCommand: discovery.harnessCommand.value,
      companionNeedsAdmin: discovery.harnessNeedsAdmin.value,
      companionInstallable: discovery.harnessInstallable.value,
      installingCompanion: discovery.installing.value === 'harness',
      defaultModel: piDefaultModel.value,
      signedIn: piSignedIn.value
    }
  }

  function mcpServerSetup(): MCPServerSetupState {
    return {
      supported: discovery.supported,
      checked: discovery.checked.value,
      bridge: discovery.canvasBridgeAvailable.value,
      bridgeOutdated: discovery.canvasBridgeOutdated.value,
      bridgeCommand: discovery.canvasBridgeCommand.value,
      npm: discovery.npmAvailable.value,
      bridgeNeedsAdmin: discovery.canvasBridgeNeedsAdmin.value,
      bridgeInstallable: discovery.canvasBridgeInstallable.value,
      installingBridge: discovery.installing.value === 'canvas',
      error: discovery.error.value
    }
  }

  async function installAgent(providerID: string): Promise<void> {
    if (providerID === 'harness:pi') return discovery.setupHarness()
    const detected = agentSetup(providerID).detected
    if (!detected) return
    await discovery.install(detected.definition.id)
    const installed = installedAgent(providerID)
    if (installed) await accounts.check(installed)
  }

  async function refreshAgents(): Promise<void> {
    if (!discovery.supported) return
    readingPi.value = true
    try {
      const [, account] = await Promise.all([discovery.refresh(true), readPi().catch(() => null)])
      piDefaultModel.value = account?.defaultModel ?? null
      piSignedIn.value = account?.signedIn ?? null
    } finally {
      readingPi.value = false
    }
    await checkAccounts()
  }

  function signInAgent(providerID: string): Promise<void> {
    const agent = installedAgent(providerID)
    return agent ? accounts.signIn(agent) : Promise.resolve()
  }

  function agentAction(providerID: string, run: (id: ACPAgentID) => Promise<void>) {
    const id = agentID(providerID)
    return id ? run(id) : Promise.resolve()
  }

  return {
    agentSetup,
    piSetup,
    mcpServerSetup,
    installAgent,
    refreshAgents,
    signInAgent,
    cancelAgentSignIn: (providerID: string) => agentAction(providerID, accounts.cancelSignIn),
    submitAgentSignInCode: (providerID: string, code: string) =>
      agentAction(providerID, (id) => accounts.submitCode(id, code)),
    setupCanvasBridge: () => discovery.setupCanvasBridge()
  }
}

/**
 * Pi's setup while `active`, checked each time it becomes active. Undefined outside the desktop
 * app, where Pi cannot run and there is nothing to check.
 */
export function usePiSetup(active: MaybeRefOrGetter<boolean>, setup = useAgentSetup()) {
  const state = computed(() => {
    const pi = toValue(active) ? setup.piSetup('harness:pi') : undefined
    return pi?.supported ? pi : undefined
  })
  watch(
    () => toValue(active),
    (on) => {
      if (on) void setup.refreshAgents()
    },
    { immediate: true }
  )
  return {
    state,
    refresh: setup.refreshAgents,
    installCompanion: () => setup.installAgent('harness:pi'),
    installBridge: setup.setupCanvasBridge
  }
}

/**
 * The MCP server's setup while `active`, checked each time it becomes active, so Settings → MCP
 * can install or update the server with one click.
 */
export function useMCPServerSetup(
  active: MaybeRefOrGetter<boolean>,
  discovery: AgentDiscovery = agentDiscovery
) {
  const setup = useAgentSetup(discovery)
  watch(
    () => toValue(active),
    (on) => {
      if (on) void discovery.refresh(true)
    },
    { immediate: true }
  )
  return {
    state: computed(() => setup.mcpServerSetup()),
    install: () => discovery.setupCanvasBridge(),
    check: () => discovery.refresh(true)
  }
}
