# Checkly UI — how to build with it

Checkly is a Korean-language desktop QA app (scenario editor, runs, reports). UI copy is Korean; keep it terse and task-focused (e.g. "저장", "취소", "삭제", "실행").

## Setup

No provider or wrapper is needed. Link `styles.css` (it pulls in the app's full stylesheet, tokens, and remote fonts) and load `_ds_bundle.js`; components live on `window.Checkly`:

```jsx
const { Button, Input, PasswordInput, ActionTag, Icon, Modal } = window.Checkly;
```

`PasswordInput` (Input + show/hide toggle) is exported too; it takes every `Input` prop except `type`/`trailing`.

## Styling idiom: component props + `--ck-*` tokens

- **Controls own their size.** `Button` and `Input` take `size="small"` (32px, default — all work screens) or `size="large"` (44px, sign-in/onboarding forms only). Never set height, padding, or font-size on them; the `style` prop type forbids it.
- **Button variants:** `primary` (one main CTA per screen), `secondary` (ordinary actions), `danger` (delete/stop — at most one per group), `ghost` (toolbar/icon actions). `iconOnly` makes a square icon button (give it `aria-label`). Omitting `variant` renders an unstyled `<button>` for custom clickable areas.
- **Input states via props:** `invalid`, `disabled`, `mono` (D2Coding — for identifiers, URLs, paths), `leading` / `trailing` slots.
- **Icon** is an inline SVG that follows `currentColor`; set `size` in px (14–24). Names: `add add_link arrow_back auto_fix_high check check_circle close content_copy data_object delete download drag_indicator dynamic_form edit error expand_more folder info link more_horiz play_arrow play_circle playlist_play refresh save settings stop_circle unfold_less unfold_more warning`.
- **ActionTag** renders a fixed 86px tag for a scenario step action: `goto fill fileUpload manualFill manualControl manualResult click hover select expectText expectNoText` (labels are Korean, built in).
- **Modal** is a headless shell: mount it only while open, and pass the app's classes — `backdropClassName="modal-backdrop"`, `className="manual-modal"`, with an `<h2>`, a `<p>`, optional `<label>`+`Input`, and a right-aligned `<div className="modal-actions">` of Buttons (secondary 취소 first, then the primary/danger action).
- **Layout glue** (your own wrappers) uses tokens, never raw hex: colors `var(--ck-color-text-ink | -text-body | -text-secondary | -text-mute)`, `var(--ck-color-canvas | -surface-subtle | -surface-hover)`, `var(--ck-color-line | -line-soft)`, accent `var(--ck-color-blue-action)` / `var(--ck-color-blue-tint)`, status `var(--ck-color-pass | -fail | -wait)`; spacing `var(--ck-dim-space-4 … -32)` (2,4,6,8,10,12,14,18,22,26,32,44); radii `var(--ck-dim-radius-base | -float | -pill)`; fonts `var(--ck-font-ui)` (body), `var(--ck-font-mono)` (code), `var(--ck-font-display)` (Nunito, brand headings only). Base text is 13px.

## Where the truth lives

- `styles.css` → `_ds_bundle.css`: every `--ck-*` token (`:root`) and component class (`.ck-btn*`, `.ck-input*`, `.action-tag`, `.modal-backdrop`, `.manual-modal`, `.modal-actions`).
- `components/<group>/<Name>/<Name>.prompt.md` and `.d.ts` for each component's props and examples.

## Example

```jsx
<div style={{ display: "flex", alignItems: "center", gap: "var(--ck-dim-space-8)", padding: "var(--ck-dim-space-12)", borderBottom: "1px solid var(--ck-color-line)" }}>
  <ActionTag action="fill" />
  <span style={{ flex: 1, color: "var(--ck-color-text-body)" }}>이메일 입력란</span>
  <Input mono defaultValue="qa@checkly.dev" style={{ width: 220 }} />
  <Button variant="ghost" iconOnly aria-label="복제"><Icon name="content_copy" size={16} /></Button>
  <Button variant="primary"><Icon name="play_arrow" size={16} />실행</Button>
</div>
```
