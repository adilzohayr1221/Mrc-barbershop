# Overnight QA Report — MRC Barbershop iOS App Store Submission
**Date:** 2026-10-06 (overnight, user sleeping)
**Scope:** Payment flows (test mode), reviewer account, rejection-risk audit

---

## 1. Payment Flow QA (Test Mode, via Live API)

### 1a. Booking Flow — ✅ PASS
- **PaymentIntent creation:** `POST /api/payments/intent` returns 200 with `clientSecret`, correct `$5.00` deposit for $40 service
- **Input validation:** Invalid date → 400, invalid barber → 400, missing fields → 400, unauthenticated → 401
- **Idempotency:** `POST /api/bookings` checks `bookings.some(b => b.paymentIntentId === paymentIntentId && b.status === 'booked')` → 409 on duplicate. One PaymentIntent = one booking. ✅
- **Stripe verification:** Server retrieves PaymentIntent from Stripe, verifies `status === 'succeeded'`, `currency === 'usd'`, amount matches expected deposit. Mismatch → 402.

### 1b. Membership Flow — ✅ PASS
- **Sync endpoint:** `POST /api/memberships/sync` with no subscription → 404 with helpful message ("No subscription found. If you just paid, wait a moment and try again.") — no crash.
- **Endpoints present:** subscribe, subscribe-custom, cancel, qr, redeem, status, sync — all routed.

### 1c. Gift Flow — ✅ PASS
- **Gift intent:** `POST /api/gifts/intent` returns 200 with `clientSecret` and correct amount
- **Endpoints present:** intent, purchase, claim, mine, redeem — all routed.

### 1d. Edge Cases — ✅ PASS
- Double-booking prevention: server checks `status === 'booked'` for same barber/date/time → 409
- Auth enforcement: all payment endpoints return 401 without valid Bearer token
- Amount validation: deposit capped at service price, minimum 50 cents enforced

### Limitations
- Full end-to-end (Stripe test card → confirmed PaymentIntent → booking created) was not executed because it requires client-side Stripe.js confirmation. The server-side verification logic is sound.
- Live-mode QA (real charges) is NOT done — blocked on `sk_live`/`pk_live` keys from user.

---

## 2. Apple Reviewer Demo Account

**Status:** ✅ Created (credentials also documented in `REVIEW_NOTES.md` by parent agent — no duplicate file created)

- **Email:** apple.reviewer@mrc-demo.com
- **Password:** Review123!
- **Name:** Apple Reviewer
- **Login:** Verified working (HTTP 200, valid JWT)

**Note on sample booking:** `REVIEW_NOTES.md` states "This account has a sample booking." This is aspirational — creating a booking requires a Stripe-confirmed PaymentIntent (server verifies `status === 'succeeded'` via Stripe API), which cannot be done server-side without the Stripe secret key. **The reviewer can create their own booking** using the test card (4242 4242 4242 4242) documented in the review notes. This is standard practice and acceptable.

**Recommendation:** Either (a) update REVIEW_NOTES.md to say "use the test card to create a booking" instead of claiming a pre-existing booking, or (b) manually create a booking via the UI once (using test card in browser) before submission.

---

## 3. Rejection-Risk Audit

### Pages checked (all HTTP 200):
- `/customer` — ✅
- `/customer/offers` — ✅
- `/customer/gifts` — ✅
- `/customer/profile` — ✅
- `/customer/appointments` — ✅
- `/privacy` — ✅

### Findings:
| Check | Result |
|---|---|
| Broken links / 404s | ✅ None found |
| Lorem ipsum / placeholder text | ✅ None found |
| "Test mode" / "test" wording visible | ✅ None found (removed in previous session) |
| TODO markers | ✅ None found |
| "Coming soon" text | ✅ None found |
| Broken images (empty src) | ✅ None found |
| External links opening in-app | ✅ WhatsApp share uses `target="_blank"` (opens externally) |

### Native Feature Verification (Guideline 4.2 defense):
| Feature | Implementation | Status |
|---|---|---|
| Camera | `capture="environment"` on file inputs (barber dashboard, complaints) | ✅ Works in iOS WebView |
| Geolocation | `navigator.geolocation` (branch sorting, map) | ✅ Works in iOS WebView |
| Push Notifications | `Notification` API + `EnableNotifications` component | ✅ Configured |
| Haptics | `src/lib/haptics.ts` (Capacitor Haptics → navigator.vibrate fallback) | ✅ Wired into payment success |
| Splash Screen | Capacitor SplashScreen plugin, 2s, brand color | ✅ Configured |
| Share Sheet | Web Share API + WhatsApp deep link | ✅ Present |

---

## 4. Issues Found

### Fixed during this session:
- None (no bugs found in tested flows)

### Open / Needs attention:
1. **Sample booking claim** (minor): `REVIEW_NOTES.md` claims the reviewer account has a sample booking, but it has 0 bookings. Either create one manually or reword the note.
2. **Live Stripe QA** (major, blocked): Full payment QA with real money not done. Blocked on user providing `sk_live`/`pk_live`.
3. **Screenshot generation** (pending): App Store screenshots not yet generated.

---

## 5. Remaining Risks for App Store Review

| Risk | Level | Mitigation |
|---|---|---|
| Guideline 4.2 (minimum functionality) | 🟡 Medium | Real native features in use (camera, GPS, push, haptics). Strong review notes drafted. Cannot eliminate entirely. |
| Test card confusion | 🟢 Low | Test card documented in review notes. UI has no test references. |
| Privacy labels | 🟢 Low | Privacy policy live at `/privacy`. Labels must be filled accurately in App Store Connect. |
| Demo account access | 🟢 Low | Account created and verified. Reviewer can log in. |

---

## Summary

**Tested:** 15+ API scenarios across booking, membership, gift, and validation flows — all passing.
**Created:** Apple reviewer account (verified login).
**Audited:** 6 key pages — no broken links, no placeholder text, no test wording, no in-app external links.
**Fixed:** Nothing (no bugs found).
**Blocked:** Live Stripe QA (needs user keys), screenshot generation, sample booking for reviewer.

The app is in good shape for submission from a technical QA perspective. The main remaining work is on the user's side (Apple activation, live Stripe keys) and App Store Connect listing (screenshots, privacy labels).
