export async function parseJson(req: Request): Promise<unknown | null> {
  try {
    const encoding = req.headers.get("content-encoding");
    if (encoding === "gzip" && req.body) {
      const decompressed = req.body.pipeThrough(new DecompressionStream("gzip"));
      const text = await new Response(decompressed).text();
      return JSON.parse(text);
    }
    return await req.json();
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
