import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// expo-notifications and react-native both fail to load as-is under vitest's node environment
// (expo-notifications reaches `__DEV__`, which only exists under Metro; react-native's entry
// point is Flow syntax vitest's transform doesn't understand) — neither is relevant to this
// module's own logic, so both are mocked wholesale. `Platform.OS` is set per-`describe` via
// `platformState.OS` (read by the mock below) so the same suite can prove both the native and web
// branches of rest-notification.ts without re-mocking per test.
//
// The mock factories below reference these fns/state, so they're declared via `vi.hoisted` —
// `vi.mock` factories are hoisted above all other module code (including plain `const`), so a
// factory closing over a normally-declared outer `const` would hit a TDZ error at import time.
const { platformState, scheduleNotificationAsync, cancelScheduledNotificationAsync, setNotificationChannelAsync, requestPermissionsAsync } =
  vi.hoisted(() => ({
    platformState: { OS: 'android' as 'android' | 'ios' | 'web' },
    scheduleNotificationAsync: vi.fn(async () => 'scheduled-id-123'),
    cancelScheduledNotificationAsync: vi.fn(async () => undefined),
    setNotificationChannelAsync: vi.fn(async () => null),
    requestPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  }))

vi.mock('react-native', () => ({
  get Platform() {
    return platformState
  },
}))

vi.mock('expo-notifications', () => ({
  scheduleNotificationAsync,
  cancelScheduledNotificationAsync,
  setNotificationChannelAsync,
  requestPermissionsAsync,
  AndroidImportance: { HIGH: 6 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}))

const { ensureRestChannel, requestNotificationPermission, scheduleRestAlarm, cancelRestAlarm, REST_CHANNEL_ID } = await import(
  './rest-notification'
)

beforeEach(() => {
  scheduleNotificationAsync.mockClear()
  cancelScheduledNotificationAsync.mockClear()
  setNotificationChannelAsync.mockClear()
  requestPermissionsAsync.mockClear()
})

afterEach(() => {
  platformState.OS = 'android'
})

describe('native (android)', () => {
  beforeEach(() => {
    platformState.OS = 'android'
  })

  it('ensureRestChannel creates the "rest" channel with HIGH importance + default sound', async () => {
    await ensureRestChannel()
    expect(setNotificationChannelAsync).toHaveBeenCalledWith(
      REST_CHANNEL_ID,
      expect.objectContaining({ importance: 6, sound: 'default' }),
    )
  })

  it('requestNotificationPermission requests permission and returns true when granted', async () => {
    requestPermissionsAsync.mockResolvedValueOnce({ status: 'granted' })
    const granted = await requestNotificationPermission()
    expect(requestPermissionsAsync).toHaveBeenCalled()
    expect(granted).toBe(true)
  })

  it('requestNotificationPermission returns false when denied', async () => {
    requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' })
    const granted = await requestNotificationPermission()
    expect(granted).toBe(false)
  })

  it('scheduleRestAlarm schedules a DATE-trigger notification on the rest channel with sound, and returns its id', async () => {
    const endsAtMs = 1_700_000_000_000
    const id = await scheduleRestAlarm(endsAtMs)

    expect(scheduleNotificationAsync).toHaveBeenCalledWith({
      content: expect.objectContaining({ sound: 'default' }),
      trigger: {
        type: 'date',
        date: endsAtMs,
        channelId: REST_CHANNEL_ID,
      },
    })
    expect(id).toBe('scheduled-id-123')
  })

  it('cancelRestAlarm cancels the notification by id', async () => {
    await cancelRestAlarm('scheduled-id-123')
    expect(cancelScheduledNotificationAsync).toHaveBeenCalledWith('scheduled-id-123')
  })

  it('cancelRestAlarm is a no-op when id is null (nothing was scheduled, e.g. on web)', async () => {
    await cancelRestAlarm(null)
    expect(cancelScheduledNotificationAsync).not.toHaveBeenCalled()
  })
})

describe('web', () => {
  beforeEach(() => {
    platformState.OS = 'web'
  })

  it('ensureRestChannel is a no-op and does not call expo-notifications', async () => {
    await ensureRestChannel()
    expect(setNotificationChannelAsync).not.toHaveBeenCalled()
  })

  it('requestNotificationPermission returns false and does not call expo-notifications', async () => {
    const granted = await requestNotificationPermission()
    expect(granted).toBe(false)
    expect(requestPermissionsAsync).not.toHaveBeenCalled()
  })

  it('scheduleRestAlarm returns null and does not call expo-notifications', async () => {
    const id = await scheduleRestAlarm(1_700_000_000_000)
    expect(id).toBeNull()
    expect(scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('cancelRestAlarm is a no-op and does not call expo-notifications', async () => {
    await cancelRestAlarm('some-id')
    expect(cancelScheduledNotificationAsync).not.toHaveBeenCalled()
  })
})
