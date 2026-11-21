import { inflateRawSync } from 'zlib'

/** Largest file the importer will unpack from an archive; exports are a few MB at most. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024

const MAX = 0xffffffff

/**
 * Reads a zip archive (stored or deflated entries) into name -> bytes.
 *
 * Written for exports such as Glooko's, which put 0xFFFFFFFF in the 32-bit
 * size fields and the real sizes in a per-entry ZIP64 extra field, without a
 * ZIP64 end record. Readers that only honour ZIP64 when that record exists
 * take every file to be 4 GB. Sizes are checked against `maxEntryBytes`
 * before anything is inflated.
 */
export function unzip(data: Uint8Array, maxEntryBytes = MAX_ENTRY_BYTES): Record<string, Uint8Array> {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const fail = (why: string): never => {
    throw new Error(`Not a readable zip file: ${why}`)
  }
  const u16 = (o: number) => (o + 2 <= buf.length ? buf.readUInt16LE(o) : fail('truncated'))
  const u32 = (o: number) => (o + 4 <= buf.length ? buf.readUInt32LE(o) : fail('truncated'))
  const u64 = (o: number) => {
    const v = o + 8 <= buf.length ? buf.readBigUInt64LE(o) : fail('truncated')
    return v > BigInt(Number.MAX_SAFE_INTEGER) ? fail('size out of range') : Number(v)
  }

  // End of central directory: the last 0x06054b50, within the 64 KB comment window.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) fail('no end of central directory')
  let count = u16(eocd + 10)
  let cdOffset = u32(eocd + 16)
  if ((count === 0xffff || cdOffset === MAX) && eocd >= 20 && u32(eocd - 20) === 0x07064b50) {
    const z = u64(eocd - 12)
    if (u32(z) !== 0x06064b50) fail('bad ZIP64 end record')
    count = u64(z + 32)
    cdOffset = u64(z + 48)
  }

  const files: Record<string, Uint8Array> = {}
  let p = cdOffset
  for (let n = 0; n < count; n++) {
    if (u32(p) !== 0x02014b50) fail('bad central directory entry')
    const flags = u16(p + 8)
    const method = u16(p + 10)
    let csize = u32(p + 20)
    let usize = u32(p + 24)
    const nameLen = u16(p + 28)
    const extraLen = u16(p + 30)
    const commentLen = u16(p + 32)
    let local = u32(p + 42)
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen)
    // ZIP64 extra field (id 1): 64-bit values, in this order, for each 32-bit field that is 0xFFFFFFFF.
    for (let x = p + 46 + nameLen; x + 4 <= p + 46 + nameLen + extraLen; ) {
      const id = u16(x)
      const len = u16(x + 2)
      if (id === 0x0001) {
        let f = x + 4
        if (usize === MAX) {
          usize = u64(f)
          f += 8
        }
        if (csize === MAX) {
          csize = u64(f)
          f += 8
        }
        if (local === MAX) local = u64(f)
      }
      x += 4 + len
    }
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    if (flags & 1) fail(`${name} is encrypted`)
    if (usize > maxEntryBytes || csize > maxEntryBytes) fail(`${name} is larger than ${maxEntryBytes} bytes`)
    if (u32(local) !== 0x04034b50) fail(`bad local header for ${name}`)
    const start = local + 30 + u16(local + 26) + u16(local + 28)
    if (start + csize > buf.length) fail(`${name} is truncated`)
    const raw = buf.subarray(start, start + csize)
    let out: Buffer
    if (method === 0) out = Buffer.from(raw)
    else if (method === 8) {
      try {
        out = inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) })
      } catch (e) {
        throw new Error(`Not a readable zip file: ${name}: ${e instanceof Error ? e.message : e}`, { cause: e })
      }
    } else return fail(`${name} uses unsupported compression method ${method}`)
    if (out.length !== usize) fail(`${name} has ${out.length} bytes, expected ${usize}`)
    files[name] = new Uint8Array(out)
  }
  return files
}
