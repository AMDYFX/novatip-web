/**
 * src/components/TipChart.test.tsx
 *
 * Unit tests for TipChart's window and mode controls.
 *
 * The two controls look alike but behave differently on purpose:
 *
 *   - the window selector changes what the backend is asked for, so it must
 *     refetch with the new day count
 *   - the count/USDC toggle only changes how the data already in hand is
 *     rendered, so it must not refetch
 *
 * The empty state is when every day in the window has zero tips. Note that
 * the chart still receives a full `days`-long series there: fillSeries pads
 * gaps, so the empty state is driven by `activeDays === 0`, not by an empty
 * array. The test covers exactly that path.
 *
 * Covers:
 *   - Changing the window calls analyticsApi.timeSeries with the new day count
 *   - The mode toggle reflects aria-pressed and does not refetch
 *   - A window with no tips shows the empty state instead of a chart
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TipChart } from "./TipChart";

const timeSeries = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  analyticsApi: { timeSeries },
}));

const JWT = "test-jwt";

/** A day with activity, dated today so fillSeries keeps it inside any window. */
function todayWithTips() {
  return {
    series: [
      {
        date: new Date().toISOString().slice(0, 10),
        tipCount: 3,
        amountRaw: "25000000",
      },
    ],
  };
}

beforeEach(() => {
  timeSeries.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("TipChart – window selector", () => {
  it("refetches with the new day count when the window changes", async () => {
    timeSeries.mockResolvedValue({ series: [] });
    render(<TipChart jwt={JWT} />);

    await waitFor(() =>
      expect(timeSeries).toHaveBeenCalledWith(
        JWT,
        30,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() =>
      expect(timeSeries).toHaveBeenCalledWith(
        JWT,
        7,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );

    // 30 on mount, then exactly one refetch for the chosen window.
    expect(timeSeries.mock.calls.map(([jwt, days]) => [jwt, days])).toEqual([
      [JWT, 30],
      [JWT, 7],
    ]);
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("TipChart – mode toggle", () => {
  it("reflects aria-pressed and switches modes without refetching", async () => {
    timeSeries.mockResolvedValue(todayWithTips());
    render(<TipChart jwt={JWT} />);

    // Wait for the first response to render the chart.
    await screen.findByRole("img", {
      name: /daily tip count over the last 30 days/i,
    });

    const countButton = screen.getByRole("button", { name: "Tips" });
    const amountButton = screen.getByRole("button", { name: "USDC" });

    expect(countButton).toHaveAttribute("aria-pressed", "true");
    expect(amountButton).toHaveAttribute("aria-pressed", "false");

    const user = userEvent.setup();
    await user.click(amountButton);

    expect(amountButton).toHaveAttribute("aria-pressed", "true");
    expect(countButton).toHaveAttribute("aria-pressed", "false");

    // The same series is re-rendered in USDC mode; nothing is fetched again.
    expect(
      screen.getByRole("img", {
        name: /daily USDC earned over the last 30 days/i,
      }),
    ).toBeInTheDocument();
    expect(timeSeries).toHaveBeenCalledTimes(1);
  });
});

describe("TipChart – empty state", () => {
  it("shows the empty state when no day in the window has tips", async () => {
    timeSeries.mockResolvedValue({ series: [] });
    render(<TipChart jwt={JWT} />);

    expect(
      await screen.findByText("No tips in this window yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Share your tip link to get started."),
    ).toBeInTheDocument();

    // The padded all-zero series must not be drawn as a flat chart.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
