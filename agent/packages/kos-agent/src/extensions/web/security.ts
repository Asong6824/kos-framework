import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type LookupAddress = { address: string; family: number };
export type Lookup = (hostname: string) => Promise<LookupAddress[]>;
type FetchImplementation = typeof fetch;

export interface RemoteValidationOptions {
	lookup?: Lookup;
}

export interface RemoteFetchOptions extends RemoteValidationOptions {
	fetch?: FetchImplementation;
	maxRedirects?: number;
}

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
	return dnsLookup(hostname, { all: true, verbatim: true });
}

export async function validateRemoteUrl(
	rawUrl: string | URL,
	options: RemoteValidationOptions = {},
): Promise<URL> {
	const url = rawUrl instanceof URL ? new URL(rawUrl) : new URL(rawUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Only HTTP and HTTPS URLs can be fetched");
	}
	if (url.username || url.password) throw new Error("URLs containing credentials are not allowed");

	const hostname = normalizeHostname(url.hostname);
	if (!hostname) throw new Error("URL must include a hostname");
	if (hostname === "localhost" || hostname.endsWith(".localhost")) {
		throw new Error(`Blocked internal hostname: ${hostname}`);
	}

	if (net.isIP(hostname)) {
		assertPublicAddress(hostname, hostname);
		return url;
	}

	let addresses: LookupAddress[];
	try {
		addresses = await (options.lookup ?? defaultLookup)(hostname);
	} catch (error) {
		throw new Error(`Failed to resolve ${hostname}: ${errorMessage(error)}`);
	}
	if (addresses.length === 0) throw new Error(`Failed to resolve ${hostname}: no addresses returned`);
	for (const { address } of addresses) assertPublicAddress(address, hostname);
	return url;
}

export async function fetchRemoteUrl(
	rawUrl: string | URL,
	init: RequestInit = {},
	options: RemoteFetchOptions = {},
): Promise<Response> {
	const fetchImpl = options.fetch ?? fetch;
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	let current = await validateRemoteUrl(rawUrl, options);
	let requestInit = init;

	for (let redirects = 0; redirects <= maxRedirects; redirects++) {
		const response = await fetchImpl(current, { ...requestInit, redirect: "manual" });
		if (!REDIRECT_STATUSES.has(response.status)) return response;

		const location = response.headers.get("location");
		if (!location) return response;
		if (redirects === maxRedirects) throw new Error(`Too many redirects fetching ${current.toString()}`);
		current = await validateRemoteUrl(new URL(location, current), options);

		const method = requestInit.method?.toUpperCase();
		if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
			const { body: _body, ...nextInit } = requestInit;
			requestInit = { ...nextInit, method: "GET" };
		}
	}
	throw new Error(`Too many redirects fetching ${current.toString()}`);
}

function normalizeHostname(hostname: string): string {
	return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function assertPublicAddress(address: string, hostname: string): void {
	const normalized = normalizeHostname(address);
	const version = net.isIP(normalized);
	if (version === 0) throw new Error(`Resolved non-IP address for ${hostname}: ${address}`);
	if (version === 4 ? isBlockedIPv4(normalized) : isBlockedIPv6(normalized)) {
		throw new Error(`Blocked internal or reserved address for ${hostname}: ${normalized}`);
	}
}

function isBlockedIPv4(address: string): boolean {
	const parts = address.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
	const [a, b, c] = parts;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && c === 0) ||
		(a === 192 && b === 0 && c === 2) ||
		(a === 192 && b === 88 && c === 99) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	);
}

function isBlockedIPv6(address: string): boolean {
	const groups = parseIPv6(address);
	if (!groups) return true;
	const first = groups[0];
	if (groups.every((group) => group === 0)) return true;
	if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
	if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;
	if ((first & 0xff00) === 0xff00) return true;
	if (first === 0x2001 && groups[1] === 0x0db8) return true;

	const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
	if (mapped) {
		const ipv4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
		return isBlockedIPv4(ipv4);
	}
	return false;
}

function parseIPv6(input: string): number[] | null {
	let address = input;
	if (address.includes(".")) {
		const lastColon = address.lastIndexOf(":");
		const ipv4 = address.slice(lastColon + 1);
		if (net.isIP(ipv4) !== 4) return null;
		const octets = ipv4.split(".").map(Number);
		address = `${address.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
	}
	const pieces = address.split("::");
	if (pieces.length > 2) return null;
	const left = pieces[0] ? pieces[0].split(":") : [];
	const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
	const missing = 8 - left.length - right.length;
	if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) return null;
	const groups = [...left, ...Array(missing).fill("0"), ...right].map((part) =>
		/^[0-9a-f]{1,4}$/i.test(part) ? Number.parseInt(part, 16) : -1,
	);
	return groups.length === 8 && groups.every((group) => group >= 0 && group <= 0xffff) ? groups : null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
