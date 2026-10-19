/**
 * src/components/TipChart.test.tsx
 *
 * Unit tests for TipChart's text alternative.
 *
 * The SVG itself is aria-hidden, so these tests deliberately query the
 * visually hidden table that carries the daily values. They cover the parts
 * that can drift out of sync with the chart: the selected mode, the selected
 * window, and gap-filled zero-activity days.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TipChart } from "./TipChart";

const timeSeries = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  analyticsApi: { timeSeries },
}));

const JWT = "test-jwt";

/** Same date arithmetic as the component's fillSeries, so fixtures align. */
function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function seriesWithTwoActiveDays() {
  return {
    series: [
      { date: isoDaysAgo(0), tipCount: 2, amountRaw: "15000000" }, // 1.50 USDC
      { date: isoDaysAgo(1), tipCount: 3, amountRaw: "25000000" }, // 2.50 USDC
    ],
  };
}

function rowFor(table: HTMLElement, date: string): HTMLElement {
  const time = table.querySelector(`time[dateTime="${date}"]`);
  if (!time) throw new Error(`No row for ${date}`);
  return time.closest("tr") as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TipChart – text alternative", () => {
  it("exposes every daily count as text for the default 30-day window", async () => {
    timeSeries.mockResolvedValue(seriesWithTwoActiveDays());

    render(<TipChart jwt={JWT} />);

    const table = await screen.findByRole("table", {
      name: /daily tip count over the last 30 days/i,
    });

    // One header row plus one row per calendar day in the window.
    expect(within(table).getAllByRole("row")).toHaveLength(31);

    expect(within(rowFor(table, isoDaysAgo(0))).getByText("2")).toBeInTheDocument();
    expect(within(rowFor(table, isoDaysAgo(1))).getByText("3")).toBeInTheDocument();

    // Days with no tips are still described, not silently omitted.
    expect(within(rowFor(table, isoDaysAgo(10))).getByText("0")).toBeInTheDocument();
  });

  it("switches the table to USDC amounts when the mode changes", async () => {
    timeSeries.mockResolvedValue(seriesWithTwoActiveDays());
    const user = userEvent.setup();

    render(<TipChart jwt={JWT} />);
    await screen.findByRole("table", {
      name: /daily tip count over the last 30 days/i,
    });

    await user.click(screen.getByRole("button", { name: "USDC" }));

    const table = await screen.findByRole("table", {
      name: /daily usdc earned over the last 30 days/i,
    });
    expect(within(table).getByRole("columnheader", { name: "USDC earned" })).toBeInTheDocument();
    expect(within(rowFor(table, isoDaysAgo(0))).getByText("$1.50")).toBeInTheDocument();
    expect(within(rowFor(table, isoDaysAgo(1))).getByText("$2.50")).toBeInTheDocument();
  });

  it("follows the selected window", async () => {
    timeSeries.mockResolvedValue(seriesWithTwoActiveDays());
    const user = userEvent.setup();

    render(<TipChart jwt={JWT} />);
    await screen.findByRole("table", {
      name: /daily tip count over the last 30 days/i,
    });

    await user.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() =>
      expect(timeSeries).toHaveBeenLastCalledWith(JWT, 7, expect.any(Object)),
    );

    const table = await screen.findByRole("table", {
      name: /daily tip count over the last 7 days/i,
    });
    // One header row plus seven daily rows.
    expect(within(table).getAllByRole("row")).toHaveLength(8);
  });
});
