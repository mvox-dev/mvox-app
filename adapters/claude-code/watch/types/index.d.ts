// The watch mod's $.state contract. Self-contained: no imports.

declare module 'claude-code' {
  interface PluginState {
    watch: {
      /** The session's working directory at its first session.start: the default kit home. */
      startCwd: string
      /** When this session was asked to checkpoint and retire (0: never). Guard 3: once per session. */
      askedAt: number
      /** Whether the "still here an hour after the ask" notice went out. */
      survivedNotified: boolean
    }
  }
}

