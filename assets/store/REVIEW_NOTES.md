# App Store Connect — Review Notes (Draft)

## Demo Account
Email: apple.reviewer@mrc-demo.com
Password: Review123!

Use the test card below to complete a test booking and see the full flow.

## Why This App Needs to Be Native (Guideline 4.2)

MRC Barbershop is not a website wrapper. It uses iPhone-specific capabilities as core functionality:

1. **Push Notifications** — Customers receive appointment reminders, booking confirmations, and "your barber is ready" alerts. These are essential for a booking app and impossible in a browser tab.

2. **Camera** — Barbers photograph completed haircuts as proof-of-completion (required before payout). Customers photograph haircut issues when reporting problems. The app uses the native camera with `capture="environment"`.

3. **Geolocation** — Branches are sorted by distance from the customer's real-time location. The map shows nearby shops.

4. **Haptics** — Tactile feedback on payment success and booking confirmation.

5. **Share Sheet** — Gift haircuts are shared via the native iOS share sheet (WhatsApp, Messages, etc.).

## Payments (Guideline 3.1.5a)

All payments are for **real-world services** (haircuts at physical barbershops). Per Guideline 3.1.5(a), apps may use payment methods other than in-app purchase for goods and services consumed outside the app. We use Stripe for:
- $5 booking deposits (remainder paid in-shop)
- Monthly/weekly haircut plans
- Gift haircuts
- Tips to barbers

No digital goods or services are sold.

## Privacy

- Privacy Policy: https://mrc-barbershop-mrc-0043.vercel.app/privacy
- Data collected: name, email, profile photo (optional), location (for branch sorting), payment info (via Stripe, never stored by us)
- Account deletion: available in Profile → Settings → Delete Account

## Test Cards (Stripe Test Mode)

Use card 4242 4242 4242 4242, any future expiry, any CVC.
