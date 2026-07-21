import { Readability } from "@mozilla/readability";
// The worker build omits linkedom's optional native canvas bridge, which is not
// needed for Readability and keeps the distributable host platform-neutral.
import { parseHTML } from "linkedom/worker";
import TurndownService from "turndown";
import { fetchRemoteUrl, type RemoteFetchOptions } from "./security.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

const HEADERS = {
	"User-Agent": "kos-agent/0.2 (+https://github.com/Asong6824/kos-framework)",
	Accept: "text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.9, application/pdf;q=0.8, text/plain;q=0.8",
};

export interface WebFetchResult {
	url: string;
	title: string;
	content: string;
	contentType: string;
	truncated: boolean;
}

export interface WebFetchRuntime extends RemoteFetchOptions {
	timeoutMs?: number;
}

export async function fetchWebContent(
	rawUrl: string,
	maxChars = 50_000,
	signal?: AbortSignal,
	runtime: WebFetchRuntime = {},
): Promise<WebFetchResult> {
	const timeout = AbortSignal.timeout(runtime.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	const response = await fetchRemoteUrl(
		rawUrl,
		{ headers: HEADERS, signal: combinedSignal },
		{ fetch: runtime.fetch, lookup: runtime.lookup, maxRedirects: runtime.maxRedirects },
	);
	if (!response.ok) throw new Error(`Remote server returned HTTP ${response.status}`);

	const finalUrl = response.url || rawUrl;
	const mediaType = (response.headers.get("content-type") ?? "text/plain").split(";")[0].trim().toLowerCase();
	const isPdf = mediaType === "application/pdf" || new URL(finalUrl).pathname.toLowerCase().endsWith(".pdf");
	if (/^(image|audio|video)\//.test(mediaType) || mediaType === "application/zip" || mediaType === "application/octet-stream") {
		throw new Error(`Unsupported content type: ${mediaType}`);
	}

	const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_RESPONSE_BYTES;
	const declaredLength = Number(response.headers.get("content-length") ?? 0);
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw new Error(`Response exceeds the ${formatMiB(maxBytes)} MiB limit`);
	}
	const bytes = await readLimitedBody(response, maxBytes);
	const extracted = isPdf
		? await extractPdf(bytes, finalUrl)
		: extractText(new TextDecoder().decode(bytes), mediaType, finalUrl);
	const limit = Math.max(1_000, Math.min(Math.floor(maxChars), 100_000));
	const truncated = extracted.content.length > limit;
	return {
		url: finalUrl,
		title: extracted.title,
		content: truncated ? `${extracted.content.slice(0, limit)}\n\n[Content truncated by kos-agent]` : extracted.content,
		contentType: mediaType,
		truncated,
	};
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
	if (!response.body) return new Uint8Array(await response.arrayBuffer());
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) throw new Error(`Response exceeds the ${formatMiB(maxBytes)} MiB limit`);
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	}
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function extractText(text: string, mediaType: string, url: string): { title: string; content: string } {
	if (mediaType.includes("markdown") || !mediaType.includes("html")) {
		return { title: firstHeading(text) || urlTitle(url), content: text.trim() };
	}
	const { document } = parseHTML(text);
	const article = new Readability(document as never).parse();
	const title = article?.title?.trim() || document.querySelector("title")?.textContent?.trim() || urlTitle(url);
	if (article?.content) {
		const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })
			.turndown(article.content)
			.trim();
		if (markdown) return { title, content: markdown };
	}
	const body = document.querySelector("body");
	if (!body) throw new Error("Could not extract readable content from HTML");
	for (const element of Array.from(body.querySelectorAll("script,style,noscript,template")) as Array<{ remove(): void }>) {
		element.remove();
	}
	const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })
		.turndown(body.innerHTML)
		.trim();
	if (!markdown) throw new Error("Could not extract readable content from HTML");
	return { title, content: markdown };
}

async function extractPdf(bytes: Uint8Array, url: string): Promise<{ title: string; content: string }> {
	const { getDocumentProxy } = await import("unpdf");
	const pdf = await getDocumentProxy(bytes);
	const pages: string[] = [];
	for (let index = 1; index <= pdf.numPages; index++) {
		const page = await pdf.getPage(index);
		const pageContent = await page.getTextContent();
		const text = pageContent.items
			.map((item: unknown) => (item as { str?: string }).str ?? "")
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		if (text) pages.push(`<!-- Page ${index} -->\n\n${text}`);
	}
	if (!pages.length) throw new Error("PDF contained no extractable text");
	return { title: urlTitle(url), content: pages.join("\n\n") };
}

function firstHeading(text: string): string | undefined {
	return text.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
}

function urlTitle(rawUrl: string): string {
	const url = new URL(rawUrl);
	return url.pathname.split("/").filter(Boolean).pop() || url.hostname;
}

function formatMiB(bytes: number): string {
	return String(Math.round(bytes / 1024 / 1024));
}
