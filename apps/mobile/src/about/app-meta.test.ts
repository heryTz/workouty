import { describe, expect, it, vi } from 'vitest'
import { fetchApiMeta, formatReleaseDate } from './app-meta'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('fetchApiMeta', () => {
  it('parses a successful response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: '1.2.0', releaseDate: '2026-08-07' }))

    const meta = await fetchApiMeta({ baseUrl: 'https://api.example.com', fetch: fetchImpl as unknown as typeof fetch })

    expect(meta).toEqual({ version: '1.2.0', releaseDate: '2026-08-07' })
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/version')
  })

  it('accepts a null release date', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: 'dev', releaseDate: null }))

    const meta = await fetchApiMeta({ fetch: fetchImpl as unknown as typeof fetch })

    expect(meta).toEqual({ version: 'dev', releaseDate: null })
  })

  it('returns null on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'boom' }, 500))

    expect(await fetchApiMeta({ fetch: fetchImpl as unknown as typeof fetch })).toBeNull()
  })

  it('returns null when the request rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network request failed')
    })

    expect(await fetchApiMeta({ fetch: fetchImpl as unknown as typeof fetch })).toBeNull()
  })

  it('returns null when the body is not the expected shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ releaseDate: '2026-08-07' }))

    expect(await fetchApiMeta({ fetch: fetchImpl as unknown as typeof fetch })).toBeNull()
  })

  it('returns null when the body is not an object', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('nope'))

    expect(await fetchApiMeta({ fetch: fetchImpl as unknown as typeof fetch })).toBeNull()
  })

  it('normalises a non-string release date to null', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: '1.2.0', releaseDate: 20260807 }))

    expect(await fetchApiMeta({ fetch: fetchImpl as unknown as typeof fetch })).toEqual({
      version: '1.2.0',
      releaseDate: null,
    })
  })

  it('returns null when the body is not valid JSON', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    }) as unknown as Response)

    expect(await fetchApiMeta({ fetch: fetchImpl as unknown as typeof fetch })).toBeNull()
  })
})

describe('formatReleaseDate', () => {
  it('formats a YYYY-MM-DD date', () => {
    expect(formatReleaseDate('2026-08-07')).toBe('August 7, 2026')
  })

  it('does not shift the day west of UTC', () => {
    const originalTz = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      // Guard: proves the timezone switch actually took effect, so the assertion below can't
      // pass vacuously. `new Date('2026-01-01')` is UTC midnight — Dec 31 in Los Angeles.
      expect(new Date('2026-01-01').getDate()).toBe(31)

      expect(formatReleaseDate('2026-01-01')).toBe('January 1, 2026')
    } finally {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    }
  })

  it('returns anything that is not a YYYY-MM-DD date unchanged', () => {
    expect(formatReleaseDate('garbage')).toBe('garbage')
    expect(formatReleaseDate('2026-13-07')).toBe('2026-13-07')
  })
})
