import { broadcastAuthSessionSwap, isAuthSessionSwapMessage } from "./auth-session-sync";

describe("auth session synchronization contract", () => {
  it("accepts only internal dashboard swap destinations", () => {
    expect(isAuthSessionSwapMessage({
      type: "auth-session-swapped",
      sourceTabId: "tab-a",
      destination: "/admin/tenants",
    })).toBe(true);
    expect(isAuthSessionSwapMessage({
      type: "auth-session-swapped",
      sourceTabId: "tab-a",
      destination: "https://evil.example/admin",
    })).toBe(false);
    expect(isAuthSessionSwapMessage({
      type: "auth-session-swapped",
      sourceTabId: "tab-a",
      destination: "//evil.example/admin",
    })).toBe(false);
  });

  it("publishes the complete swap only after the caller has chosen a destination", () => {
    const messages: unknown[] = [];
    const close = jest.fn();
    const storage = new Map<string, string>();
    class FakeBroadcastChannel {
      constructor(public readonly name: string) {}
      postMessage(message: unknown) { messages.push(message); }
      close() { close(); }
    }
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: FakeBroadcastChannel,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });

    broadcastAuthSessionSwap("/admin/tenants");

    expect(messages).toEqual([
      expect.objectContaining({
        type: "auth-session-swapped",
        destination: "/admin/tenants",
      }),
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
