# AutoGear

AutoGear is an accessible web application that helps people figure out the *next office equipment upgrade that will improve their setup and pain points that the user has*, recommending the most compatible products the user may not even know about.

Most shopping tools start with "What do you want to buy?" AutoGear starts with "What do you already own, what is frustrating, what space or budget constraints matter, and what would make the biggest difference?" It turns that context into a ranked, explainable upgrade plan.

> AutoGear does not recommend what you search for. It recommends what would remove friction from your setup.

## Project Description

AutoGear is an explainable recommendation app for desk, study, and work setups. A user can describe their pain points, budget, room constraints, and current gear, then AutoGear identifies the highest-impact upgrade categories and the specific models that best fit their needs.

This is built for a hackathon demo, so the product is intentionally visual, fast to understand, and easy to present:

- a clean landing page with instant demo mode,
- a guided onboarding flow,
- inventory capture through manual entry or video scan,
- a recommendation dashboard with score breakdowns and reasoning,
- optional live pricing and watchlist alerts,
- admin tooling that shows the system is real, inspectable, and extensible.

## Problem

We live in a world filled with technologies nowdays. With work styles leaning more and more towards spending time in front of laptops, a comfortable office space is crucial for maintaining long-term health and well being.

However, people often waste money upgrading the wrong thing first.

For example, someone might think they need a new laptop, when the real high-impact fix is a monitor, stand, chair, or better lighting. AutoGear is designed to catch those hidden bottlenecks and recommend the upgrade with the best payoff for that person’s actual setup.

## Unique Traits

- **Context-first recommendations**: uses current inventory, problems, budget, preferences, room constraints, and optional private fit data.
- **Explainable ranking**: every recommendation is backed by deterministic scoring instead of a black-box answer.
- **Model-level suggestions**: the app does not stop at "buy a monitor"; it ranks specific products.
- **Inventory-aware logic**: recommendations change based on what the user already owns and how good or bad that gear is.
- **Fit-aware scoring**: private profile inputs like hand fit, comfort priorities, and sensitivities improve mouse, keyboard, chair, and display recommendations.
- **Price-aware decisions**: cached or refreshed pricing can move products up or down in the ranking.
- **Privacy**: MongoDB to store all sensitive data the user inputed, and authentication through Clerk for user protection

## Features

### 1. Guided setup understanding

- Multi-step onboarding for budget, problems, preferences, ports, device type, and room constraints.
- Separate private profile for fit and comfort data such as hand size, grip style, sensitivities, and ergonomic priorities.
- Local demo fallback when auth is not configured, so the full product can still be explored quickly.

### 2. Smart inventory capture

- Manual inventory entry for laptops, monitors, keyboards, mice, chairs, lamps, headphones, webcams, and more.
- Device lookup that merges Mongo-backed rated catalog entries with optional Best Buy search results.
- Exact model/config capture so the engine can distinguish vague ownership from known hardware.
- Browser-based video scan using TensorFlow.js COCO-SSD, with review before saving anything.

### 3. Explainable recommendation engine

- Identifies the user’s biggest upgrade opportunities first.
- Ranks upgrade categories before ranking specific products.
- Shows product score breakdowns, fit score, trait delta score, tradeoffs, and why alternatives were rejected.
- Includes filters like under budget, available only, quiet products only, and small-space friendly.
- Includes product detail pages with ranking-change explanations and availability summaries.

### 4. Live value signals

- Watchlist/save flow for interesting products.
- In-app alerts for price drops, target hits, availability changes, score jumps, and top-3 movement.
- Asynchronous background price refresh architecture with quota-aware behavior for external APIs.

### 5. Admin and technical depth

- Admin control room for quota, jobs, recommendation drift, scan telemetry, and narrator health.
- Device intelligence tools for normalized specs, trait ratings, validation, and import/export.
- Training-data tooling for capturing recommendation examples for future model tuning.
- Catalog review surfaces that make the system feel maintainable, not just hardcoded.

## How The Recommendation Engine Works

AutoGear uses a deterministic scoring system, which is important for both trust and demo clarity.

The app first decides **which category matters most** for the user, then ranks **which product inside that category** is the best fit.

Current product-score weights:

```text
finalScore =
  problemFit       * 0.22 +
  traitDeltaFit    * 0.20 +
  ergonomicFit     * 0.18 +
  constraintFit    * 0.13 +
  valueFit         * 0.14 +
  compatibilityFit * 0.05 +
  availabilityFit  * 0.05 +
  confidence       * 0.03
```

This lets AutoGear explain not just *what* it recommended, but *why*:

- what pain points the product solves,
- how much better it is than the current device,
- whether it fits the desk, room, and portability constraints,
- whether the price is worth it,
- whether the system has enough confidence in the recommendation.

## AI Usage

AutoGear includes an optional narration layer powered by hosted Gemma through the Gemini API.

The important design choice is that AI is **not** the source of truth for ranking. The LLM only turns deterministic outputs into better explanation copy. If Gemini is unavailable, the app falls back to deterministic explanation text.

That means the scoring, budget logic, ranking order, and availability state remain stable and inspectable.

## Demo Story

### Fastest demo

1. Open `/`.
2. Click `Run demo mode`.
3. Go to `/recommendations`.
4. Show the top life gap, top category, and top product.
5. Save a product to the watchlist.
6. Run a refresh from `/admin/api-usage`.
7. Open `/alerts` to show the pricing/watchlist payoff.

### Stronger full walkthrough

1. Run a video scan on `/scan`.
2. Save a few inventory suggestions.
3. Add an exact device in `/inventory`.
4. Add comfort and fit details in `/profile`.
5. Re-open `/recommendations` and show how the ranking changes.
6. Open `/admin` to show the system’s internal depth.

## Tech Stack

- Next.js App Router
- React 19
- TypeScript
- Tailwind CSS
- MongoDB
- TensorFlow.js COCO-SSD
- Optional Clerk auth
- Optional PricesAPI integration
- Optional Gemini / Gemma narration

## Architecture Highlights

- MongoDB stores profiles, inventory, recommendations, alerts, cached availability, job runs, narrator cache, training examples, users, and the device catalog.
- PricesAPI is background-only, so the UI reads cached availability instead of blocking on live requests.
- Best Buy search is used only to enrich device lookup during inventory entry.

## Local Setup

### Prerequisites

- Node.js 20+
- npm
- a MongoDB instance, local or Atlas

### Environment

Copy `.env.example` to `.env.local` or `.env`.

Required:

```bash
MONGODB_URI="mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/lifeupgrade"
MONGODB_DB_NAME="lifeupgrade"
```

Optional:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
BESTBUY_API_KEY=
PRICES_API_KEY=
GEMINI_API_KEY=
DEV_USER_ID="dev-user"
```

### Run locally

```bash
npm install
npm run db:setup-indexes
npm run db:seed-devices
npm run dev
```

Then open `http://localhost:3000`.

## Useful Scripts

```bash
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
npm run job:refresh-prices
npm run db:check
npm run db:seed-devices
npm run verify:mongodb-migration
```

## Current Limitations

- Video scan is estimate-only and does not identify exact models reliably.
- Best Buy search results are helpful for manual entry, but unrated results still behave like custom devices.
- PricesAPI is quota-limited and intentionally background-only.
- Alerts are currently in-app only.
- The project is optimized for a narrow scope, instead of entire home upgrades
