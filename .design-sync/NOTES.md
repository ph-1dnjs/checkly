# design-sync notes (Checkly → Claude Design "Checkly UI")

## Scope
- 2026-11-11 first sync, user-scoped to the **scenario editor's shared UI**: Button, Input (+PasswordInput, no own card), ActionTag, Icon, Modal. Screen-specific components (MarkerEditForm, DuplicateScenarioModal) and the other storybook pages (Foundations, Segmented, Badge·Tag, …) are deliberately excluded via `titleMap: null`. Widen scope by adding to `EXPORTS` in `build-ds.mjs` + a story + a titleMap entry.

## Build
- [GENERAL] The repo is an Electron app with no library `dist/`. `node .design-sync/build-ds.mjs` (= `buildCmd`) produces a package-shaped copy in `.design-sync/.cache/ds-pkg/` (esbuild ESM bundle of the `EXPORTS` list, tsc `.d.ts` tree + barrel, and `src/renderer/styles/index.css` bundled as `index.css`). Config `entry` points at it; run it before every converter/driver run.
- [GENERAL] CSS = the app's real `index.css` (all pages' legacy layer included, ~370 KB), not storybook's preview set: `.action-tag`, `.msi`, `.modal-backdrop`/`.manual-modal` live only there.
- Fonts: Material Symbols / Nunito via Google Fonts `@import`, D2Coding via jsdelivr — `[FONT_REMOTE]`, accepted. UI font is the system stack (Helvetica Neue / Apple SD Gothic Neo) — nothing to ship.
- `[TOKENS_MISSING]` --scenario-progress, --progress, --env-count, --fa-capture-color: set inline at runtime by app pages; expected, out of scope.

## Stories
- [GENERAL] Repo stories are spec-doc pages (`Overview`, using storybook-only `cp-*` classes from components.css that the bundle doesn't ship). For sync we added focused stories: `Button.Variants`/`IconAndDisabled`, `InputToggle.InputStates`, and new files `ActionTag.stories.tsx`, `Icon.stories.tsx`, `ModalDialog.stories.tsx` (the last three `import "../../styles/index.css"` so the storybook reference has the app styles). `Overview` of Button/Input is skipped via `overrides.skip`.
- titleMap keys are the normalized last title segment with spaces removed (`Input·Toggle`, `ModalDialog`). The existing `Components/Feedback/Modal` story is CSS-only markup (not the Modal component) → mapped to null; `ModalDialog` → `Modal`.
- Modal: `cardMode: single` (fixed backdrop). Input/ActionTag/Icon: `cardMode: column` ([GRID_OVERFLOW] wide).

## Re-sync risks
- `build-ds.mjs` `EXPORTS` is a hand list — a new shared/ui component won't sync until added there (plus a story).
- `Icon.stories.tsx` hardcodes the IconName list (Icon.tsx doesn't export it) — update it when icons change.
- Modal grades note a framing-only vertical offset of the fixed backdrop (viewport height differs); not a defect.
- The app stylesheet is shipped whole; page-level CSS churn re-ships `_ds_bundle.css` every sync (grades carry).
