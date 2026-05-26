# FlowHire Subscription Plan — Recommendation

**Date:** 2026-05-26  
**Status:** Planning (not implemented)

---

## Overview

FlowHire will offer a freemium model with three tiers. The free tier is powered by the NVIDIA NIM API (no cost to the platform), and paid tiers use Claude models for higher quality, higher throughput, and advanced features.

---

## Tier Structure

### Free Tier — $0/month

**Powered by:** NVIDIA NIM (Llama 3.3 70B) — zero platform cost

| Feature | Daily Limit |
|---|---|
| AI job scoring | 10 scores/day |
| Resume tailoring | 1/day |
| Cover letter generation | 1/day |
| Job search & filters | Unlimited |
| Market Intelligence page | Unlimited |
| Saved jobs | Up to 50 |

**Notes:**
- Daily limits reset at midnight UTC
- Queue-based: max 2 concurrent scoring requests per user to respect NVIDIA's 40 req/min cap
- Quality is good for standard jobs; NIM may be slightly less nuanced on niche or highly technical roles
- No credit card required to sign up

**Why daily instead of monthly:**  
Daily limits encourage consistent re-engagement (users come back every day), which is better for retention than a monthly cap that gets burned in one session and then the user churns.

---

### Starter Plan — $9/month

**Powered by:** Claude Haiku 4.5 (fast, low-cost, high quality)

| Feature | Limit |
|---|---|
| AI job scoring | 50 scores/day |
| Resume tailoring | 5/day |
| Cover letter generation | 5/day |
| Bulk Score All (filters) | Yes — up to 200 jobs per run |
| Job search & filters | Unlimited |
| Market Intelligence | Unlimited |
| Saved jobs | Unlimited |
| Email tracking (Gmail sync) | Yes |
| Priority queue | Standard |

**Estimated AI cost to platform per active user:** ~$0.30–0.80/month  
**Margin at 100 users:** ~$820–870/month gross

**Target user:** Job seekers actively applying, want better quality than free, need bulk scoring.

---

### Pro Plan — $19/month

**Powered by:** Claude Sonnet 4.6 (highest reasoning quality)

| Feature | Limit |
|---|---|
| AI job scoring | Unlimited |
| Resume tailoring | Unlimited |
| Cover letter generation | Unlimited |
| Bulk Score All | Yes — unlimited jobs per run |
| Score All concurrency | 3x faster (3 parallel workers) |
| BYOK support | Yes (bring your own Claude/OpenAI key) |
| Job search & filters | Unlimited |
| Market Intelligence | Unlimited |
| Saved jobs | Unlimited |
| Email tracking | Yes |
| Resume versions | Multiple saved versions |
| Priority queue | High priority |
| Export jobs to CSV | Yes |

**Estimated AI cost to platform per active user:** ~$2–5/month (heavy users)  
**Margin at 50 users:** ~$700–850/month gross

**Target user:** Power users, career changers, professionals targeting competitive roles who want Claude-level quality on every interaction.

---

### BYOK Option (available on any paid tier)

Users can supply their own Anthropic or OpenAI API key. When a BYOK key is provided:
- All AI calls route through their key (zero AI cost to the platform)
- Platform fee reduced by $3/month as a goodwill discount
- Useful for users who already have API access through their employer or research institution

---

## Daily Limit Reset & Enforcement

### How it works

1. `users` table stores: `scores_used_today`, `resumes_used_today`, `covers_used_today`, `last_reset_date`
2. On every AI request, backend checks: if `last_reset_date < today`, reset all counters first
3. Then check: if `scores_used_today >= plan_limit`, return 429 with time-until-reset
4. Frontend shows remaining daily quota in the Score All panel and profile page

### Plan limits stored server-side

```
Free:    scores=10, resumes=1, covers=1
Starter: scores=50, resumes=5, covers=5
Pro:     scores=999999 (unlimited), resumes=999999, covers=999999
```

Limits are enforced **in the backend only** — never trust the frontend.

---

