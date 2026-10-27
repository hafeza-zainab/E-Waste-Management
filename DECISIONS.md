# Decisions and assumptions

| # | Decision | Why |
|---|----------|-----|
| 1 | Separate git repo created inside the project folder (`git init -b main`). | The parent directory is a git repo covering the whole home directory; nesting keeps hackathon history clean. |
| 2 | Next.js 16 with `cacheComponents` and `partialPrefetching` turned **off**. | Every page reads per-request state (cookie role, SQLite). Classic dynamic rendering avoids wrapping every read in Suspense. |
| 3 | Prisma pinned to v6. | v7 requires driver adapters and a config file; v6 keeps `npm run setup` simple for judges. |
| 4 | `.npmrc` sets `legacy-peer-deps=true`. | npm 10 crashes (`edgesOut` arborist bug) resolving vitest's optional peers. |
| 5 | shadcn-style components are hand-written in `components/ui` (cva + tailwind-merge) with a `components.json`. | The shadcn CLI is interactive and assumes a PostCSS Tailwind setup; this scaffold uses the Turbopack Tailwind loader. |
| 6 | Statuses and types are strings validated in TypeScript/zod, not DB enums. | Prisma does not support enums on SQLite. |
| 7 | Money is stored as integer cents everywhere. | Avoids float drift in fee/payout maths. |
| 8 | Platform fee applies to the whole job total (default 10%, `PLATFORM_FEE_BPS`). | Simple, visible, testable. |
| 9 | Role switcher is a plain httpOnly cookie, no authentication. | Per brief; demo only. |
| 10 | Landing-page scenario buttons link to `/owner?scenario=...` until the Phase 2 intake exists. | Keeps every button functional at each phase. |
