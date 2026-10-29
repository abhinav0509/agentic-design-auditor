# D-011: Toolchain

- **Date:** 2026-10-29
- **Decision:** pnpm workspaces, TypeScript 6.0.3 strict, ESLint 10 + typescript-eslint strict-type-checked, Prettier, Vitest 5. Node 24 runs `.ts` directly (type stripping), so there's no build step for tools.
- **Context:** Phase 0 needs a toolchain where tests run on every push (v1.0 §17, addendum C).
- **Options:**
  - A: TypeScript 7 (native compiler). Faster, but typescript-eslint 8.71 supports only TS < 6.1, so type-aware lint would break.
  - B: TypeScript 6.0.3. Fully supported by the lint stack.
  - Turborepo now vs later: with two packages, root scripts are enough.
- **Chosen:** B. Turborepo is deferred until CI across packages takes more than ~3 min. All versions were published at least 7 days before today (addendum 2.10). Local pnpm is 9.15.4, pinned via `packageManager`. pnpm 10+ would add native `minimumReleaseAge`.
- **Evidence:** `pnpm view typescript-eslint peerDependencies` → `typescript: ">=4.8.4 <6.1.0"`.
- **Revisit:** when typescript-eslint supports TS 7, when CI takes more than 3 min, or at Phase 1 start (pnpm upgrade).

Pinned: @eslint/js 10.0.1, eslint 10.13.0, prettier 3.9.10, typescript 6.0.3, typescript-eslint 8.71.2, vitest 5.0.5, yaml 2.9.1, @types/node 24.19.2. GitHub Actions are pinned by commit SHA in `ci.yml`.
