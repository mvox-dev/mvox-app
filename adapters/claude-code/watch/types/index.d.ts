// The watch mod's $.state contract. Self-contained: no imports.

declare module 'claude-code' {
  interface PluginState {
    watch: {
      /** The session's working directory at its first session.start: the default kit home. */
      startCwd: string
      /** Each watched file's last-seen size, by expanded path: growth past it rings the doorbell. */
      bellSizes: Record<string, number>
      /** Context marks already reported this session: once per mark, reloads included. */
      reportedMarks: number[]
    }
  }
}
