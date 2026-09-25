export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  let buf: ArrayBuffer;
  if (data instanceof Blob) buf = await data.arrayBuffer();
  else if (data instanceof Uint8Array) buf = data.slice().buffer as ArrayBuffer;
  else buf = data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
