/**
 * src/contexts/WalletContext.test.tsx
 *
 * Unit tests for the two ways a wallet session is established or torn down in
 * WalletContext.
 *
 * Rehydration is deliberately independent for the key and the JWT: a wallet
 * connected without a creator session is the normal state for someone who
 * only came to tip, and requiring both would log them straight back out. The
 * one exception is a JWT that is already expired client-side, which is
 * dropped without a round trip.
 *
 * Teardown happens on two paths that must reach the same end state: any 401
 * broadcast through authEvents, and an explicit disconnect. A 401 also leaves
 * a message behind explaining why the user was logged out; disconnect is a
 * deliberate action and clears it.
 *
 * Covers:
 *   - A stored public key restores the connection without a JWT
 *   - An expired JWT is removed from storage and not restored
 *   - A valid JWT is restored alongside the key
 *   - emitUnauthorized clears storage and session state and sets the message
 *   - disconnect clears the same session state, including the message
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider, useWallet } from "./WalletContext";
import { emitUnauthorized } from "@/lib/authEvents";

vi.mock("@/lib/wallet", () => ({
  connectFreighter: vi.fn(),
  isFreighterInstalled: vi.fn().mockResolvedValue(true),
  signNonce: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  authApi: {
    challenge: vi.fn(),
    verify: vi.fn(),
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PK = "GD7UXR3IX276M2M4XUE3TPNKTA7PJTERTEDEGWELQQYQBBHDL2NTREFR";
const JWT_STORAGE_KEY = "novatip_jwt";
const PK_STORAGE_KEY = "novatip_pk";
const EXPIRED_MESSAGE =
  "Your session has expired. Please reconnect your wallet.";

/** Build a structurally valid JWT-shaped token with the given `exp` claim. */
function makeJwt(expSecondsFromNow: number): string {
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

/**
 * Exposes the context values as text so assertions read the state the rest of
 * the app would consume, rather than poking at internal hooks.
 */
function Harness() {
  const { publicKey, jwt, isConnected, error, disconnect } = useWallet();

  return (
    <div>
      <output data-testid="public-key">{publicKey ?? "null"}</output>
      <output data-testid="jwt">{jwt ?? "null"}</output>
      <output data-testid="connected">{String(isConnected)}</output>
      <output data-testid="error">{error ?? "null"}</output>
      <button type="button" onClick={disconnect}>
        disconnect
      </button>
    </div>
  );
}

function renderWallet() {
  return render(
    <WalletProvider>
      <Harness />
    </WalletProvider>,
  );
}

/** Wait for the mount effect to finish restoring the key, then check state. */
async function expectRestored(storedJwt: string | null) {
  await waitFor(() =>
    expect(screen.getByTestId("public-key")).toHaveTextContent(PK),
  );
  await waitFor(() =>
    expect(screen.getByTestId("jwt")).toHaveTextContent(storedJwt ?? "null"),
  );
  expect(screen.getByTestId("connected")).toHaveTextContent("true");
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// ── Rehydration ───────────────────────────────────────────────────────────────

describe("WalletContext – rehydration", () => {
  it("restores a stored public key without requiring a JWT", async () => {
    localStorage.setItem(PK_STORAGE_KEY, PK);

    renderWallet();

    await expectRestored(null);
    expect(localStorage.getItem(JWT_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId("error")).toHaveTextContent("null");
  });

  it("removes an already-expired JWT instead of restoring it", async () => {
    const expired = makeJwt(-60);
    localStorage.setItem(PK_STORAGE_KEY, PK);
    localStorage.setItem(JWT_STORAGE_KEY, expired);

    renderWallet();

    // The key still marks the wallet connected; only the dead session is
    // dropped, so a tipper is not disconnected for having no creator session.
    await expectRestored(null);
    expect(localStorage.getItem(JWT_STORAGE_KEY)).toBeNull();
  });

  it("restores a valid JWT alongside the key", async () => {
    const valid = makeJwt(60 * 60);
    localStorage.setItem(PK_STORAGE_KEY, PK);
    localStorage.setItem(JWT_STORAGE_KEY, valid);

    renderWallet();

    await expectRestored(valid);
    expect(localStorage.getItem(JWT_STORAGE_KEY)).toBe(valid);
    expect(screen.getByTestId("error")).toHaveTextContent("null");
  });
});

// ── Teardown ──────────────────────────────────────────────────────────────────

describe("WalletContext – session teardown", () => {
  it("clears the session and explains why when a 401 is broadcast", async () => {
    const valid = makeJwt(60 * 60);
    localStorage.setItem(PK_STORAGE_KEY, PK);
    localStorage.setItem(JWT_STORAGE_KEY, valid);

    renderWallet();
    await expectRestored(valid);

    act(() => emitUnauthorized());

    expect(screen.getByTestId("public-key")).toHaveTextContent("null");
    expect(screen.getByTestId("jwt")).toHaveTextContent("null");
    expect(screen.getByTestId("connected")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent(EXPIRED_MESSAGE);

    expect(localStorage.getItem(PK_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(JWT_STORAGE_KEY)).toBeNull();
  });

  it("clears the same session state on disconnect, without an expiry message", async () => {
    const valid = makeJwt(60 * 60);
    localStorage.setItem(PK_STORAGE_KEY, PK);
    localStorage.setItem(JWT_STORAGE_KEY, valid);

    renderWallet();
    await expectRestored(valid);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "disconnect" }));

    expect(screen.getByTestId("public-key")).toHaveTextContent("null");
    expect(screen.getByTestId("jwt")).toHaveTextContent("null");
    expect(screen.getByTestId("connected")).toHaveTextContent("false");

    // Leaving on purpose is not a failure, so there is no session-expired
    // message to show the user afterwards.
    expect(screen.getByTestId("error")).toHaveTextContent("null");

    expect(localStorage.getItem(PK_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(JWT_STORAGE_KEY)).toBeNull();
  });
});
