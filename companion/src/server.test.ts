import { describe, expect, it } from "vitest";
import { resolveActualPort } from "./server.js";

describe("resolveActualPort", () => {
  it("returns the TCP port from an AddressInfo (e.g. --port 0 ephemeral)", () => {
    expect(
      resolveActualPort({ address: "127.0.0.1", family: "IPv4", port: 19876 }, 19750),
    ).toBe(19876);
  });

  it("falls back to the requested port for non-TCP or missing addresses", () => {
    expect(resolveActualPort("/tmp/companion.sock", 19750)).toBe(19750);
    expect(resolveActualPort(null, 19750)).toBe(19750);
  });
});
