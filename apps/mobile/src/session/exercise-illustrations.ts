// Movement illustrations for the built-in exercise library, drawn from the everkinetic open
// data project (CC BY-SA 4.0 — see assets/exercises/SOURCE for provenance and the attribution
// this app owes it).
//
// Keyed by exercise NAME, and it has to be: seeded exercise ids are gen_random_uuid()
// (apps/api/src/db/columns.ts), so the same built-in has a different id in every deployment and
// no client-side table can reference one. `exercises_global_name_uq` makes the name unique among
// live global rows, which makes it the only stable client-visible key. The cost is that a rename
// in seed-exercises.sql silently orphans a drawing — exercise-illustrations-seed.test.ts is the
// guard, and carries the note on what it can and cannot catch.
//
// Deliberately NOT exhaustive: 44 of the 83 built-ins. Everkinetic's naming and coverage do not
// line up with this library's (it has no plain deadlift-free RDL, no plank, no sit-up, no Russian
// twist, and its remaining artwork skews to machine variants), so the mapping is hand-authored
// and every entry was checked against the rendered drawing. Two rules held while authoring it,
// and hold for anything added later:
//
//   1. Map a drawing only when it unambiguously depicts THAT movement. Wrong artwork is worse
//      than none — the preview screen's empty state is a designed outcome, not a failure.
//   2. Sharing one drawing across rows is fine where it genuinely fits both (the close-grip and
//      diamond push-ups below); a different movement pattern never substitutes. 'Romanian
//      deadlift (barbell)' is absent for this reason: upstream's RDL art is its conventional
//      deadlift art mirrored, bar on the floor and knees bent.
//
// No asset imports here on purpose — this module stays importable under the repo's
// node-environment vitest. The require table lives in exercise-illustration-assets.ts.

export type ExerciseIllustration = {
  // Zero-padded upstream `id_num`; names both frame files and keys ILLUSTRATION_ASSETS.
  slug: string
  // Upstream's own title for the drawing, shown in the preview's attribution line so the credit
  // is traceable to a specific work even where upstream names the movement differently.
  title: string
}

export const EXERCISE_ILLUSTRATIONS: Record<string, ExerciseIllustration> = {
  'Bench press (barbell)': { slug: '0042', title: 'Bench Press' },
  'Bench press (dumbbell)': { slug: '0055', title: 'Bench Press Dumbbell' },
  'Incline bench press (barbell)': { slug: '0043', title: 'Incline Bench Press' },
  'Incline bench press (dumbbell)': { slug: '0061', title: 'Dumbbell Incline Bench Press' },
  'Decline bench press (barbell)': { slug: '0051', title: 'Decline Barbell Bench Press' },
  'Decline bench press (dumbbell)': { slug: '0052', title: 'Decline Dumbbell Bench Press' },
  'Push-up': { slug: '0077', title: 'Push Ups' },
  'Close-grip push-up': { slug: '0188', title: 'Close Triceps Pushup' },
  'Diamond push-up': { slug: '0188', title: 'Close Triceps Pushup' },
  'Decline push-up': { slug: '0075', title: 'Push Up with Feet Elevated' },
  'Overhead press (barbell)': { slug: '0004', title: 'Seated Military Press' },
  'Lateral raise (dumbbell)': { slug: '0018', title: 'Lateral Dumbbell Raises' },
  'Rear delt fly (dumbbell)': { slug: '0032', title: 'Bent Over Rear Deltoid Raise With Head On Bench' },
  'Front raise (dumbbell)': { slug: '0033', title: 'Front Dumbbell Raise' },
  'Pull-up': { slug: '0087', title: 'Pull Ups' },
  'Close-grip lat pulldown (cable)': { slug: '0096', title: 'V Bar Pull Down' },
  'Underhand lat pulldown (cable)': { slug: '0095', title: 'Underhand Pull down' },
  'Underhand bent-over row (barbell)': { slug: '0026', title: 'Reverse Grips Bent Over Barbell Rows' },
  'Seated row (cable)': { slug: '0025', title: 'Seated Cable Rows' },
  'Straight-arm pulldown (cable)': { slug: '0092', title: 'Straight Arm Push Down' },
  'Pullover (dumbbell)': { slug: '0079', title: 'Straight Arm Dumbbell Pullover' },
  'Deadlift (barbell)': { slug: '0099', title: 'Barbell Dead Lifts' },
  'Deadlift (dumbbell)': { slug: '0107', title: 'Dumbbell Dead Lifts' },
  'Back squat (barbell)': { slug: '0122', title: 'Barbell Squat' },
  'Front squat (barbell)': { slug: '0138', title: 'Front Squat with Barbell' },
  'Squat (dumbbell)': { slug: '0130', title: 'Squats using Dumbbells' },
  'Hack squat (machine)': { slug: '0123', title: 'Hack Squat Machine' },
  'Leg press (machine)': { slug: '0127', title: 'Leg Press' },
  'Lunge (dumbbell)': { slug: '0115', title: 'Dumbbell Lunges' },
  'Leg curl (machine)': { slug: '0117', title: 'Lying Leg Curl Machine' },
  'Leg extension (machine)': { slug: '0142', title: 'Leg Extensions' },
  'Calf raise (machine)': { slug: '0282', title: 'Standing Calf Raises using Machine' },
  'Bicep curl (dumbbell)': { slug: '0224', title: 'Biceps Curl with Dumbbell' },
  'Bicep curl (barbell)': { slug: '0211', title: 'Biceps Curls with Barbell' },
  'Bicep curl (cable)': { slug: '0212', title: 'Standing Biceps Curl with Cable' },
  'Hammer curl (dumbbell)': { slug: '0227', title: 'Biceps Hammer Curl with Dumbbell' },
  'Hammer curl (cable)': { slug: '0216', title: 'Hammer Curls with Rope and Cable' },
  'Overhand triceps pushdown (cable)': { slug: '0205', title: 'Triceps Pushdown with Cable' },
  'Underhand triceps pushdown (cable)': { slug: '0189', title: 'Reverse Grip Triceps Pushdown' },
  'Overhead triceps extension (dumbbell)': { slug: '0198', title: 'Standing Triceps Extension' },
  'Overhand skull crusher (barbell)': { slug: '0183', title: 'Lying Triceps Press with Barbell' },
  'Crunch': { slug: '0291', title: 'Crunches' },
  'Reverse crunch': { slug: '0287', title: 'Bent Knee Hip Raise' },
  'Leg raise': { slug: '0021', title: 'Flat Bench Leg Raises' },
}

// Exact match, by design: no trimming, no case folding, no fuzzy fallback. Fuzzy matching was
// measured against this library and paired 'Deadlift' with 'One Arm Side Deadlift with Barbell',
// which is precisely the silent-wrong-artwork failure rule 1 above exists to prevent. A custom
// exercise the user typed simply has no drawing, and null is the right answer.
export function getIllustration(exerciseName: string): ExerciseIllustration | null {
  return EXERCISE_ILLUSTRATIONS[exerciseName] ?? null
}
