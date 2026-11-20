// Minimal protobuf decoder for MEXC WebSocket pushes (wss://wbs-api.mexc.com/ws).
// MEXC sends PushDataV3ApiWrapper messages:
//   1: channel (string), 3: symbol (string), 6: sendTime (int64),
//   303: publicLimitDepths { 1: asks[], 2: bids[], 3: eventType, 4: version }
//   each level: { 1: price (string), 2: quantity (string) }
// Only the fields we use are decoded; everything else is skipped by wire type.

type Field = { num: number; wire: number; value: number | Uint8Array };

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error('truncated varint');
    const b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift; // avoid 32-bit overflow of <<
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7;
  }
}

export function decodeFields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let pos = 0;
  while (pos < buf.length) {
    let key: number;
    [key, pos] = readVarint(buf, pos);
    const num = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      let v: number;
      [v, pos] = readVarint(buf, pos);
      out.push({ num, wire, value: v });
    } else if (wire === 2) {
      let len: number;
      [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw new Error('truncated field');
      out.push({ num, wire, value: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return out;
}

const text = new TextDecoder();
const str = (v: Field['value'] | string) => (v instanceof Uint8Array ? text.decode(v) : String(v));

function levels(fields: Field[], num: number): [number, number][] {
  return fields
    .filter((f) => f.num === num && f.value instanceof Uint8Array)
    .map((f) => {
      const lv = decodeFields(f.value as Uint8Array);
      const price = Number(str(lv.find((x) => x.num === 1)?.value ?? '0'));
      const qty = Number(str(lv.find((x) => x.num === 2)?.value ?? '0'));
      return [price, qty] as [number, number];
    });
}

export interface DepthPush {
  channel: string;
  symbol: string;
  asks: [number, number][];
  bids: [number, number][];
}

/** Decode a limit-depth push; returns null for other message types. */
export function decodeDepthPush(buf: Uint8Array): DepthPush | null {
  const top = decodeFields(buf);
  const depth = top.find((f) => f.num === 303 && f.value instanceof Uint8Array);
  if (!depth) return null;
  const inner = decodeFields(depth.value as Uint8Array);
  return {
    channel: str(top.find((f) => f.num === 1)?.value ?? ''),
    symbol: str(top.find((f) => f.num === 3)?.value ?? ''),
    asks: levels(inner, 1).sort((a, b) => a[0] - b[0]),
    bids: levels(inner, 2).sort((a, b) => b[0] - a[0]),
  };
}
