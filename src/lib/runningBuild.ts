// #1048 — the build the running app was built from, short form for display.
declare const __BUILD_COMMIT__: string;

export const runningCommit = __BUILD_COMMIT__.slice(0, 7);
