// Render-level tests for RunOverlay's three new terminal states (empty /
// partial_failure / total_failure) + the legacy "error" path. Covers title
// copy, per-source glyph mapping, action buttons, and the Try N days
// boundary at 90.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PulseOutcome, SourceKindStatus } from "../../services/pulseOutcome";
import { RunOverlay, type RunState } from "../RunOverlay";

// ---- Fixtures -------------------------------------------------------------

function okData(kind: SourceKindStatus["kind"], count: number, items: number): SourceKindStatus {
  return { kind, sourceCount: count, status: "ok_data", itemCount: items };
}
function okEmpty(
  kind: SourceKindStatus["kind"],
  count: number,
  detail: string
): SourceKindStatus {
  return { kind, sourceCount: count, status: "ok_empty", detail };
}
function errSource(
  kind: SourceKindStatus["kind"],
  count: number,
  failedCount: number,
  detail: string,
  errorKind: Extract<SourceKindStatus, { status: "error" }>["errorKind"] = "not_in_channel"
): SourceKindStatus {
  return {
    kind,
    sourceCount: count,
    status: "error",
    errorKind,
    detail,
    failedCount,
    fixAction: "settings",
  };
}

function runState(outcome: PulseOutcome | null): RunState {
  return {
    stage: "done",
    outcome,
  };
}

// ---- Helpers --------------------------------------------------------------

function mountOverlay(
  outcome: PulseOutcome | null,
  overrides: Partial<React.ComponentProps<typeof RunOverlay>> = {}
) {
  const onDismiss = vi.fn();
  const onTryLongerWindow = vi.fn();
  const onFixInSettings = vi.fn();
  render(
    <RunOverlay
      state={runState(outcome)}
      onDismiss={onDismiss}
      onTryLongerWindow={onTryLongerWindow}
      onFixInSettings={onFixInSettings}
      {...overrides}
    />
  );
  return { onDismiss, onTryLongerWindow, onFixInSettings };
}

// ---- Tests ----------------------------------------------------------------

describe("RunOverlay — empty outcome", () => {
  const empty: PulseOutcome = {
    kind: "empty",
    windowDays: 14,
    sources: [
      okEmpty("github", 5, "no PRs in window"),
      okEmpty("slack", 9, "no messages"),
      okEmpty("jira", 4, "no updates"),
      okEmpty("linear", 1, "no issues"),
    ],
  };

  it("#1 title = Quiet week", () => {
    mountOverlay(empty);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /Quiet week/
    );
  });

  it("#2 all rows render as ok with describeEmpty copy", () => {
    mountOverlay(empty);
    expect(screen.getByText("no PRs in window")).toBeInTheDocument();
    expect(screen.getByText("no messages")).toBeInTheDocument();
    expect(screen.getByText("no updates")).toBeInTheDocument();
    expect(screen.getByText("no issues")).toBeInTheDocument();
  });

  it("#3 Try N days button shows doubled window and fires callback", () => {
    const { onTryLongerWindow } = mountOverlay(empty);
    const btn = screen.getByRole("button", { name: /Try 28 days/ });
    fireEvent.click(btn);
    expect(onTryLongerWindow).toHaveBeenCalledWith(28);
  });

  it("#4 Fix in Settings button is NOT present for empty", () => {
    mountOverlay(empty);
    expect(
      screen.queryByRole("button", { name: /Fix in Settings/ })
    ).toBeNull();
  });

  it("#5 Adjust sources button fires onFixInSettings with no focus kind", () => {
    const { onFixInSettings } = mountOverlay(empty);
    fireEvent.click(screen.getByRole("button", { name: /Adjust sources/ }));
    expect(onFixInSettings).toHaveBeenCalledTimes(1);
    // Called with no args (the button passes nothing through).
    expect(onFixInSettings.mock.calls[0]).toEqual([]);
  });

  it("#6 stage checklist is NOT in DOM", () => {
    mountOverlay(empty);
    // Labels render as "Gathering" / "Writing" (CSS uppercases for display).
    expect(screen.queryByText(/^Gathering$/)).toBeNull();
    expect(screen.queryByText(/^Writing$/)).toBeNull();
  });

  it("#7 Try N days disabled at windowDays=90 with tooltip", () => {
    mountOverlay({ ...empty, windowDays: 90 });
    const btn = screen.getByRole("button", { name: /90 days max/ });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toMatch(/max 90-day/);
  });

  it("#8 doubles but caps at 90 — windowDays=60 → next=90", () => {
    const { onTryLongerWindow } = mountOverlay({ ...empty, windowDays: 60 });
    const btn = screen.getByRole("button", { name: /Try 90 days/ });
    fireEvent.click(btn);
    expect(onTryLongerWindow).toHaveBeenCalledWith(90);
  });
});

