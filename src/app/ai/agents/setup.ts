import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { ACP_AGENTS, type ACPAgentDef, type ACPAgentID } from '@open-pencil/core/constants'

import { isSignedIn } from '@/app/ai/acp/auth/status'
import { readPiAccount } from '@/app/ai/harness/pi-settings'
import { MCP_INSTALL_COMMAND } from '@/app/automation/mcp/failure'
import { detectUserAgent } from '@/app/tauri/command'

import { agentAccounts, type AgentAccount } from './accounts'
import { agentDiscovery, type DetectedAgent, type DiscoveryError } from './discovery'

type AgentDiscovery = typeof agentDiscovery
type AgentAccounts = typeof agentAccounts

/** What setup knows about one coding agent and the MCP server it needs. */
export interface AgentSetupState {
  /** False where agents cannot run, so only manual instructions apply. */
  supported: boolean
  /** A check has finished, so a later one keeps showing its results. */
  checked: boolean
  scanning: boolean
  detected: DetectedAgent | null
  /** OpenPencil's MCP server, through which agents reach the canvas. */
  bridge: boolean
  /** The installed MCP server does not match this app's version. */
  bridgeOutdated: boolean
  /** Installs or updates the MCP server by hand. */
  bridgeCommand: string
  /** npm, which one-click installation runs. */
  npm: boolean
  /** Installing the MCP server or the agent's adapter needs administrator rights; absent means no. */
  bridgeNeedsAdmin?: boolean
  /**
   * One click can install or update the MCP server with the package manager that would run,
   * which may be Bun without npm; absent means npm decides.
   */
  bridgeInstallable?: boolean
  adapterNeedsAdmin?: boolean
  installingAgent: boolean
  installingBridge: boolean
  error: DiscoveryError | null
  /** The account the agent uses, read from the agent once its adapter is installed. */
  account?: AgentAccount
}

/** What setup knows about Pi: the Harness companion that runs it and Pi's own settings. */
export interface PiSetupState {
  supported: boolean
  checked: boolean
  scanning: boolean
  /** The `openpencil-harness` companion that runs Pi. */
  companion: boolean
  companionOutdated: boolean
  companionCommand: string
  bridge: boolean
  bridgeOutdated: boolean
  bridgeCommand: string
  npm: boolean
  /** Installing the companion or the MCP server needs administrator rights; absent means no. */
  companionNeedsAdmin?: boolean
  bridgeNeedsAdmin?: boolean
  /** One click can install or update each, as `AgentSetupState.bridgeInstallable` says. */
  companionInstallable?: boolean
  bridgeInstallable?: boolean
  installingCompanion: boolean
  installingBridge: boolean
  /** The default model set in Pi, used unless OpenPencil names another. */
  defaultModel: string | null
  /** Pi keeps sign-ins; null until read or where they cannot be read. */
  signedIn?: boolean | null
  error: DiscoveryError | null
}

/** What setup knows about OpenPencil's MCP server on its own, for Settings → MCP. */
export type MCPServerSetupState = Pick<
  AgentSetupState,
  | 'supported'
  | 'checked'
  | 'bridge'
  | 'bridgeOutdated'
  | 'bridgeCommand'
  | 'npm'
  | 'bridgeNeedsAdmin'
  | 'bridgeInstallable'
  | 'installingBridge'
  | 'error'
>

/** An OpenPencil companion as setup presents it, with the one-click fix that applies. */
export interface CompanionCheck {
  /** Installed and matching this app. */
  ready: boolean
  outdated: boolean
  installing: boolean
  /** Absent once ready, and where one-click installation cannot run or needs administrator rights. */
  action: 'install' | 'update' | null
}

/** Why setup cannot finish on its own, in the order the person should address it. */
export type SetupProblem =
  | 'needs-npm'
  | 'needs-admin'
  | 'install-failed'
  | 'mcp-start-failed'
  | 'lookup-failed'

function companionCheck(
  installed: boolean,
  outdated: boolean,
  installing: boolean,
  npm: boolean
): CompanionCheck {
  const ready = installed && !outdated
  if (ready || !npm) return { ready, outdated, installing, action: null }
  return { ready, outdated, installing, action: outdated ? 'update' : 'install' }
}

/** One-click availability: what discovery reports, or npm without administrator rights. */
function oneClickInstallable(
  installable: boolean | undefined,
  npm: boolean,
  admin: boolean
): boolean {
  return installable ?? (npm && !admin)
}

function setupProblem(
  error: DiscoveryError | null,
  needsNpm: boolean,
  installErrors: readonly DiscoveryError[],
  needsAdmin = false
): SetupProblem | null {
  if (error === 'npm' || needsNpm) return 'needs-npm'
  if (error === 'npm-admin' || needsAdmin) return 'needs-admin'
  if (error !== null && installErrors.includes(error)) return 'install-failed'
  if (error === 'canvas-start') return 'mcp-start-failed'
  if (error === 'lookup') return 'lookup-failed'
  return null
}

