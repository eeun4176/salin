# e-Vet Design System

One look for both apps: **e-Vet Field** (`salin`) and **e-Vet Admin** (`city-vet-admin`). It should be minimal and breathable, with subtle borders, one green, and the same light and dark themes.

Source of truth:
- e-Vet Field: the `--color-salin-*` tokens in `src/index.css`.
- e-Vet Admin: `tailwind.config.ts` (the `brand`, `slate`, `surface`, `canvas` and `night` colours), which mirrors them.

---

## 1. Colour

### Light theme

| Token (Field) | Admin class | Value | Use |
|---|---|---|---|
| `salin-primary` | `brand-500` | `#01A85A` | Buttons, links, focus ring, active icons, charts |
| `salin-primary-strong` | `brand-600` | `#018A4A` | Button hover |
| `salin-primary-soft` | `brand-50` | `#E6F6EE` | Soft green backgrounds (chips, notices, selected nav item) |
| `salin-primary-ink` | `brand-700` | `#016A39` | Green text on soft green |
| `salin-text` | `slate-900` | `#1D1F1E` | Body text |
| `salin-muted` | `slate-500` | `#5F6662` | Secondary text |
| `salin-subtle` | `slate-400` | `#858C88` | Hints, captions |
| `salin-canvas` | `canvas` / `slate-50` | `#F8FAF9` | Page background |
| `salin-surface` | `white` | `#FFFFFF` | Cards, inputs |
| `salin-tile` | `slate-100` | `#F1F4F2` | Segmented-tab track, hover fill |
| `salin-tile-hover` | — | `#E8EEEA` | Hover on tiles |
| `salin-border` | `slate-200` | `#E6EBE8` | Borders and dividers |
| `salin-border-strong` | `slate-300` | `#C9D1CC` | Input hover border |
| `salin-toast` | `#1D1F1E` | `#1D1F1E` | Toasts (dark in both themes) |

### Dark theme

Neutral greys that get lighter with elevation. The green stays the same, so white text on green buttons keeps its contrast. In e-Vet Admin these are the `night-*` colours, used as `dark:` classes.

| Token (Field) | Admin class | Value | Use |
|---|---|---|---|
| `salin-canvas` | `canvas-dark` / `night-canvas` | `#121212` | Page background |
| `salin-surface` | `surface-dark` / `night-surface` | `#1E1E1E` | Cards, inputs, selected segmented tab |
| `salin-bar` | `surface-bar` / `night-bar` | `#272727` | Sidebar and bottom bar |
| popover | `night-menu` | `#2E2E2E` | Menus and dropdowns |
| `salin-dialog` | `night-dialog` | `#383838` | Dialogs, sheets and the toast |
| `salin-tile` | `night-tile` | `#2C2C2C` | Segmented-tab track, hover fill |
| `salin-tile-hover` | `night-tile-hover` | `#363636` | Hover on tiles |
| `salin-border` | `night-border` | `#2F2F2F` | Borders and dividers |
| `salin-border-strong` | `night-border-strong` | `#474747` | Input hover border |
| `salin-text` | `night-text` | `#E8E8E8` | Body text |
| `salin-muted` | `night-muted` | `#A6A6A6` | Secondary text |
| `salin-subtle` | `night-subtle` | `#7F7F7F` | Hints |
| `salin-primary-soft` | `brand-900` | `#183626` | Soft green backgrounds |
| `salin-primary-ink` | `brand-300` | `#7FE0AE` | Green text on dark |

### Status colours

| Meaning | Colour | Examples |
|---|---|---|
| Done, approved, ready | Green (`brand`) | Approved, Completed, Redeemed, Validated |
| Waiting | Amber | Pending, Requested, Deferred |
| Stopped or wrong | Red | Rejected, Cancelled, Voided, errors |
| In hand or in progress | Sky | Issued, Gathering |
| Neutral or closed | Grey | Closed, Withdrawn, Not encoded |

