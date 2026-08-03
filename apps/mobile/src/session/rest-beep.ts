// A short in-app beep for the web build's "rest complete" cue (Milestone 4 Task E2). Native
// devices get the OS notification sound from the scheduled local notification (rest-notification.ts);
// web has no local-notification API, so the audible cue while the tab is open comes from this Web
// Audio oscillator beep instead. No dependency needed — the Web Audio API is built into every
// browser this app targets.
//
// Guarded so it's a safe no-op anywhere `AudioContext` isn't available (native — where it's never
// called anyway since the caller checks `Platform.OS === 'web'` first; SSR; or an unsupported/older
// browser) and never throws (e.g. a browser blocking audio before a user gesture is non-fatal — the
// in-app "Rest complete" UI state still shows regardless of whether the beep played).
interface WebkitWindow {
  webkitAudioContext?: typeof AudioContext
}

export function playRestBeep(): void {
  const AudioContextCtor =
    typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as WebkitWindow).webkitAudioContext) : undefined
  if (!AudioContextCtor) return

  try {
    const ctx = new AudioContextCtor()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)

    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.4)
    oscillator.onended = () => {
      void ctx.close()
    }
  } catch {
    // Non-fatal: audio unavailable or blocked. The "Rest complete" UI state is the source of
    // truth; the beep is a best-effort cue on top of it.
  }
}
