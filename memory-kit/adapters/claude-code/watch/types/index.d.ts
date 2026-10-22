// The watch mod's $.state contract. Self-contained: no imports.

declare module 'claude-code' {
  interface PluginState {
    watch: {
      /** The session's working directory at its first session.start: the default kit home. */
      startCwd: string
      /** Each watched file's last-seen size, by expanded path: growth past it rings the doorbell.
       *  A tail-style file's is also kept in $.store, per home, which a new session, having none of its own, reads (kit #51). */
      bellSizes: Record<string, number>
      /** Each watched file's last-seen text hash, by the same key: other text in its place rings (kit #52). */
      bellHashes: Record<string, number>
      /** Context marks already reported this session: once per mark, reloads included. */
      reportedMarks: number[]
    }
  }
}