describe("RunOverlay — partial_failure outcome", () => {
  const partialOne: PulseOutcome = {
    kind: "partial_failure",
    windowDays: 14,
    sources: [
      errSource("slack", 9, 9, "bot not in channel — invite @Keepr to each"),
      okEmpty("github", 5, "no PRs in window"),
      okEmpty("jira", 4, "no updates"),
      okEmpty("linear", 1, "no issues"),
    ],
  };

  const partialTwo: PulseOutcome = {
    kind: "partial_failure",
    windowDays: 14,
    sources: [
      errSource("slack", 9, 9, "bot not in channel — invite @Keepr to each"),
      errSource("jira", 4, 4, "token rejected or expired", "unauthorized"),
      okEmpty("github", 5, "no PRs in window"),
      okEmpty("linear", 1, "no issues"),
    ],
  };

  it("#1 single broken kind — title names the kind", () => {
    mountOverlay(partialOne);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /Couldn't reach your Slack/
    );
  });

  it("#2 multiple broken kinds — title pluralizes with count", () => {
    mountOverlay(partialTwo);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /Couldn't reach 2 of your sources/
    );
  });

  it("#3 single broken kind — Fix in Settings passes that kind as focus", () => {
    const { onFixInSettings } = mountOverlay(partialOne);
    fireEvent.click(screen.getByRole("button", { name: /Fix in Settings/ }));
    expect(onFixInSettings).toHaveBeenCalledWith("slack");
  });

  it("#4 multiple broken kinds — Fix in Settings passes undefined", () => {
    const { onFixInSettings } = mountOverlay(partialTwo);
    fireEvent.click(screen.getByRole("button", { name: /Fix in Settings/ }));
    expect(onFixInSettings).toHaveBeenCalledWith(undefined);
  });

  it("#5 Try N days button IS available on partial_failure", () => {
    mountOverlay(partialOne);
    expect(
      screen.getByRole("button", { name: /Try 28 days/ })
    ).toBeInTheDocument();
  });

  it("#6 error row renders the classifier detail (a11y aria-label warning)", () => {
    mountOverlay(partialOne);
    expect(
      screen.getByText(/bot not in channel — invite @Keepr to each/)
    ).toBeInTheDocument();
    // Row a11y label should name it as a warning (not error) for partial.
    const row = screen.getByLabelText(/Slack.*warning/i);
    expect(row).toBeInTheDocument();
  });

  it("#7 healthy rows still show ok details alongside the broken one", () => {
    mountOverlay(partialOne);
    expect(screen.getByText("no PRs in window")).toBeInTheDocument();
    expect(screen.getByText("no updates")).toBeInTheDocument();
  });
});

describe("RunOverlay — total_failure outcome", () => {
  const total: PulseOutcome = {
    kind: "total_failure",
    windowDays: 14,
    sources: [
      errSource("github", 5, 5, "token rejected or expired", "unauthorized"),
      errSource("slack", 9, 9, "token rejected — paste a fresh one", "invalid_auth"),
      errSource("jira", 4, 4, "token rejected or expired", "unauthorized"),
      errSource("linear", 1, 1, "API key rejected — paste a fresh one", "unauthorized"),
    ],
  };

  it("#1 title = Keepr couldn't reach any sources", () => {
    mountOverlay(total);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /couldn't reach any sources/i
    );
  });

  it("#2 Try N days button is NOT available", () => {
    mountOverlay(total);
    expect(screen.queryByRole("button", { name: /Try \d+ days/ })).toBeNull();
  });

  it("#3 all rows have danger aria-label (not warning)", () => {
    mountOverlay(total);
    expect(screen.getByLabelText(/GitHub.*error/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Slack.*error/i)).toBeInTheDocument();
  });

  it("#4 Fix in Settings is the primary action", () => {
    const { onFixInSettings } = mountOverlay(total);
    fireEvent.click(screen.getByRole("button", { name: /Fix in Settings/ }));
    // Multiple broken kinds → no focus.
    expect(onFixInSettings).toHaveBeenCalledWith(undefined);
  });
});

describe("RunOverlay — legacy error path (no-sources-configured)", () => {
  it("#1 stage=error with error string still renders 'Something went sideways' heading", () => {
    const onDismiss = vi.fn();
    render(
      <RunOverlay
        state={{
          stage: "error",
          error: "No data sources selected. Open Settings and connect at least one…",
        }}
        onDismiss={onDismiss}
      />
    );
    expect(screen.getByText(/Something went sideways/)).toBeInTheDocument();
    // Error text appears twice (top detail + bottom bullet). Use getAllByText.
    const matches = screen.getAllByText(/No data sources selected/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("#2 Dismiss button fires onDismiss on legacy error", () => {
    const onDismiss = vi.fn();
    render(
      <RunOverlay
        state={{ stage: "error", error: "boom" }}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("RunOverlay — running progress (unchanged)", () => {
  it("#1 running state renders the stage label and checklist", () => {
    render(
      <RunOverlay
        state={{ stage: "map", detail: "summarizing #eng" }}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/Summarizing…/)).toBeInTheDocument();
    // Labels render in DOM as "Gathering" / "Writing"; CSS uppercases them
    // visually. Check the DOM text, not the rendered-case text.
    expect(screen.getByText(/^Gathering$/)).toBeInTheDocument();
    expect(screen.getByText(/^Writing$/)).toBeInTheDocument();
  });
});