/** A coding agent's setup: its CLI and adapter, the MCP server, and what to run by hand. */
export interface AgentSetupView {
  bridge: CompanionCheck
  /** The adapter can be installed with one click. */
  canInstallAdapter: boolean
  busy: boolean
  problem: SetupProblem | null
  /** Commands for where one-click installation cannot help. */
  manualAgentCommand: string | null
  manualBridgeCommand: string | null
  /** The agent's account; null where the agent cannot run yet or does not report one. */
  account: AgentAccountView | null
  /**
   * The program on PATH under the adapter's name is another adapter, such as an older one
   * published under another package, so it neither reports nor signs in to the account.
   */
  adapterMismatch: boolean
}

/** The agent's account as setup shows it. */
export interface AgentAccountView {
  state: 'checking' | 'signed-in' | 'signed-out' | 'signing-in' | 'unknown'
  /** The plan or login type the agent names, such as "Claude Max". */
  label: string | null
  /** The account's email, or the agent's own detail line. */
  detail: string | null
  /** One click can sign in, through the agent's own login. */
  canSignIn: boolean
  /** A sign-in page to open by hand while signing in. */
  signInURL: string | null
  acceptsCode: boolean
  error: AgentAccount['error']
  /**
   * Whether a signed-in agent's session reached OpenPencil's tools, with the agent's reason when
   * it did not; null when signed out or when the MCP server cannot report it.
   */
  tools: { state: 'checking' | 'connected' | 'unreachable'; reason: string | null } | null
}

function toolsView(account: AgentAccount, signedIn: boolean): AgentAccountView['tools'] {
  if (!signedIn) return null
  if (account.checking) return { state: 'checking', reason: null }
  const tools = account.tools
  if (tools?.connected === true) return { state: 'connected', reason: null }
  if (tools?.connected === false) return { state: 'unreachable', reason: tools.reason }
  return null
}

function accountState(account: AgentAccount): AgentAccountView['state'] | null {
  if (account.signingIn) return 'signing-in'
  if (account.status === undefined) {
    if (account.checking) return 'checking'
    return account.error ? 'unknown' : null
  }
  if (account.status === null) return account.error ? 'unknown' : null
  return isSignedIn(account.status) ? 'signed-in' : 'signed-out'
}

function accountView(setup: AgentSetupState, mismatch: boolean): AgentAccountView | null {
  const account = setup.account
  if (!account || mismatch || setup.detected?.status !== 'available') return null
  const state = accountState(account)
  if (!state) return null
  const status = account.status
  const signedIn = state === 'signed-in'
  return {
    state,
    label: signedIn ? (status?.label ?? null) : null,
    detail: signedIn ? (status?.account?.email ?? status?.detail ?? null) : null,
    canSignIn: state === 'signed-out' && account.canSignIn,
    signInURL: account.signInURL,
    acceptsCode: account.acceptsCode,
    error: account.error,
    tools: toolsView(account, signedIn)
  }
}

function adapterMismatch(agent: ACPAgentDef, setup: AgentSetupState): boolean {
  const adapter = setup.account?.adapter
  return Boolean(agent.adapterPackage && adapter && adapter.name !== agent.adapterPackage)
}

/** The agent's install command to run by hand, or null where one click installs its adapter. */
function manualAgentCommand(agent: ACPAgentDef, setup: AgentSetupState): string | null {
  if (!agent.installCommand || setup.detected?.status === 'available') return null
  const admin = setup.adapterNeedsAdmin === true
  const oneClick = setup.supported && setup.npm && !admin && setup.error !== 'install'
  if (oneClick && agent.adapterPackage) return null
  return admin && !detectUserAgent().includes('Windows')
    ? `sudo ${agent.installCommand}`
    : agent.installCommand
}

/** The MCP server's install command to run by hand, or null where one click installs it. */
function manualBridgeCommand(setup: AgentSetupState, bridge: CompanionCheck): string | null {
  if (!setup.supported) return MCP_INSTALL_COMMAND
  const oneClick =
    oneClickInstallable(setup.bridgeInstallable, setup.npm, setup.bridgeNeedsAdmin === true) &&
    setup.error !== 'canvas-install'
  return bridge.ready || oneClick ? null : setup.bridgeCommand
}

