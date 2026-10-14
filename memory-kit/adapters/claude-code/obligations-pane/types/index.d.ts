// The obligations pane's $.state contract. Self-contained: no imports.

/** One obligation as parsed from memory/obligations.yaml, plus the line its item starts on. */
export type ObligationRow = {
  obligation: string
  actor: string
  since: string
  check: string
  expires: string
  ref: string
  /** 1-based line of the item's "- " in the file: file order for ties, and the row key. */
  line: number
}

/** One live subagent or teammate as the footer lists it. */
export type PaneAgent = {
  id: string
  name: string
  /** Model id or alias as the spawn resolved it; '' when unknown. */
  model: string
  status: string
}

/** A subagent's context load from its latest model step, and the model that answered it. */
export type AgentLoad = { tokens: number; model: string }

/** Everything the pane draws, gathered by one refresh. Rendering does no I/O. */
export type PaneSnapshot = {
  /** Absolute path of the obligations file this snapshot read (or looked for). */
  path: string
  source: 'ok' | 'missing' | 'error'
  /** For source 'error': what went wrong, with the line when known. */
  error: string
  items: ObligationRow[]
  /** urls/<name> -> URL, for every name the items cite that resolved. */
  urls: Record<string, string>
  /** Milliseconds since the epoch when the snapshot was taken. */
  now: number
  /** Local UTC offset in minutes east, for "today". */
  offsetMinutes: number
  /** The home's memory-kit/VERSION, line 1; '' when there is none (kit #4). */
  kitVersion: string
  /** The tags URL the release check asks; '' when none is made: checkUpdates off, no VERSION, or an unusable upstream (kit #7). */
  upstreamUrl: string
  /** The newest upstream release known for upstreamUrl, without the `v`; '' when none. */
  latest: string
  self: { name: string; model: string; tokens: number | null; window: number | null }
  agents: PaneAgent[]
}

declare module 'claude-code' {
  interface PluginState {
    'obligations-pane': {
      snapshot: PaneSnapshot | null
      /** Index of the first obligation shown (scroll position). */
      index: number
      /** agentId -> model, captured at agent.spawn (agent.list carries no model). */
      models: Record<string, string>
      /** agentId -> load of its latest turn.step (subagents only). */
      loads: Record<string, AgentLoad>
      /** The model id the main loop's latest step reported ('' before one). */
      mainModel: string
      /** The session's working directory at its first session.start: the home the pane reads. */
      startCwd: string
    }
  }
}
