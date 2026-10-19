/**
 * src/app/dashboard/settings/page.test.tsx
 *
 * Tests for the settings page after the profile form was restored alongside
 * the slug rename card (issue #226).
 *
 * Covers the three things that make the form safe to ship:
 *   - it loads and saves display name, bio and avatar through updateProfile
 *   - an avatar URL that is not https is rejected before any request is made
 *   - the existing rename card still validates, checks availability and saves
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "./page";
import type { CreatorProfile } from "@/lib/api";

// next/image's runtime requires the Next image config context, none of which
// is under test here. A plain <img> preserves the src/alt we assert on.
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

const me           = vi.hoisted(() => vi.fn());
const getBySlug    = vi.hoisted(() => vi.fn());
const updateProfile = vi.hoisted(() => vi.fn());
const updateSlug   = vi.hoisted(() => vi.fn());
const checkSlug    = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    authApi:    { ...actual.authApi, me },
    creatorApi: {
      ...actual.creatorApi,
      getBySlug,
      updateProfile,
      updateSlug,
      checkSlug,
    },
  };
});

vi.mock("@/contexts/WalletContext", () => ({
  useWallet: () => ({ jwt: "jwt" }),
}));

const BASE_CREATOR: CreatorProfile = {
  id:          "creator-1",
  slug:        "alice",
  displayName: "Alice",
  bio:         "Street violinist",
  avatarUrl:   null,
  jarId:       "@alice",
  splits:      [{ to: "GBOUUKWI3SUIIL75NEZMVYLYU77SIXNN2RNYMNJOJX6WXOICMMAKKKB4", bps: 10_000 }],
  createdAt:   "2026-01-01T00:00:00Z",
};

function creator(overrides: Partial<CreatorProfile> = {}): CreatorProfile {
  return { ...BASE_CREATOR, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();

  me.mockResolvedValue({
    user: { sub: "creator-1", wallet: "GBOUUKWI3SUIIL75NEZMVYLYU77SIXNN2RNYMNJOJX6WXOICMMAKKKB4", slug: "alice" },
  });
  getBySlug.mockResolvedValue({ creator: creator() });
  checkSlug.mockResolvedValue({ slug: "newslug", available: true });
  updateSlug.mockResolvedValue({ creator: creator({ slug: "newslug" }) });
});

afterEach(cleanup);

describe("SettingsPage – profile form", () => {
  it("loads the creator's current profile into the form", async () => {
    render(<SettingsPage />);

    expect(await screen.findByDisplayValue("Alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Bio")).toHaveValue("Street violinist");
    expect(screen.getByLabelText("Avatar URL")).toHaveValue("");
  });

  it("saves display name, bio and avatar through updateProfile", async () => {
    const user = userEvent.setup();
    updateProfile.mockImplementation(async (_jwt, data) => ({
      creator: creator({
        displayName: data.displayName ?? null,
        bio:         data.bio         ?? null,
        avatarUrl:   data.avatarUrl   ?? null,
      }),
    }));

    render(<SettingsPage />);

    const name = await screen.findByDisplayValue("Alice");
    await user.clear(name);
    await user.type(name, "Alice Updated");

    const bio = screen.getByLabelText("Bio");
    await user.clear(bio);
    await user.type(bio, "New bio");

    await user.type(
      screen.getByLabelText("Avatar URL"),
      "https://example.com/avatar.png",
    );

    await user.click(
      screen.getByRole("button", { name: "Save profile changes" }),
    );

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith("jwt", {
        displayName: "Alice Updated",
        bio:         "New bio",
        avatarUrl:   "https://example.com/avatar.png",
      }),
    );
    expect(await screen.findByText(/Profile saved/)).toBeInTheDocument();
  });

  it("rejects a non-https avatar URL before sending anything", async () => {
    const user = userEvent.setup();

    render(<SettingsPage />);

    const avatar = await screen.findByLabelText("Avatar URL");
    await user.type(avatar, "http://example.com/avatar.png");
    await user.tab();

    expect(
      await screen.findByText("Avatar URL must start with https://"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save profile changes" }),
    ).toBeDisabled();
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

describe("SettingsPage – slug rename", () => {
  it("still checks availability and renames the slug", async () => {
    const user = userEvent.setup();

    render(<SettingsPage />);
    await screen.findByDisplayValue("Alice");

    await user.type(screen.getByLabelText("New slug"), "newslug");
    expect(
      await screen.findByText("Available ✓", {}, { timeout: 3000 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Rename to @newslug" }));

    await waitFor(() =>
      expect(updateSlug).toHaveBeenCalledWith("jwt", "newslug"),
    );
    expect(
      await screen.findByText("Slug renamed successfully!"),
    ).toBeInTheDocument();
  });
});