**Never colour alone.** Every status also has its word ("Pending", "Approved"), every chart column carries its number, and confidence and validation show an icon or label too.

---

## 2. Type

- **Font:** Inter (bundled with `@fontsource/inter` in Field; Inter from the system or Google Fonts in Admin), falling back to the system UI font.
- **Page titles:** bold, tight tracking (−0.03em), `clamp(1.5rem, 4vw, 2rem)`.
- **Section headings:** semibold, 15–18 px.
- **Body:** 14–16 px; at least 16 px in inputs on phones, so iOS doesn't zoom.
- **Numbers in tables and KPI cards:** tabular figures (`tabular-nums`).
- **Status words:** sentence case, first letter capital ("In progress", not "in_progress" or "IN PROGRESS").

---

## 3. Shape, space and elevation

- **Radius:** inputs and buttons 8–12 px; cards 16–24 px; pills and nav items fully rounded.
- **Spacing:** a 4 px grid. Pages have a **16 px side gutter on phones** and no sideways scrolling.
- **Borders over shadows:** cards use a 1 px border; shadows are kept for things that float (menus, dialogs, the sidebar card, the selected segmented tab).
- **Phone touch targets:** at least 44 px tall.

---

## 4. Components

| Component | Field | Admin | Behaviour |
|---|---|---|---|
| Buttons | `components/ui/button` | `btnPrimary`, `btnGhost`, `btnDanger` | Green primary, outlined secondary, red for destructive; 1 px press |
| Inputs and selects | `ui/input`, `ChoiceMenu` | `inputCls`, `Select` | Subtle border, green border and soft green ring on focus |
| Segmented tabs | `seg-track` | `tabList` + `tabItem` | A tinted track; the selected tab is a raised surface pill that slides between tabs; normal text colour |
| Sidebar | `layout/sidebar.tsx` | `Sidebar.tsx`, `NavTree.tsx` | A floating card 12 px from the edges; folds to a 64 px rail; the current item is a faint green pill with a green icon |
| Bottom bar | `layout/mobile-nav` | — | Phones only (under 760 px) |
| Status badge | per feature | `StatusBadge`, `statusLabel` | Coloured pill with the status word, no dot |
| Toast | `common/toaster` | `AppShell` toast | Dark in both themes, a timer line, optional Undo or Refresh |
| Dialogs | `ui/dialog`, `ConfirmDialog` | `Modal`, `ConfirmDialog` | Destructive actions always ask first |
| Tables | dataset grid | `data-table` | Sticky tinted header, rows that tint on hover; cells that stack several values start on one top line |
| Charts | — | `ColumnChart`, `ComparisonBars` | Columns grow from the axis; the highest is solid green, the rest light green; each shows its number |
| Refresh | `RefreshButton` | `DataFreshness` | Shows when data was last loaded; pages also refresh themselves every minute |

---

## 5. Icons and motion

- **Icons:** lucide-react, outline style, 1.9 stroke, 16–20 px.
- **Motion:** short and springy (`ease-spring`). Pages fade between each other, menus unfold from their button, sidebar items stagger in, charts grow once.
- **Reduced motion:** with *reduce motion* on, animations and transitions are switched off.

---

## 6. Accessibility rules

- Keyboard focus is always visible: a green outline or ring.
- Colour is never the only signal (see Status colours).
- Text contrast meets WCAG AA in both themes.
- Every icon-only button has a label (`aria-label`) and a tooltip.
- Phone layouts work at 360 px wide, with a 16 px gutter and no sideways scrolling.

---

## 7. Brand

- **Names people see:** "e-Vet" with the subtitle "Field | City of San Jose del Monte" (Field) or "Admin | City of San Jose del Monte" (Admin), next to the City Veterinary Office seal.
- **Where they're set:** e-Vet Field's name and subtitle are in `src/components/brand/logo.tsx`, its app name and icons in the manifest (`vite.config.ts`). e-Vet Admin's are in its i18n messages (`app.name`, `app.city`).