export function agentSetupView(agent: ACPAgentDef, setup: AgentSetupState): AgentSetupView {
  const bridgeAdmin = setup.bridgeNeedsAdmin === true
  const adapterAdmin = setup.adapterNeedsAdmin === true
  const bridgeInstallable = oneClickInstallable(setup.bridgeInstallable, setup.npm, bridgeAdmin)
  const bridge = companionCheck(
    setup.bridge,
    setup.bridgeOutdated,
    setup.installingBridge,
    bridgeInstallable
  )
  const status = setup.detected?.status
  const bridgeMissing = setup.detected !== null && !bridge.ready
  const needsNpm =
    !setup.npm &&
    (status === 'needs-adapter' || (bridgeMissing && !bridgeInstallable && !bridgeAdmin))
  const needsAdmin = (status === 'needs-adapter' && adapterAdmin) || (bridgeMissing && bridgeAdmin)
  const mismatch = status === 'available' && adapterMismatch(agent, setup)
  return {
    bridge,
    canInstallAdapter: status === 'needs-adapter' && setup.npm && !adapterAdmin,
    busy: setup.installingAgent || setup.installingBridge,
    problem: setupProblem(setup.error, needsNpm, ['install', 'canvas-install'], needsAdmin),
    manualAgentCommand: mismatch
      ? (agent.installCommand ?? null)
      : manualAgentCommand(agent, setup),
    manualBridgeCommand: manualBridgeCommand(setup, bridge),
    account: accountView(setup, mismatch),
    adapterMismatch: mismatch
  }
}

/** The MCP server's setup: the one-click fix, and the command for when one click cannot help. */
export interface MCPServerSetupView {
  bridge: CompanionCheck
  problem: SetupProblem | null
  /** Installs the server by hand, by the person or their agent, when one click cannot. */
  manualCommand: string | null
}

export function mcpServerSetupView(setup: MCPServerSetupState): MCPServerSetupView {
  const admin = setup.bridgeNeedsAdmin === true
  const installable =
    setup.supported && oneClickInstallable(setup.bridgeInstallable, setup.npm, admin)
  const bridge = companionCheck(
    setup.bridge,
    setup.bridgeOutdated,
    setup.installingBridge,
    installable
  )
  const oneClick = installable && setup.error !== 'canvas-install'
  let manualCommand: string | null = null
  if (!setup.supported) manualCommand = MCP_INSTALL_COMMAND
  else if (setup.checked && !bridge.ready && !oneClick) manualCommand = setup.bridgeCommand
  return {
    bridge,
    // Where the app cannot install at all, npm and install problems are not the person's to fix.
    problem: setup.supported
      ? setupProblem(
          setup.error,
          setup.checked && !setup.npm && !bridge.ready && !installable && !admin,
          ['canvas-install'],
          setup.checked && admin && !bridge.ready
        )
      : null,
    manualCommand
  }
}

/** Pi's setup: the Harness companion, the MCP server, and what to run by hand. */
export interface PiSetupView {
  companion: CompanionCheck
  bridge: CompanionCheck
  busy: boolean
  problem: SetupProblem | null
  manualCommands: string[]
}

/** One companion as Pi's setup weighs it: its check and what blocks a one-click install. */
function piCompanion(
  installed: boolean,
  outdated: boolean,
  installing: boolean,
  installable: boolean | undefined,
  npm: boolean,
  needsAdmin: boolean | undefined
) {
  const admin = needsAdmin === true
  const oneClick = oneClickInstallable(installable, npm, admin)
  const check = companionCheck(installed, outdated, installing, oneClick)
  return {
    check,
    /** Missing, and nothing that runs without npm can install it. */
    needsNpm: !check.ready && !oneClick && !admin,
    needsAdmin: !check.ready && admin,
    /** Missing, and only a command run by hand installs it. */
    manual: !check.ready && !oneClick
  }
}

export function piSetupView(setup: PiSetupState): PiSetupView {
  const harness = piCompanion(
    setup.companion,
    setup.companionOutdated,
    setup.installingCompanion,
    setup.companionInstallable,
    setup.npm,
    setup.companionNeedsAdmin
  )
  const server = piCompanion(
    setup.bridge,
    setup.bridgeOutdated,
    setup.installingBridge,
    setup.bridgeInstallable,
    setup.npm,
    setup.bridgeNeedsAdmin
  )
  const needsAdmin = setup.checked && (harness.needsAdmin || server.needsAdmin)
  const failed = setup.error === 'harness-install' || setup.error === 'canvas-install'
  const manual = harness.manual || server.manual || needsAdmin || failed
  return {
    companion: harness.check,
    bridge: server.check,
    busy: setup.installingCompanion || setup.installingBridge,
    problem: setupProblem(
      setup.error,
      setup.checked && !setup.npm && (harness.needsNpm || server.needsNpm),
      ['harness-install', 'canvas-install'],
      needsAdmin
    ),
    manualCommands: manual
      ? [
          ...(harness.check.ready ? [] : [setup.companionCommand]),
          ...(server.check.ready ? [] : [setup.bridgeCommand])
        ]
      : []
  }
}

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
