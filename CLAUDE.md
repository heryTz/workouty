# CLAUDE.md

- For `apps/mobile`, Expo HAS CHANGED: Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.
- Do not add comments to code unless they are very useful (i.e. the logic is non-obvious and cannot be made self-evident by better naming).
- Prefer `type` over `interface` unless the shape will be implemented by a class (`implements`).
- Never commit brainstorming design specs or implementation plans, and never write them under `docs/`. Write them to `.superpowers/specs/` and `.superpowers/plans/`, which are git-ignored. They are session scaffolding, not project documentation. This overrides the superpowers skills' defaults (`docs/superpowers/**` and "commit the design document to git").
- Inside React components, prefer arrow functions over `function` declarations for handlers and callbacks.
