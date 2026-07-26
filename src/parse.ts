const MAX_JSON_BYTES = 1_000_000;

async function readBody(stream: ReadableStream<Uint8Array>): Promise<string | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_JSON_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function parseJson(req: Request): Promise<unknown | null> {
  try {
    const encoding = req.headers.get("content-encoding");
    const contentLength = Number(req.headers.get("content-length"));
    if (contentLength > MAX_JSON_BYTES || !req.body) return null;
    const stream = encoding === "gzip" ? req.body.pipeThrough(new DecompressionStream("gzip")) : req.body;
    const text = await readBody(stream);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

export function base64ToVector(b64: string): string | null {
  const binary = Buffer.from(b64, "base64");
  if (binary.byteLength === 0 || binary.byteLength % 4 !== 0) return null;
  const floats = new Float32Array(binary.buffer, binary.byteOffset, binary.byteLength / 4);
  return `[${Array.from(floats).join(",")}]`;
}

export function vectorToBase64(pgText: string): string {
  const floats = JSON.parse(pgText) as number[];
  const buf = Buffer.alloc(floats.length * 4);
  for (let i = 0; i < floats.length; i++) buf.writeFloatLE(floats[i], i * 4);
  return buf.toString("base64");
}

export function extractId(req: Request): string {
  const url = new URL(req.url);
  return decodeURIComponent(url.pathname.split("/").pop()!);
}

export function extractParentId(req: Request): string {
  const segments = new URL(req.url).pathname.split("/");
  return decodeURIComponent(segments[segments.length - 2]);
}
