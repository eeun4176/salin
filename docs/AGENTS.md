# Notes for Coding Agents

Instructions for AI coding assistants (Claude Code, Codex, Copilot and others) working on e-Vet. The full project rules are in [`CLAUDE.md`](../CLAUDE.md) at the repository root; this page is the short version, plus what applies to both repositories.

## The two repositories

| Repository | App | Read first |
|---|---|---|
| `salin` | e-Vet Field (offline PWA for Paravets) | `CLAUDE.md`, [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| `city-vet-admin` | e-Vet Admin (dashboard + API) | `README-BACKEND.md`, `docs/README.md` |

## Rules that must never break

1. **No uploads of documents or images.** e-Vet Field sends only values, through `src/core/admin/admin-api.ts`, and writes go through the outbox (`src/core/sync/outbox.ts`).
2. **AI proposes, validation checks, the user approves.** AI output is a suggestion with its source, never written silently. AI never runs code; it picks from the fixed command list in `src/core/processing/dataset-commands.ts`.
3. **Everything works without AI models**, and on devices without WebGPU ("unsupported on this device" instead of failing).
4. **Preview before destructive changes, Undo after.**
5. **Untrusted input:** validate file types and sizes; neutralise formulas in spreadsheet exports.
6. **Accessibility:** don't use colour alone; keep keyboard focus visible; phone layouts have a 16 px gutter and no sideways scrolling.
7. **Storage names stay "Salin" and "e-Kapon".** Renaming the `SalinAI` database, `salin*` keys or the `ekapon` schema would lose users' data.

## Working conventions

- Every source file starts with a `/** Title` comment and a one-paragraph description.
- Match the surrounding code: naming, comment density, long lines (~180 columns), the `@/` import alias.
- Logic goes in `src/core/` with unit tests next to it; heavy work runs in Web Workers.
- Some files use CRLF line endings. Keep them; Git Bash `sed -i` turns CRLF into LF.
- **Database changes:** in e-Vet Field, add a new `db.version()` in `src/core/storage/database.ts`. In e-Vet Admin, add a new numbered file in `db/` and regenerate `hosting/01-fresh-schema.sql` with `npm run hosting:schema`.
- **In `city-vet-admin`:** keep the existing code style with small, in-place edits. Type-check with `npm run typecheck`, not `npx tsc -b`, which writes `.js` files next to the sources.

## Before saying work is done

- **e-Vet Field:** `npm run lint`, `npx tsc -b`, `npm test`, and the affected Playwright specs (`npm run test:e2e`). Kill any stale `vite preview` on port 4173 first.
- **e-Vet Admin:** `npm run typecheck`, `npm test`, `npm run build`.
- **Commit and push only when the developer asks.**
