# App Store Screenshot Capture — Checklist for Browser Task

Capture on the **live site**: https://mrc-barbershop-mrc-0043.vercel.app

## Viewport (critical)
- CSS size **430 × 932**, `deviceScaleFactor: 3`, `isMobile: true`
- Output PNG will be **1290 × 2796** = iPhone 6.7" native. Save raws here:
  `~/workspace/mrc-barbershop/assets/store/screenshots/raw/`
- After capture, run: `python3 ~/workspace/mrc-barbershop/assets/store/screenshots/make_sizes.py`
  (produces the 6.7/ and 6.5/ sets automatically)

## Login
`/customer` shows a login gate ("Log in or create an account to book your cut").
Log in first with the **reviewer demo account** — credentials are in
`~/workspace/mrc-barbershop/assets/store/REVIEW_NOTES.md` (do not paste them into chat).

## Screens (in order, portrait, no marketing overlays)
1. **Branches / home with map** — after login, the branch list + map (gold/cream theme,
   wait ~3s for Esri map tiles to load).
2. **Booking flow** — tap a branch → pick a barber → service + date/time picker with
   available slots visible.
3. **Barber profile** — tap a barber's photo → bottom-sheet profile with photo,
   stars, reviews, verified skills.
4. **Offers** — `/customer/offers`: Monthly Plan + Mix & Match black cards.
5. **My appointments** — customer "My appointments" (may be empty for the demo
   account — if empty, still capture; or book a test slot with Stripe test card
   4242 4242 4242 4242 first).
6. *(bonus)* **Gift page** — `/customer/gifts` with gift QR.

Aim for **5 screenshots** (minimum 3 per Apple).

## Quality notes
- Hide scrollbars in screenshots.
- Keep the gold/cream light theme visible (not dark mode).
- Real app content only — no mockups, no invented text.
- Text must stay readable at thumbnail size.
