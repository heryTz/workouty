# Workouty — Manual Test Cases (Web)

Manual QA checklist for the web app. Tick each box once you've verified it. Target is **web only** (kilograms only). Report the date/result next to any box that fails.

## Prerequisites / setup

- [x] **Stack is up.** From the repo root: `docker compose up -d --wait` — postgres, ps-storage, powersync, api, and mailpit all report healthy.
  - If `powersync` crash-loops with `PSYNC_S1107 username required`, `.env` is missing: regenerate it from `.env.example` (fill `JWT_PRIVATE_KEY`) and `docker compose up -d --force-recreate --wait`.
- [x] **Web app served.** `pnpm --filter @workouty/mobile web` (or `cd apps/mobile && pnpm web`) — open the printed URL (typically `http://localhost:8081`).
- [x] **Email inbox reachable.** Mailpit UI at `http://localhost:8025` receives password-reset emails.
- [x] **DB inspection (optional).** `docker exec workouty-postgres-1 psql -U workouty -d workouty -c "..."` to spot-check rows.

Useful throughout: keep the browser devtools **Console** open — it must stay clean (no errors) on every screen.

---

## 1. Authentication & account

- [x] **Register a new account.** Go to Register, enter a fresh email + password → account is created and you land in the signed-in app (home screen).
- [x] **Duplicate email is rejected.** Register again with the same email → a clear error is shown; no second account is created.
- [x] **Log out and back in.** Sign out → returns to Login. Log in with the same credentials → back in the app with your data intact.
- [x] **Wrong password is rejected.** Log in with a valid email but wrong password → clear error, not signed in.
- [x] **Password reset — request.** From Login → Forgot password, enter your email → confirmation shown. A reset email appears in Mailpit (`localhost:8025`) with a reset link.
- [x] **Password reset — no account enumeration.** Request a reset for an email that does NOT exist → the same confirmation is shown (no "user not found"); no email arrives in Mailpit.
- [x] **Password reset — complete.** Open the reset link, set a new password → you can log in with the new password, and the old password no longer works.
- [x] **Session persists across reload.** While logged in, refresh the browser → you stay logged in (no forced re-login).

## 2. Exercise library & picker

- [x] **Built-in library is searchable.** Start a session → add exercise → type part of a name (e.g. "bench") → the list filters to matching built-in exercises.
- [x] **Add a built-in exercise.** Pick one from the picker → it's added to the session.
- [x] **Create a custom exercise.** In the picker, add a new custom exercise by name → it's created and added to the session.
- [x] **Custom exercise persists.** Reload → the custom exercise is still selectable in the picker for future sessions.
- [x] **Recents appear first.** After using a few exercises, open the picker again → recently-used exercises are surfaced near the top.

## 3. Session & set logging

