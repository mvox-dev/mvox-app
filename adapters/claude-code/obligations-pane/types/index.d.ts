// The memory pane's $.state contract (the obligations pane until kit #43). Self-contained: no imports.

/** One obligation as parsed from memory/obligations.yaml, plus the line its item starts on. */
export type ObligationRow = {
  obligation: string
  actor: string
  /** Who is waiting (kit #29); '' on a row without one. */
  owed_to: string
  since: string
  check: string
  expires: string
  ref: string
  /** 1-based line of the item's "- " in the file: file order for ties, and the row key. */
  line: number
}

/** The memory pane's tabs (kit #43): Obligations, Next (the scratchpad), Commitments, Rules,
 *  Lessons, Facts, Keys, Secrets. */
export type TabId = 'O' | 'N' | 'C' | 'R' | 'L' | 'F' | 'K' | 'S'

export type LessonFilter = 'all' | 'hooked' | 'linted' | 'recognition'

/** What the pane remembers per home ($.store): the open tab and the lessons filter. */
export type ViewChoice = { tab: TabId; lessons: LessonFilter }

/** One line of a tab's body (every tab but Obligations, which keeps its own rows). */
export type ViewLine = {
  key: string
  /** Drawn first, bold (a label, a number, a date, a subject); '' for none. */
  tag: string
  /** The line's text; every urls/<name> in it is a link. */
  text: string
  /** Drawn dim after the text (who, when, how to revoke); '' for none. */
  note: string
  /** The whole line drawn dim (a stale fact). */
  dim: boolean
  /** A group heading (a scratchpad section, a facts subject). */
  heading: boolean
  /** Drawn in red after the note: what is off with this line; '' for nothing. */
  flag: string
  /** The line links here (a lesson's file); '' for no link. */
  href: string
}

/** A tab's body: its lines and the header's count, or one message in place of them. */
export type TierView =
  | { kind: 'ok'; count: string; lines: ViewLine[]; banner: string }
  | { kind: 'missing'; message: string }
  | { kind: 'error'; message: string }

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
  /** 'pointer': the start folder's memory-kit.conf names no usable home: its kit_home pointer is broken
   *  (kit #18), or it or the conf it names gives a key twice (kit #55). `error` says why, `path` is that conf. */
  source: 'ok' | 'missing' | 'error' | 'pointer'
  /** For source 'error': what went wrong, with the line when known. */
  error: string
  items: ObligationRow[]
  /** urls/<name> -> URL, for every name the items cite that resolved. */
  urls: Record<string, string>
  /** kit #42: the note when the home came from a memory-kit.conf above the start folder; '' otherwise. */
  foundAbove: string
  /** The resolved home: the key the open tab is remembered by (kit #43). */
  home: string
  /** The tab this snapshot's `tier` was read for. */
  tab: TabId
  /** The open tab's view; null on the Obligations tab, which reads `items`. */
  tier: TierView | null
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

/** One workflow run as the footer tracks it, keyed by its run id (`wf_…`). */
export type WorkflowRun = {
  /** From the run's saved script `<name>-<runId>.js`; '' until found (the footer shows the run id). */
  name: string
  /** The phase the run's journal names for its latest started agent; '' when unread. */
  phase: string
  /** The label (agent description) of the run's latest started agent: the phase fallback. */
  label: string
  /** agentIds started, in order. */
  started: string[]
  /** agentIds finished (turn.complete), in order. */
  done: string[]
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
      /** runId -> run, from agent.spawn's `workflow` tag and turn.complete (workflow agents are not in agent.list). */
      workflows: Record<string, WorkflowRun>
      /** The open tab and the lessons filter (kit #43), loaded from $.store for `choiceHome`. */
      choice: ViewChoice
      /** The home whose stored choice `choice` holds; '' before the first refresh. */
      choiceHome: string
    }
  }
}
