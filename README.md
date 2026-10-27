# ReLoop

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)

An AI repair agent that diagnoses a broken device, decides whether a DIY fix is safe, books and pays a local technician through PayPal, and only releases the technician's payout after the repair is verified. Built for the PayPal AI Hackathon.

> Status: Phase 1 (scaffold). The full README (architecture, PayPal and AI usage, test accounts, limitations) is written in Phase 7.

## Quick start

```bash
cp .env.example .env
npm run setup   # install, generate Prisma client, migrate, seed
npm run dev     # http://localhost:3000
npm test
```

`DEMO_MODE=true` (the default) needs no API keys. PayPal is always sandbox.

## License

MIT, see [LICENSE](LICENSE).
