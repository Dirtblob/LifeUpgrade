# LifeUpgrade Demo Script

## 3-Minute Demo

### 0:00 - 0:20 | Scan The Desk

Open `/scan`.

Say:

"LifeUpgrade starts with the user's real setup. The camera scan is local in the browser, and the detections are estimates, so the user reviews everything before it becomes inventory."

Show:

- Camera scan screen.
- Estimate labels and confidence.
- Review panel copy that says detections are estimates.

### 0:20 - 0:40 | Detect Laptop-Only Setup

Move to the scan review or describe the captured result.

Say:

"The app detects the shape of a laptop-only desk: laptop screen, no external monitor, no stand, and a setup that probably forces the user to hunch."

Show:

- Suggested laptop inventory item.
- Missing monitor and stand as inferred setup gaps.
- Local-processing privacy note.

### 0:40 - 1:00 | Confirm Inventory

Save approved scan items or open `/inventory`.

Say:

"Nothing from the scan is trusted blindly. The user confirms what is real, edits labels, and can add anything the model missed."

Show:

- Manual inventory cards.
- Add/edit controls.
- Scan notes marked as estimates.

### 1:00 - 1:20 | Select Exact Models

In `/inventory`, use autocomplete.

Say:

"Now the user selects exact products from autocomplete. Here I choose the laptop and mouse. LifeUpgrade imports specs like RAM, ports, screen resolution, or ergonomic flags, so scoring gets more precise."

Show:

- `MacBook Air M1` autocomplete result.
- A mouse result such as `Logitech Lift` or `MX Master 3S`.
- `Specs imported` preview.
- Saved inventory card with imported specs.

### 1:20 - 1:40 | Add The Life Context

Open onboarding or use the demo profile.

Say:

"The user reports neck pain, eye strain, low productivity, and a $300 budget. That changes the question from 'what laptop should I buy?' to 'what removes the most friction for $300?'"

Show:

- Problems selected: neck pain, eye strain, low productivity.
- Budget: `$300`.
- Practical constraints like desk width, ports, and portability.

### 1:40 - 2:10 | Reveal Recommendations

Open `/recommendations`.

Say:

"The app recommends a laptop stand and monitor above a new laptop. A laptop upgrade is not ignored, but it is deferred because cheaper ergonomic and screen-space fixes solve more of the stated pain first."

Show:

- Top next move.
- Category cards for laptop stand and monitor.
- Laptop lower in the demo priority stack.
- Score breakdown: problem fit, constraint fit, value fit, compatibility fit, availability fit, confidence.

### 2:10 - 2:30 | Show Prices And Ranking Movement

Point at product cards and price badges.

Say:

"Recommendations are price-aware. Cached prices still show a last-checked timestamp. Fresh prices can move a product up when it drops below the expected price or target price."

Show:

- `Cached price` or `Fresh price` badge.
- `Last checked ...` timestamp.
- Ranking changed reason.
- Available-only filter hiding unavailable products.

### 2:30 - 2:45 | Trigger Watchlist Alert

Save or show the watched product, then run refresh from `/admin/api-usage` or use the seeded demo refresh.

Say:

"The watchlist is not just a bookmark. When a watched product drops, becomes available, gains score, or enters the top three, LifeUpgrade creates an alert."

Show:

- Admin quota dashboard.
- Quota-safe refresh state.
- `/alerts` with the price-drop alert.

### 2:45 - 2:55 | Explain Gemma Fallback

Return to recommendations.

Say:

"Gemma can narrate the recommendation, but it never changes the scores. If Gemma is missing, invalid, or over quota, deterministic fallback copy explains the same underlying ranking."

Show:

- Narrator guardrail card.
- Deterministic score still visible.

### 2:55 - 3:00 | Closing Line

Say exactly:

"LifeUpgrade does not recommend what you search for. It recommends what would remove friction from your life."

## End Summary

What works:

- Landing page demo, onboarding, manual inventory, autocomplete spec import, scan review, recommendations, price-aware ranking, watchlist alerts, quota dashboard, admin catalog review, and Gemma fallback explanation.

What is mocked:

- Default availability uses the mock provider.
- Video scan detections are local browser estimates.
- In-app watchlist alerts exist, but email and push delivery are mocked/not implemented.

What requires API keys:

- Live PricesAPI needs `AVAILABILITY_PROVIDER=pricesapi` and `PRICES_API_KEY`.
- Hosted Gemma narration needs `GEMINI_API_KEY`; `GEMINI_MODEL` defaults to `gemma-4-26b-a4b-it`.

What is quota-limited:

- PricesAPI refreshes are limited by monthly, daily, and minute policy counters.
- Quota-limited states use cached prices and visible badges instead of hard user-facing errors.

Known limitations:

- Auth is optional; the MVP data path is MongoDB-backed.
- Admin catalog approval does not rewrite the seed catalog file.
- Scan output estimates categories, not exact models.
- Multi-region production would need a stronger distributed quota lock around live price refreshes.
