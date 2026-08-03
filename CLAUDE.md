# Workouty

## Comments

Do not comment by default. Code states what it does; a comment that restates it is noise that
rots the moment the line beneath it changes.

Write a comment only when it carries something the reader cannot recover from the code:

- **A decision with a rejected alternative.** Why this approach and not the obvious one.
- **A trap.** Something that looks removable or wrong but isn't, and that breaks if touched.
- **A constraint from outside the file.** A third-party bug, a protocol requirement, a version
  pin, an ordering dependency another service imposes.

Never write:

- Section labels — `# Sources`, `# Install deps`, `# ---- Config ----`.
- Restatements — `# Published host ports` above a `ports:` block, `// increment counter`.
- Usage examples already in the README.
- Change narration — `// renamed from X`, `// added for the new feature`. Git records that.

Length follows stakes, not politeness: one line for most things, a paragraph only when the
reasoning genuinely needs it. When in doubt, leave it out — an absent comment costs a minute
of reading, a wrong one costs a debugging session.
