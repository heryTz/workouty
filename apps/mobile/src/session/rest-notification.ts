// Rest-timer ALARM (Milestone 4 Task E2): a scheduled local notification with sound on Android
// so the "rest is over" alert fires even when the app is backgrounded or killed — the spec's
// signature requirement for the rest timer. This is layered on top of D2's timestamp-derived
// in-app countdown (timers.ts): the countdown is the source of truth for the on-screen value,
// this module is the OS-level nudge that fires independently of whether the screen is open.
//
// Every call into `expo-notifications` is guarded behind `Platform.OS !== 'web'`. expo-notifications
// ships web-safe no-op fallbacks for most of its surface (Metro's platform extension resolution
// picks the base/non-native file on web, which is either a no-op or a `console.debug` stub — see
// `setNotificationChannelAsync.js` upstream), but `requestPermissionsAsync` /
// `scheduleNotificationAsync` throw `UnavailabilityError` when their native module is absent, which
// web is. So this module still guards explicitly rather than relying on the upstream no-ops: it's
// the documented contract (Platform.OS !== 'web'), and it keeps behaviour explicit instead of
// depending on an implementation detail of a third-party package. The import itself is safe on web
// (proven: `expo export --platform web` bundles cleanly — Metro's per-platform file resolution
// never pulls in the native module binding for the web bundle), so this file imports
// `expo-notifications` statically at the top rather than lazy-importing it.
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'

/** The Android notification channel used for the rest-complete alarm. Sound requires a channel
 * on Android 8+; importance HIGH so it heads-up/alerts even while backgrounded. */
export const REST_CHANNEL_ID = 'rest'

/** Creates (or updates) the 'rest' notification channel. No-op on web (no notification channels
 * outside Android) and a no-op on iOS (channels are an Android-only concept upstream). */
export async function ensureRestChannel(): Promise<void> {
  if (Platform.OS === 'web') return
  await Notifications.setNotificationChannelAsync(REST_CHANNEL_ID, {
    name: 'Rest timer',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  })
}

/** Requests OS notification permission. Returns whether it was granted. No-op/false on web. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false
  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted'
}

/**
 * Schedules a local notification to fire at `endsAtMs` (a DATE trigger) on the 'rest' channel,
 * with sound. This is what fires the alarm even if the app is backgrounded or killed on Android.
 * Returns the scheduled notification's id (needed to cancel it early), or `null` on web where
 * there is no local-notification API (the in-app countdown + a Web Audio beep cover it instead —
 * see rest-beep.ts and the session screen's `restOver` transition).
 */
export async function scheduleRestAlarm(endsAtMs: number): Promise<string | null> {
  if (Platform.OS === 'web') return null
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Rest complete',
      body: 'Time for your next set.',
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: endsAtMs,
      channelId: REST_CHANNEL_ID,
    },
  })
  return id
}

/** Cancels a previously-scheduled rest alarm (e.g. "Stop rest" pressed before it fires). No-op on
 * web or when `id` is null (nothing was scheduled). */
export async function cancelRestAlarm(id: string | null): Promise<void> {
  if (Platform.OS === 'web' || id == null) return
  await Notifications.cancelScheduledNotificationAsync(id)
}