- [x] **Start a freestyle session.** From home, start a session → an empty active session opens with a running elapsed timer.
- [x] **Session elapsed timer runs.** The elapsed time increases while the session is open and reads correctly after leaving/returning to the screen (it is derived from the start time, not a paused counter).
- [ ] **Log a set (reps + weight).** Add an exercise, enter reps and weight in kg, log it → the set appears in the list with the right reps × weight.
- [x] **Log multiple sets.** Log several sets for the same exercise → each appears in order with an incrementing index.
- [x] **Weight is kilograms.** Weights display/behave as kg throughout (no lb anywhere).
- [x] **Reject non-integer reps.** Try to log a set with reps `2.5` → it is rejected / not saved (integer reps only). Weight may be decimal; reps may not.
- [x] **Reject empty/invalid input.** Try to log with blank or zero/negative reps or negative weight → rejected, nothing saved.
- [x] **"Last time" reference.** For an exercise you've done in a PRIOR session, the logging screen shows the previous session's top set (e.g. "Last time: 60 kg × 8"). For a brand-new exercise it shows nothing / "First time".
- [x] **Remove an exercise from the session.** Use the remove control on an exercise → confirm → the exercise and its sets disappear from the session (reactively, no reload).
- [x] **Finish a session.** Finish → returns to home; the session is recorded (visible later in the dashboard's history/progression).

## 4. Rest timer

- [x] **Auto-start after a set.** Log a set → a rest countdown starts automatically using that exercise's default rest duration.
- [x] **Countdown is correct.** The remaining time decreases second-by-second and is accurate after briefly switching away and back (timestamp-derived, not a paused ticker).
- [x] **Adjust the rest duration.** Change the rest length → the running countdown reflects the new duration.
- [x] **Stop rest = start next set.** Press "Stop rest" → the rest ends immediately and that moment marks the beginning of the next set (rest is attributed to the preceding set).
- [x] **Rest end signal on web.** When the countdown reaches zero, the web app gives its audible beep / visible cue (no locked-screen native alarm on web — that's expected).

## 5. Templates

- [x] **Save a session as a template.** In a session with a couple of exercises, "Save as template", name it → it's created (appears in the Templates list).
- [x] **Templates list.** Open Templates → your templates are listed, most-recently-updated first.
- [x] **Start a session from a template.** Start from a template → a new session opens pre-filled with the template's exercises (in order) and no sets.
- [x] **Rename a template.** Rename a template → the new name shows in the list and persists across reload.
- [x] **Delete a template.** Delete a template → it disappears from the list and stays gone after reload (does not resurrect on sync).
- [x] **Finish matching session — no prompt.** Start from a template, log sets WITHOUT changing the exercise list, Finish → finishes silently, no divergence prompt.
- [x] **Finish freestyle session — no prompt.** Finish a freestyle (non-template) session → no divergence prompt.
- [x] **Divergence — Update template.** Start from a template, add an exercise, Finish → prompt appears (Update / Don't / Save as new). Choose **Update** → the template now includes the added exercise (check the Templates list / DB).
- [x] **Divergence — Save as new.** Start from a template, change the exercise list, Finish → prompt → **Save as new**, name it → a second template is created; the original is unchanged.
- [x] **Divergence — Don't update.** Start from a template, change the exercise list, Finish → prompt → **Don't update** → the template is unchanged; nothing new is created.
- [x] **Divergence detects removal.** Start from a template, remove an exercise, Finish → the prompt appears (removal counts as divergence).

## 6. Dashboard, progression & personal records

- [x] **Open the dashboard.** From home → Dashboard navigates to the dashboard screen.
- [x] **Empty state.** A fresh account with no logged sets shows a "log some sets to see your progress" style empty state (no chart, no crash).
- [x] **Exercise selector.** Exercises you've performed appear as selectable chips; selecting one drives the chart below.
- [x] **Progression chart renders.** For an exercise done across ≥2 sessions with an increasing top set, the chart shows one bar per session, ascending over time.
- [x] **Metric toggle.** Toggle between "Top weight" and "Est. 1RM" → the bars re-render for the selected metric.
- [x] **Estimated 1RM is Epley.** For a known set, the est. 1RM matches `weight × (1 + reps/30)` (e.g. 60 kg × 8 → 76 kg), and a single (reps = 1) equals the weight itself.
- [x] **Personal records list.** The dashboard lists, per performed exercise, the best weight (X kg × N) and best estimated 1RM — matching your logged history.
- [x] **Reactive update.** With the dashboard open in one tab, log a new heavier set in another tab/session → the chart and PR list update without a manual reload.
- [x] **"New PR!" — first set not a PR.** In a brand-new exercise, log the first set (e.g. 60 kg × 5) → NO "New PR!" badge (nothing to beat).
- [x] **"New PR!" — weight PR.** Log a strictly heavier set (65 kg × 5) → "New PR! 🏆" appears on it immediately.
- [x] **"New PR!" — equalling is not a PR.** Log an identical set (65 kg × 5) again → NO badge.
- [x] **"New PR!" — estimated-1RM PR without more weight.** Log the same weight at higher reps (65 kg × 8) → badge appears (estimated-1RM beat the previous best even though weight didn't increase).

## 7. Sync, offline & persistence

- [x] **Data survives reload.** Create sessions/sets/templates, reload the browser → everything is still there (synced to the server and re-hydrated).
- [x] **Second browser sees the data.** Log in as the same user in a second browser/profile → the same sessions, templates, and PRs appear.
- [x] **Offline writes queue.** With the app loaded, go offline (devtools → Network → Offline), log a set → it appears locally immediately.
- [x] **Offline writes sync on reconnect.** Go back online → the queued write reaches the server (confirm via the second browser or psql) with no data loss.
- [x] **No console errors during sync.** Throughout the above, the console stays clean (no unhandled sync/rejection errors).

## 8. General / UI

- [x] **Navigation is consistent.** Home ↔ Session ↔ Templates ↔ Dashboard all navigate correctly, with working back navigation.
- [x] **No console errors anywhere.** Visit every screen — Login, Register, Forgot-password, Home, Session, Exercise picker, Templates, Dashboard — the console shows no errors.
- [x] **Layout is usable.** Screens render without overflow/clipping at a normal desktop width and a narrow (mobile-web) width.

---

### Notes
- Web has no locked-screen background alarm by design (Android is out of scope; web background alarms are out of scope). The rest timer on web is a visible countdown with an in-page cue only.
- Clean up test users/rows afterward if testing against a shared DB: `docker exec workouty-postgres-1 psql -U workouty -d workouty` and delete by `user_id` (sets → session_exercises → sessions → template_exercises → templates → custom exercises → refresh_tokens → users, in FK-safe order).
