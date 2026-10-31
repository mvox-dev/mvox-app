// #1048 — the build the running app was built from, short form for display.
declare const __BUILD_COMMIT__: string;

export const runningBuildCommit: string = __BUILD_COMMIT__;

export const runningCommit = runningBuildCommit.slice(0, 7);
