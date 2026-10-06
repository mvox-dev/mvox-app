// @vitest-environment happy-dom
// An open `in process` card shows how long it has been in process, counted in the browser
// from when the label was set; every other card keeps its last-updated time. (*PO:Gama*)
import { afterEach, describe, expect, it, vi } from "vitest";
import { inProcessSince } from "./fetch-issues";
import { formatElapsed, renderBoard, type RoadmapIssue } from "./render";

const GENERATED_AT = "2026-10-06T18:00:00.000Z";
const SINCE = "2026-10-06T15:45:00.000Z";
const UPDATED = "2026-10-06T17:00:00.000Z";

function issue(over: Partial<RoadmapIssue> = {}): RoadmapIssue {
  return {
    number: 809,
    title: "Single-select controls become segmented pills",
    state: "open",
    stateReason: null,
    labels: [{ name: "in process", color: null }],
    body: null,
    closedAt: null,
    updatedAt: UPDATED,
    inProcessSince: SINCE,
    htmlUrl: "https://github.com/mvox-dev/mvox-app/issues/809",
    subIssues: [],
    ...over,
  };
}

function corner(html: string): Element | null {
  return new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector('article[data-issue="809"] time');
}

afterEach(() => {
  vi.useRealTimers();
});

describe("elapsed time on in-process cards", () => {
  it("an open in-process card shows the time since the label was set, not a timestamp", () => {
    const time = corner(renderBoard([issue()], GENERATED_AT));
    expect(time?.textContent).toBe("2 h 15 min");
    expect(time?.getAttribute("datetime")).toBe(SINCE);
  });

  it("a card that is not in process keeps its last-updated time", () => {
    const time = corner(
      renderBoard(
        [issue({ labels: [{ name: "ready", color: null }] })],
        GENERATED_AT,
      ),
    );
    expect(time?.getAttribute("datetime")).toBe(UPDATED);
    expect(time?.textContent).toBe("06.10.2026 20:00 GMT +3");
  });

  it("a closed card still wearing the label keeps its last-updated time", () => {
    const time = corner(
      renderBoard(
        [
          issue({
            state: "closed",
            stateReason: "completed",
            closedAt: UPDATED,
          }),
        ],
        GENERATED_AT,
      ),
    );
    expect(time?.getAttribute("datetime")).toBe(UPDATED);
  });

  it("an in-process card with no known label time keeps its last-updated time", () => {
    const time = corner(
      renderBoard([issue({ inProcessSince: null })], GENERATED_AT),
    );
    expect(time?.getAttribute("datetime")).toBe(UPDATED);
  });

  it("the page counts on in the browser: the shown time follows the clock, not the build", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval"] });
    vi.setSystemTime(new Date("2026-10-08T19:50:00.000Z"));
    const html = renderBoard([issue()], GENERATED_AT);
    const doc = new DOMParser().parseFromString(html, "text/html");
    document.body.innerHTML = doc.body.innerHTML;
    new Function(doc.querySelector("script")?.textContent ?? "")();
    const time = document.querySelector('article[data-issue="809"] time');
    expect(time?.textContent).toBe("2 p 4 h");
    vi.setSystemTime(new Date("2026-10-08T20:50:00.000Z"));
    vi.advanceTimersByTime(60000);
    expect(time?.textContent).toBe("2 p 5 h");
  });
});

describe("formatElapsed", () => {
  it("minutes under an hour, hours and minutes under a day, then days and hours", () => {
    expect(formatElapsed(0)).toBe("0 min");
    expect(formatElapsed(59 * 60000)).toBe("59 min");
    expect(formatElapsed(75 * 60000)).toBe("1 h 15 min");
    expect(formatElapsed((2 * 1440 + 4 * 60 + 30) * 60000)).toBe("2 p 4 h");
    expect(formatElapsed(-60000)).toBe("0 min");
  });
});

describe("inProcessSince", () => {
  it("is the last time `in process` was added, ignoring other labels and removals", () => {
    expect(
      inProcessSince([
        {
          event: "labeled",
          label: { name: "in process" },
          created_at: "2026-10-01T10:00:00Z",
        },
        {
          event: "unlabeled",
          label: { name: "in process" },
          created_at: "2026-10-02T10:00:00Z",
        },
        {
          event: "labeled",
          label: { name: "ready" },
          created_at: "2026-10-03T10:00:00Z",
        },
        {
          event: "labeled",
          label: { name: "in process" },
          created_at: "2026-10-04T10:00:00Z",
        },
      ]),
    ).toBe("2026-10-04T10:00:00Z");
  });

  it("is null when the label was never added", () => {
    expect(
      inProcessSince([
        { event: "labeled", label: { name: "ready" }, created_at: "x" },
      ]),
    ).toBeNull();
  });
});
