# plex-channels pickers are a themed `Listbox`, not the native `Select`

- **Status:** Accepted
- **Date:** 2026-08-07
- **Type:** UI / component choice
- **Supersedes:** —
- **Superseded by:** —

## Decision

Every **non-modal** single-select picker in plex-channels is a Charcuterie **`Listbox`**
(behind a `Button` trigger), not the native `Select`. The app-local
`web/src/components/SelectListbox.tsx` adapter carries the old `Select` prop shape
(`id`/`label`/`value`/`onChange`/`options`) so the swap is mechanical.

Converted (non-modal): the Play-landing **tier picker** (`ChannelRow`), the **channel** and
**profile** pickers (`#chchannel` / `#chprofile`), the queue **Add-to position** pickers
(queue view + toolbar), the per-item **episodes-per-play**, and the selection-bar **Move-to**.

**Exception — pickers INSIDE a modal stay native `Select` for now:** SetModal (`set-kind`),
DynModal (`dyn-behavior`, `b-profile`), StartModal (`start-series` / `start-season` /
`start-episode`). See "The modal blocker" — this is a known gap with a named follow-up, not
a place native `Select` is preferred.

This reverses the app's earlier "native `Select`" default. That default only ever existed
because `@charcuterie/ui` had **no** `Listbox`/`Combobox` — the owner accepted native as a
stopgap. `@charcuterie/ui@2.0.0` (M8) shipped both, so the stopgap is over.

## Context

The owner, in the running app, flagged three native dropdowns as wrong — the tier picker,
the channel/profile pickers, the Add-to position — and stated the rule directly:

> *"I don't wanna use any native Select components. I only told the agent some time ago
> because we didn't have a Listbox or Combobox component. Now that we do, I'd prefer that
> one."*

This also settles the coexistence question the 2026-08-03
[`handoff-charcuterie-listbox-combobox`](../handoff-charcuterie-listbox-combobox.md) left
open. That handoff said "keep native for plain lists"; the owner has decided plex-channels
does not — themed consistency wins here, and `Listbox` keeps type-ahead + full keyboard nav,
forfeiting only form-submission / `:invalid` / autofill / the mobile wheel, none of which
these controls use.

## The modal blocker (why in-modal pickers are still native)

plex-channels' `Modal` is a **native `<dialog>` + `showModal()`** (top layer). Charcuterie's
`Listbox` portals its panel to `document.body`, which is **below** the dialog's top layer —
so inside a modal the dropdown renders *behind* the modal and cannot be clicked (proven:
Playwright's option click is intercepted by the in-dialog element every time). Charcuterie's
own `Dialog` avoids this by portalling to `document.body` instead of the top layer (its M8
decision), but plex-channels uses its own top-layer `Modal`.

So finishing the in-modal pickers needs one of:

1. **Refactor `Modal` off `showModal()`** to a body-portalled overlay (like Charcuterie
   `Dialog`) — re-implements the free focus-trap / `::backdrop` / inert / `dialog[open]`
   e2e contract the current Modal leans on.
2. **Adopt Charcuterie's `Dialog`/`Modal`** wholesale.

Both are larger than this change and carry their own decision; until one lands, in-modal
pickers stay native `Select` (fully functional — a native `<select>` popup is OS-rendered
and sits above the top-layer dialog). **This is the one open TODO of this decision.**

## Consequences worth knowing

- **`#chchannel` lost its option groups.** `Listbox` has no `optgroup`; the channel picker
  is now flat (dynamic channels first, then curated). Acceptable for a short list.
- **e2e drives pickers differently.** No native `<select>`, so `selectOption` is gone: the
  trigger keeps the old id as **`data-testid`**, each option's label carries **`data-value`**,
  and `e2e/pick.mjs` opens the trigger and clicks `[role=option]`. It closes by re-clicking
  the trigger — **never Escape**, which would close a parent `<dialog>`.
- One-owner state holds: `SelectListbox` seeds the `Listbox` from `value` and reports back
  via `onChange`, exactly as the uncontrolled native `Select` did — so
  [2026-08-02-uncontrolled-components-are-keyed-on-their-second-writer](2026-08-02-uncontrolled-components-are-keyed-on-their-second-writer.md)
  still applies (no `key`).

## Evidence

- Owner quote above (this session), plus the two earlier flags: *"something is very wrong…
  the Select"* (the Play-landing dropdowns) and *"this is the wrong dropdown component… a
  native select from Charcuterie."*
- CI browser suites green after the change: `channels-test`, `ui-test`, `kbd-undo`,
  `homedrag`, `sse`; `verify-pr4-cutover` green end to end.
- The modal occlusion is reproduced in `verify-profile-bindings` / the DynModal `b-profile`:
  the portalled option click is intercepted by the top-layer dialog — the reason those
  reverted to native.
