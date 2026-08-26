# Workouty

> 🚧 **Under development.** Usable, but the shape of things is still moving. Expect rough edges.

> 🚨 **Fully vibe-coded.** Every line here was written by an AI agent, and I don't review the code
> quality — I check that the app does what I want and move on. No architecture reviews, no
> refactoring passes, no promises about what's under the hood. I needed this app fast. Read the
> source with that in mind before you depend on it.

Track your lifts, not your signal. A workout log that works with the phone in airplane mode, in a
basement gym, on the far side of nowhere.

Gyms are where connectivity goes to die, and that is exactly where a training log has to work.
Workouty keeps the whole database on the device: every set you log is written locally and shows up
instantly, then syncs the moment you're back on a network. Nothing to wait for, nothing to lose.

The other half is the loop itself. A set is reps, weight, and the rest that follows it — so the app
logs the set, starts the rest countdown, and hands you back the form for the next one. That's the
whole interaction, repeated until you're done.

I built it for myself. It's open source, and if you train the same way, it may help you too.

## The idea

- **Offline is the normal case, not the fallback.** The app reads and writes a local database; the
  network is an implementation detail.
- **Rest belongs to the set before it.** Stop the timer and that moment is the start of your next
  set, so the numbers reflect what you actually did.
- **Your history is the reference.** Every exercise shows what you lifted last time, right where
  you're about to lift it again.
- **Templates follow you, not the other way round.** Change the plan mid-session and the app asks
  what to do with the template afterwards.

## What's in it

- [x] Sessions — freestyle or from a template, running elapsed timer, log sets in reps × kg
- [x] Rest timer — auto-starts at the exercise's default, adjustable, records the rest you took
- [x] Exercise library — built-in exercises, searchable, plus your own custom ones
- [x] "Last time" — the previous session's top set for the exercise you're on
- [x] Templates — save a session as one, start from one, update it when the session diverges
- [x] Personal records — best weight, best estimated 1RM (Epley), best set volume, flagged live
- [x] Dashboard — per-exercise progression chart, top weight or estimated 1RM
- [x] Offline-first sync — local database, syncs back when you have a connection
- [x] Email + password sign-in, password reset

Running it locally or in production: [docs/development.md](docs/development.md).

## License

Copyright (C) 2026 Hery Nirintsoa.

Workouty is free software licensed under the [GNU Affero General Public License v3.0](LICENSE).
You may use, study, share, and modify it; if you run a modified version as a network service, you
have to offer its source to the people using it.