## NVIDIA NIM Integration (Free Tier Backend)

### How it routes

- Each user has a `subscription_tier` field: `free | starter | pro`
- On any AI call, backend selects the model:
  - `free` → NVIDIA NIM endpoint (Llama 3.3 70B)
  - `starter` → Anthropic Claude Haiku 4.5
  - `pro` → Anthropic Claude Sonnet 4.6
  - Any tier with BYOK key → user's own key, model as configured

### Rate limiting for NIM

- NVIDIA allows 40 requests/minute across the platform
- Add a server-side asyncio semaphore (or Redis rate limiter in production) to cap NIM calls at 35/min (5 buffer)
- Free users get queued; they see a "Position in queue: 3" message
- If queue depth > 20, return a friendly message: "High demand right now — try again in a few minutes"

### When NVIDIA NIM goes paid or is discontinued

- Switch free tier to Claude Haiku (estimated $0.05/user/month) — absorb as acquisition cost
- Or require BYOK for the free tier (users bring their own key, platform provides the UI)
- No changes to paid tiers needed

---

## Payment & Billing

### Recommended stack

| Component | Tool |
|---|---|
| Payments | Stripe (subscriptions + webhooks) |
| Billing portal | Stripe Customer Portal (self-serve cancel/upgrade) |
| Webhook events | `customer.subscription.created/updated/deleted` → update `subscription_tier` in DB |
| Trial | 7-day free trial of Pro on signup (no card required) |

### Flow

1. User signs up → `subscription_tier = "free"`
2. Clicks "Upgrade" → Stripe Checkout session
3. Payment success → Stripe webhook → update `subscription_tier` in DB
4. Cancellation → Stripe webhook → downgrade to free at period end (not immediately)

---

## Recommended Rollout Sequence

### Phase 1 — Usage tracking (no payment yet)
- Add `subscription_tier`, `scores_used_today`, `resumes_used_today`, `covers_used_today`, `last_reset_date` to `users` table
- Enforce daily limits in the backend
- Show quota in UI
- All users are on "free" tier — this validates the limit logic before money is involved

### Phase 2 — NVIDIA NIM for free tier
- Add model-routing logic: free → NIM, others → Claude
- Add asyncio semaphore for NIM rate limiting
- Test scoring quality on NIM vs Claude side-by-side

### Phase 3 — Stripe integration
- Add Stripe Checkout for Starter and Pro
- Webhook handler to update `subscription_tier`
- Add billing page to user profile
- Add upgrade prompts when free limits are hit ("You've used 10/10 scores today — upgrade for 50/day")

### Phase 4 — BYOK
- Add `byok_provider` and `byok_api_key` (encrypted) to user profile
- Route AI calls through user's key when present
- Apply $3/month discount via Stripe coupon

---

## Pricing Summary

| Tier | Price | Scores/day | Resume/day | Cover/day | Model |
|---|---|---|---|---|---|
| Free | $0 | 10 | 1 | 1 | NVIDIA NIM (Llama 3.3 70B) |
| Starter | $9/mo | 50 | 5 | 5 | Claude Haiku 4.5 |
| Pro | $19/mo | Unlimited | Unlimited | Unlimited | Claude Sonnet 4.6 |
| BYOK discount | -$3/mo | (same as tier) | (same as tier) | (same as tier) | User's own key |

---

## Revenue Projections (Conservative)

| Scenario | Free users | Starter | Pro | Monthly Revenue | AI Costs | Net |
|---|---|---|---|---|---|---|
| Early (100 users) | 80 | 15 | 5 | $230 | ~$20 | ~$210 |
| Growing (500 users) | 350 | 100 | 50 | $1,850 | ~$180 | ~$1,670 |
| Scale (2,000 users) | 1,400 | 400 | 200 | $7,400 | ~$700 | ~$6,700 |

Conversion assumption: ~15% free → Starter, ~5% free → Pro. Typical for productivity SaaS.

---

*Document prepared for internal planning. Implementation starts with Phase 1 when approved.*
