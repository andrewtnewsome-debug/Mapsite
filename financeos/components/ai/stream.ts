/** Reads a newline-delimited JSON response, calling onEvent for each event. */
export async function readNdjson<T>(res: Response, onEvent: (e: T) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as T);
        } catch {
          // ignore malformed line
        }
      }
    }
  }
  if (buf.trim()) {
    try {
      onEvent(JSON.parse(buf) as T);
    } catch {
      // ignore
    }
  }
}

export async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}
