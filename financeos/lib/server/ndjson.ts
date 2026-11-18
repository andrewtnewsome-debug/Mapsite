import "server-only";

/** Streams events as newline-delimited JSON. */
export function ndjsonResponse(events: AsyncIterable<unknown>, onError: (err: unknown) => unknown): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const e of events) controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      } catch (err) {
        controller.enqueue(encoder.encode(`${JSON.stringify(onError(err))}\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
