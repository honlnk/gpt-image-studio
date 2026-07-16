import { describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";
import {
  assertPublicImageUrl,
  assertPublicIpAddress,
  createPublicOnlyLookup,
  type DnsLookupAll,
} from "./outboundAddressPolicy.js";

describe("assertPublicImageUrl", () => {
  it("accepts HTTPS URLs with public literal addresses", () => {
    expect(() => assertPublicImageUrl(new URL("https://8.8.8.8/image.png"))).not.toThrow();
    expect(() =>
      assertPublicImageUrl(new URL("https://[2606:4700:4700::1111]/image.png")),
    ).not.toThrow();
  });

  it.each([
    "http://example.com/image.png",
    "file:///tmp/image.png",
    "data:image/png;base64,AA==",
    "https://user:password@example.com/image.png",
  ])("rejects unsafe URL form: %s", (url) => {
    expect(() => assertPublicImageUrl(new URL(url))).toThrow();
  });

  it.each([
    "https://127.0.0.1/image.png",
    "https://10.0.0.1/image.png",
    "https://172.16.0.1/image.png",
    "https://192.168.1.1/image.png",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/image.png",
    "https://[fe80::1]/image.png",
    "https://[fc00::1]/image.png",
    "https://[fec0::1]/image.png",
    "https://[4000::1]/image.png",
    "https://[::ffff:127.0.0.1]/image.png",
  ])("rejects non-public literal address: %s", (url) => {
    expect(() => assertPublicImageUrl(new URL(url))).toThrow(/非公网 IP/);
  });

  it.each([
    "https://2130706433/image.png",
    "https://0x7f000001/image.png",
  ])("rejects canonicalized IPv4 forms: %s", (url) => {
    expect(() => assertPublicImageUrl(new URL(url))).toThrow(/非公网 IP/);
  });
});

describe("assertPublicIpAddress", () => {
  it("rejects invalid addresses", () => {
    expect(() => assertPublicIpAddress("not-an-ip")).toThrow(/无法识别/);
  });
});

describe("createPublicOnlyLookup", () => {
  it("rejects a private DNS result", async () => {
    const lookup = createPublicOnlyLookup(makeDnsLookup([
      { address: "10.0.0.2", family: 4 },
    ]));

    await expect(runLookup(lookup, "images.example.com")).rejects.toThrow(/非公网 IP/);
  });

  it("rejects mixed public and private DNS results", async () => {
    const lookup = createPublicOnlyLookup(makeDnsLookup([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]));

    await expect(runLookup(lookup, "images.example.com")).rejects.toThrow(/非公网 IP/);
  });

  it("returns the validated public addresses to the socket lookup", async () => {
    const addresses: LookupAddress[] = [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ];
    const dnsLookup = makeDnsLookup(addresses);
    const lookup = createPublicOnlyLookup(dnsLookup);

    await expect(runLookup(lookup, "images.example.com")).resolves.toEqual(addresses);
    expect(dnsLookup).toHaveBeenCalledOnce();
  });
});

function makeDnsLookup(addresses: LookupAddress[]): DnsLookupAll {
  return vi.fn((_hostname, _options, callback) => callback(null, addresses));
}

function runLookup(
  lookup: ReturnType<typeof createPublicOnlyLookup>,
  hostname: string,
): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(addresses);
    });
  });
}
