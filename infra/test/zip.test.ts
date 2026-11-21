import { deflateRawSync } from 'zlib'
import { strToU8, zipSync } from 'fflate'
import { unzip } from '../lib/imports/zip'

/**
 * Writes a zip the way Glooko does: 0xFFFFFFFF in the 32-bit size fields and
 * the real sizes in a ZIP64 extra field (id 1), but no ZIP64 end record.
 */
function glookoStyleZip(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text)
    const comp = deflateRawSync(data)
    const nameBuf = Buffer.from(name)
    const zip64 = Buffer.alloc(20)
    zip64.writeUInt16LE(1, 0)
    zip64.writeUInt16LE(16, 2)
    zip64.writeBigUInt64LE(BigInt(data.length), 4)
    zip64.writeBigUInt64LE(BigInt(comp.length), 12)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(45, 4)
    lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(0xffffffff, 18)
    lh.writeUInt32LE(0xffffffff, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(zip64.length, 28)
    const local = Buffer.concat([lh, nameBuf, zip64, comp])
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(0x031e, 4)
    ch.writeUInt16LE(45, 6)
    ch.writeUInt16LE(8, 10)
    ch.writeUInt32LE(0xffffffff, 20)
    ch.writeUInt32LE(0xffffffff, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt16LE(zip64.length, 30)
    ch.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([ch, nameBuf, zip64]))
    locals.push(local)
    offset += local.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, cd, end]))
}

const text = (b: Uint8Array) => Buffer.from(b).toString()

describe('unzip', () => {
  it('reads real sizes from per-entry ZIP64 extra fields (Glooko exports)', () => {
    const files = unzip(glookoStyleZip({ 'cgm_data_1.csv': 'a,b\n1,2\n', 'Insulin data/bolus_data_1.csv': 'x'.repeat(5000) }))
    expect(Object.keys(files)).toEqual(['cgm_data_1.csv', 'Insulin data/bolus_data_1.csv'])
    expect(text(files['cgm_data_1.csv'])).toBe('a,b\n1,2\n')
    expect(files['Insulin data/bolus_data_1.csv']).toHaveLength(5000)
  })

  it('reads ordinary deflated and stored zips, skipping directories', () => {
    const z = zipSync({ 'a.csv': strToU8('hello'), 'dir/': new Uint8Array(0), 'dir/b.csv': [strToU8('stored'), { level: 0 }] })
    const files = unzip(z)
    expect(Object.keys(files).sort()).toEqual(['a.csv', 'dir/b.csv'])
    expect(text(files['dir/b.csv'])).toBe('stored')
  })

  it('reads a view into a larger buffer', () => {
    const z = zipSync({ 'a.csv': strToU8('hello') })
    const big = new Uint8Array(z.length + 64)
    big.set(z, 32)
    expect(text(unzip(big.subarray(32, 32 + z.length))['a.csv'])).toBe('hello')
  })

  it('refuses entries over the size cap before inflating', () => {
    expect(() => unzip(glookoStyleZip({ 'big.csv': 'x'.repeat(2000) }), 1000)).toThrow('larger than 1000 bytes')
  })

  it('rejects garbage and truncated archives', () => {
    expect(() => unzip(strToU8('not a zip at all, not even close'))).toThrow('Not a readable zip file')
    const z = glookoStyleZip({ 'a.csv': 'hello world' })
    expect(() => unzip(z.subarray(0, z.length - 10))).toThrow('no end of central directory')
    // Compressed data starts after the 30-byte header, 5-byte name and 20-byte extra field.
    const bad = new Uint8Array(z)
    bad.fill(0xff, 55, 60)
    expect(() => unzip(bad)).toThrow('Not a readable zip file: a.csv')
  })
})
