import { lookup as dnsLookup } from "node:dns";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";

const BLOCKED_ADDRESSES = createBlockedAddressList();
const PUBLIC_IPV6_ADDRESSES = createPublicIpv6AddressList();

export class UnsafeOutboundAddressError extends Error {
  readonly code = "ERR_UNSAFE_OUTBOUND_ADDRESS";

  constructor(message: string) {
    super(message);
    this.name = "UnsafeOutboundAddressError";
  }
}

export type DnsLookupAll = (
  hostname: string,
  options: LookupAllOptions,
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

export function assertPublicImageUrl(url: URL): void {
  if (url.protocol !== "https:") {
    throw new UnsafeOutboundAddressError("图片 URL 只允许使用 HTTPS。");
  }
  if (url.username || url.password) {
    throw new UnsafeOutboundAddressError("图片 URL 不能包含用户名或密码。");
  }

  const hostname = stripIpv6Brackets(url.hostname);
  if (!hostname) {
    throw new UnsafeOutboundAddressError("图片 URL 缺少有效主机名。");
  }

  if (isIP(hostname) !== 0) {
    assertPublicIpAddress(hostname);
  }
}

export function assertPublicIpAddress(address: string): void {
  const family = isIP(address);
  if (family === 0) {
    throw new UnsafeOutboundAddressError(`无法识别图片地址：${address}`);
  }

  if (BLOCKED_ADDRESSES.check(address, family === 4 ? "ipv4" : "ipv6")) {
    throw new UnsafeOutboundAddressError(`图片地址不允许访问非公网 IP：${address}`);
  }
  if (family === 6 && !PUBLIC_IPV6_ADDRESSES.check(address, "ipv6")) {
    throw new UnsafeOutboundAddressError(`图片地址不允许访问非公网 IP：${address}`);
  }
}

export function createPublicOnlyLookup(
  lookupAll: DnsLookupAll = systemLookupAll,
): LookupFunction {
  return (hostname, options, callback) => {
    lookupAll(
      hostname,
      {
        all: true,
        family: options.family,
        hints: options.hints,
        order: "verbatim",
      },
      (error, addresses) => {
        if (error) {
          callback(error, []);
          return;
        }

        if (addresses.length === 0) {
          callback(new Error(`无法解析图片主机：${hostname}`), []);
          return;
        }

        try {
          for (const entry of addresses) {
            assertPublicIpAddress(entry.address);
          }
        } catch (addressError) {
          callback(asNodeError(addressError), []);
          return;
        }

        if (options.all) {
          callback(null, addresses);
          return;
        }

        const selected = addresses[0]!;
        callback(null, selected.address, selected.family);
      },
    );
  };
}

function systemLookupAll(
  hostname: string,
  options: LookupAllOptions,
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
): void {
  dnsLookup(hostname, options, callback);
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function asNodeError(error: unknown): NodeJS.ErrnoException {
  return error instanceof Error ? error : new Error(String(error));
}

function createBlockedAddressList(): BlockList {
  const blockList = new BlockList();

  const ipv4Subnets: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];

  const ipv6Subnets: Array<[string, number]> = [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 32],
    ["2001:2::", 48],
    ["2001:10::", 28],
    ["2001:20::", 28],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ];

  for (const [network, prefix] of ipv4Subnets) {
    blockList.addSubnet(network, prefix, "ipv4");
  }
  for (const [network, prefix] of ipv6Subnets) {
    blockList.addSubnet(network, prefix, "ipv6");
  }

  return blockList;
}

function createPublicIpv6AddressList(): BlockList {
  const blockList = new BlockList();
  blockList.addSubnet("2000::", 3, "ipv6");
  blockList.addSubnet("::ffff:0:0", 96, "ipv6");
  return blockList;
}
