import { describe, expect, it, vi } from 'vitest'
import { AuthError, login, performReset, register, requestReset } from './auth-api'

const BASE_URL = 'https://api.example.test'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('register', () => {
  it('POSTs to /auth/register with the credentials and returns the token pair', async () => {
    const pair = { accessToken: 'access-1', refreshToken: 'refresh-1' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, pair))

    const result = await register('a@example.com', 'password123', { baseUrl: BASE_URL, fetch: fetchMock })

    expect(result).toEqual(pair)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/auth/register`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@example.com', password: 'password123' })
  })

  it('maps a 409 (duplicate email) to an AuthError with status 409', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { statusCode: 409, message: 'Email already registered' }))

    await expect(
      register('dup@example.com', 'password123', { baseUrl: BASE_URL, fetch: fetchMock }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Email already registered',
    })
  })

  it('maps a 409 with no usable body message to the fallback message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not json', { status: 409 }))

    const err = await register('dup@example.com', 'password123', { baseUrl: BASE_URL, fetch: fetchMock }).catch(
      (e: unknown) => e,
    )

    expect(err).toBeInstanceOf(AuthError)
    expect((err as AuthError).status).toBe(409)
    expect((err as AuthError).message).toBe('Email already registered')
  })
})

describe('login', () => {
  it('POSTs to /auth/login with the credentials and returns the token pair', async () => {
    const pair = { accessToken: 'access-2', refreshToken: 'refresh-2' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, pair))

    const result = await login('a@example.com', 'password123', { baseUrl: BASE_URL, fetch: fetchMock })

    expect(result).toEqual(pair)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/auth/login`)
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@example.com', password: 'password123' })
  })

  it('maps a 401 (wrong credentials) to an AuthError with status 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { statusCode: 401, message: 'Invalid credentials' }))

    await expect(login('a@example.com', 'wrong', { baseUrl: BASE_URL, fetch: fetchMock })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid credentials',
    })
  })
})

describe('requestReset', () => {
  it('POSTs to /auth/reset-request and resolves on 202', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))

    await expect(requestReset('a@example.com', { baseUrl: BASE_URL, fetch: fetchMock })).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/auth/reset-request`)
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@example.com' })
  })

  it('resolves the same way regardless of whether the email is registered (always 202)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))

    await expect(
      requestReset('unknown@example.com', { baseUrl: BASE_URL, fetch: fetchMock }),
    ).resolves.toBeUndefined()
  })

  it('surfaces a non-2xx as an AuthError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))

    await expect(requestReset('a@example.com', { baseUrl: BASE_URL, fetch: fetchMock })).rejects.toBeInstanceOf(
      AuthError,
    )
  })
})

describe('performReset', () => {
  it('POSTs to /auth/reset with the token and new password, resolves on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))

    await expect(
      performReset('reset-token-1', 'newpassword123', { baseUrl: BASE_URL, fetch: fetchMock }),
    ).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/auth/reset`)
    expect(JSON.parse(init.body as string)).toEqual({ token: 'reset-token-1', password: 'newpassword123' })
  })

  it('maps a 400 (invalid/expired token) to an AuthError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { statusCode: 400, message: 'Invalid or expired token' }))

    await expect(
      performReset('bad-token', 'newpassword123', { baseUrl: BASE_URL, fetch: fetchMock }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Invalid or expired token',
    })
  })
})
