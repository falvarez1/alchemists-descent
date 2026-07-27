/**
 * The binary frame envelope: a small JSON header followed by a packed payload.
 *
 * WHY NOT FULLY BINARY. Routing needs the same fields it always did — type,
 * room, clientId, revision, world identity, label — and those are a few dozen
 * bytes against a payload of kilobytes. Packing them too would buy nothing
 * measurable and cost the thing that makes a wire format survivable: being able
 * to read a frame's header in a debugger, or log it, without a decoder.
 *
 * So the split is by what actually costs bytes. The header stays JSON, exactly
 * the `AuthorLinkMessage` envelope minus its payload. The payload — the cell
 * columns, which are ~99% of the frame — is packed.
 *
 *   [magic u32 'ADBF'][version u8][reserved u8][headerLen u16][header][payload]
 *
 * `headerLen` is u16 because a header that needs more than 64 KB is not a
 * header; a frame claiming otherwise is refused rather than trusted.
 */

/** 'ADBF' — Alchemist's Descent Binary Frame. */
const MAGIC = 0x41444246;
const VERSION = 1;
const HEADER_OFFSET = 8;
export const MAX_FRAME_HEADER_BYTES = 0xffff;

export interface BinaryFrame<H = unknown> {
  header: H;
  payload: Uint8Array;
}

export function encodeBinaryFrame(header: unknown, payload: Uint8Array): Uint8Array | null {
  let headerBytes: Uint8Array;
  try {
    headerBytes = new TextEncoder().encode(JSON.stringify(header));
  } catch {
    return null;
  }
  if (headerBytes.byteLength > MAX_FRAME_HEADER_BYTES) return null;

  const out = new Uint8Array(HEADER_OFFSET + headerBytes.byteLength + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint8(4, VERSION);
  view.setUint8(5, 0);
  view.setUint16(6, headerBytes.byteLength, true);
  out.set(headerBytes, HEADER_OFFSET);
  out.set(payload, HEADER_OFFSET + headerBytes.byteLength);
  return out;
}

/**
 * Decode. Returns null for anything malformed — a frame arrives from another
 * process and must never be able to throw inside a socket handler.
 */
export function decodeBinaryFrame(bytes: Uint8Array): BinaryFrame | null {
  if (bytes.byteLength < HEADER_OFFSET) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) return null;
  if (view.getUint8(4) !== VERSION) return null;

  const headerLen = view.getUint16(6, true);
  const payloadAt = HEADER_OFFSET + headerLen;
  if (payloadAt > bytes.byteLength) return null;

  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER_OFFSET, payloadAt)));
  } catch {
    return null;
  }
  if (typeof header !== 'object' || header === null) return null;

  return { header, payload: bytes.subarray(payloadAt) };
}

export function looksLikeBinaryFrame(bytes: Uint8Array): boolean {
  if (bytes.byteLength < HEADER_OFFSET) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === MAGIC && view.getUint8(4) === VERSION;
}
