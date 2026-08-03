/**
 * Adapted for kos-sync from Self-hosted LiveSync 0.25.83
 * `src/modules/essentialObsidian/APILib/ObsHttpHandler.ts`.
 *
 * The upstream implementation is based on remotely-save's Apache-2.0
 * S3 request handler and the AWS SDK FetchHttpHandler.
 */
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import type { FetchHttpHandlerOptions } from '@smithy/fetch-http-handler';
import { HttpRequest, HttpResponse } from '@smithy/protocol-http';
import type { HttpHandlerOptions } from '@smithy/protocol-http';
import { buildQueryString } from '@smithy/querystring-builder';
import { requestUrl } from 'obsidian';
import type { RequestUrlParam } from 'obsidian';

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function bodyForObsidian(body: unknown): string | ArrayBuffer | undefined {
  if (typeof body === 'string' || body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  }
  return undefined;
}

export class KosObsidianHttpHandler extends FetchHttpHandler {
  private readonly requestTimeoutInMs: number;

  constructor(options: FetchHttpHandlerOptions = {}) {
    super(options);
    this.requestTimeoutInMs = options.requestTimeout ?? 30_000;
  }

  override async handle(
    request: HttpRequest,
    { abortSignal }: HttpHandlerOptions = {},
  ): Promise<{ response: HttpResponse }> {
    if (abortSignal?.aborted) throw abortError('Request aborted');
    const query = request.query ? buildQueryString(request.query) : '';
    const port = request.port ? `:${request.port}` : '';
    const url = `${request.protocol}//${request.hostname}${port}${request.path}${query ? `?${query}` : ''}`;
    const headers = Object.fromEntries(
      Object.entries(request.headers)
        .filter(([key]) => !['host', 'content-length'].includes(key.toLowerCase()))
        .map(([key, value]) => [key.toLowerCase(), value]),
    );
    const requestParam: RequestUrlParam = {
      url,
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : bodyForObsidian(request.body),
      contentType: headers['content-type'],
      throw: false,
    };

    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error(`Request did not complete within ${this.requestTimeoutInMs} ms`)),
        this.requestTimeoutInMs,
      );
    });
    const aborted = new Promise<never>((_resolve, reject) => {
      if (abortSignal) abortSignal.onabort = () => reject(abortError('Request aborted'));
    });
    try {
      const result = await Promise.race([requestUrl(requestParam), timeout, aborted]);
      const responseHeaders = Object.fromEntries(
        Object.entries(result.headers).map(([key, value]) => [key.toLowerCase(), value]),
      );
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(result.arrayBuffer));
          controller.close();
        },
      });
      return {
        response: new HttpResponse({
          statusCode: result.status,
          headers: responseHeaders,
          body,
        }),
      };
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
  }
}
