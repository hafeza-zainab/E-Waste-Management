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
| 10 | Landing-page scenario buttons open `/owner/new?scenario=...`, which prefills the intake form. | Fast, scripted demo entry. |
| 11 | Default model is `claude-opus-5-5` (one constant in `lib/ai/config.ts`, overridable with `ANTHROPIC_MODEL`). | Current recommended model per Anthropic docs. Cheaper models can be swapped in with the env var. |
| 12 | Environmental impact is computed in code from `lib/impact`, never by the model. | Transparent, auditable, testable. |
| 13 | Demo mode = `DEMO_MODE != "false"` OR no `ANTHROPIC_API_KEY`. | Judges never hit a missing-key error. |
| 14 | The swollen-battery fixture simulates a model wrongly suggesting `diy`; the code gate overrides it to `technician`. | Makes the code-level safety gate visible in the demo. Real-mode output is never altered except by the gate. |
| 15 | Demo-mode free-text cases are keyword-matched to a scripted scenario, else get a clearly labelled generic fixture. | The app stays usable without a key but never pretends to be a real diagnosis. |
| 16 | DIY guide route re-checks `diy_allowed` on read, and `generateGuide` refuses when it is false. | Defence in depth for the safety rule. |
| 17 | Uploads are identified by magic bytes, limited to 4 MB, saved to `public/uploads` with random names. | Never trust client MIME type or filename. Files are ephemeral on Render free tier. |
| 18 | Booking/quote CTAs for technician, donate and recycle paths are intentionally absent until Phases 3, 5 and 6. | No fake buttons. |
