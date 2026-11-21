# HIMATIKA Universitas Trilogi — Official Portal & Management Vault

Official digital portal and internal management platform for **HIMATIKA Universitas Trilogi** (Himpunan Mahasiswa Teknik Informatika), built with **Next.js App Router**, **TypeScript**, **Tailwind CSS**, **GSAP**, and **Supabase**.

The platform combines a high-contrast dark-obsidian public showcase with a role-based operations console (**The Vault**) and PostgreSQL Row Level Security (RLS) for organization finances, work programs, and governance transparency.

---

## Key Features

### Public Portal
- **Home (`/`)**: Full-color progressive hero slideshow (`HeroSection`), dynamic featured work program slider (`ShowcaseSlider`), and editorial organization highlights.
- **About (`/about`)**: Dynamic organization profile, vision & mission, period indicator, and scroll-animated photo gallery powered by GSAP `ScrollTrigger` (`site_about`).
- **Organization Structure (`/struktur`)**: Interactive SVG circuit/blueprint diagram (`OrgBlueprint`) with 3D hover portrait reveals, multi-leader support for Pimpinan Himpunan, and a slide-over `DivisionDrawer` detailing responsibilities, members, and active programs per division.
- **Work Programs (`/proker` & `/proker/[slug]`)**: Filterable program catalog with sticky status/division filter bar (`KOLABORASI HIMPUNAN`, `PIMPINAN HIMPUNAN`, and divisions), detailed program pages, rundown timelines, WhatsApp contact actions, and lightbox photo galleries.
- **Public Financial Transparency (`/keuangan`)**: Read-only public ledger powered by `get_financial_summary()` and `v_public_finance_records` with month/year filters, pagination, and CSV export—exposing non-sensitive summaries while keeping internal notes and receipt files private.
- **Contact (`/contact`)**: Official contact details and direct inquiry form (`anon INSERT` via RLS) feeding into the internal Vault inbox.

### Internal Portal — The Vault (`/login` & `/vault`)
Protected by **Supabase Auth** (`@supabase/ssr` cookie-based PKCE sessions), **Next.js `proxy.ts`** route guard (`Cache-Control: no-store, ... private`), `noindex` directives, and database-enforced **RBAC** (`Admin`, `Bendahara`, `Medkraf`):
- **Kas & Kuitansi**: Cash balance KPIs, income/expense transaction management, private receipt uploads (`vault-receipts`) previewed via short-lived Signed URLs, CSV export, and printable LPJ report layout.
- **Kelola Program Kerja**: Work program CRUD, rundown editor, poster uploads, multi-photo gallery management, and automatic unused asset cleanup in `public-assets`.
- **Kelola Struktur**: Manage division leaders, photos, members, and responsibilities synced live to `/struktur`.
- **Kelola Tentang & Hero Slides**: Manage `/about` narrative, vision/mission, gallery photos, logo, and homepage hero slides.
- **Kotak Masuk**: Review and manage `/contact` submissions across `Belum Dibaca`, `Sudah Dibaca`, and `Diarsipkan` statuses.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | Next.js `16.4.6` (App Router, Cache Components, Server Actions), React `19.3.0`, TypeScript `5` |
| **Styling & Motion** | Tailwind CSS `v4`, GSAP `3.15`, Lenis Smooth Scroll, Lucide React |
| **Backend & Database** | Supabase PostgreSQL, Row Level Security (RLS), RPC, Supabase Storage |
| **Auth & Validation** | `@supabase/ssr` (HTTP-only cookies), Zod `v4` |
| **CI & Deployment** | GitHub Actions (`npm run lint` & `tsc --noEmit`), Vercel Edge Network & Cron (`/api/keep-alive`) |

---

## Project Structure

```text
├── .github/workflows/ci.yml   # Lint & TypeScript CI check
├── public/image/              # Local WebP/PNG assets
├── src/
│   ├── actions/               # Next.js Server Actions (Zod + cache invalidation)
│   ├── app/                   # App Router pages, API keep-alive, robots.ts, sitemap.ts
│   ├── components/            # Feature-scoped UI modules (home, proker, diagram, keuangan, about, auth, vault, common, ui)
│   ├── lib/
│   │   ├── auth/              # Session & role permission helpers
│   │   ├── data/              # Public cached queries & fallback seed datasets
│   │   ├── supabase/          # Public, server, browser, middleware & storage helpers
│   │   ├── site-url.ts        # Canonical URL resolver
│   │   └── utils.ts           # Formatters & CSV export helpers
│   ├── types/                 # Database & domain TypeScript definitions
│   └── proxy.ts               # Next.js 16 session interceptor & route guard
├── PROJECT.md                 # Product blueprint & feature scope
├── ARCHITECTURE.md            # System architecture, RLS matrix & data flow
├── DESIGN.md                  # Visual design tokens & UI guidelines
├── TASK.md                    # Phase 0–8 implementation tracker
└── vercel.json                # Keep-alive cron schedule for Supabase Free Plan
```

---

## Local Development

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
Create a `.env.local` file in the project root:
```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Optional locally; recommended in production to protect /api/keep-alive
CRON_SECRET=<random-secret-string>
```

### 3. Run development server & checks
```bash
# Development server (http://localhost:3000)
npm run dev

# Code quality & production build checks
npm run lint
npx tsc --noEmit
npm run build
```

---

## Documentation
* [PROJECT.md](./PROJECT.md) — Feature scope, organization divisions, and RBAC capabilities
* [ARCHITECTURE.md](./ARCHITECTURE.md) — Dual-plane architecture, database schema, and RLS security model
* [DESIGN.md](./DESIGN.md) — Dark Obsidian palette, `clamp()` typography scale, and interaction specs
* [TASK.md](./TASK.md) — Implementation phases and deployment checklist
