# MRC Barbershop — App Store / Play Store Publication Status

## ✅ Done (ready now)

- Capacitor 8 wrapper configured (`com.mrc.barbershop`, loads live Vercel app)
- Native plugins: Camera, Push Notifications, Geolocation, Splash Screen, Status Bar, Haptics
- iOS + Android platform projects generated (`ios/`, `android/`)
- iOS App Store icon 1024×1024 (`assets/store/ios-icon-1024.png`)
- Android adaptive icons (`assets/store/android-fg-432.png`, `android-bg-432.png`)
- Play Store feature graphic 1024×500 (`assets/store/feature-graphic.png`)
- App Store listing copy (`assets/store/app-store-listing.md`)
- Privacy policy page at `/privacy` (required by both stores)

## ⏳ Waiting on user

1. **Apple Developer activation** — paid 2026-10-06, order #W1556068897. Takes 24–48h.
2. **Google Play Console** — not done yet. https://play.google.com/console/signup ($25)

## ⚠️ Blockers only the user can clear

- **iOS build needs a Mac.** The final `.ipa` must be built with Xcode (macOS only).
  Options: (a) user has a Mac → build there; (b) Codemagic cloud build → needs
  App Store Connect API key from the user's account; (c) GitHub Actions macOS runner.
- **Submission needs his logins.** App Store Connect + Play Console are identity-bound.
  He must create the app records and either submit himself or add me via browser takeover.

## Next steps (in order)

1. User finishes Google Play signup.
2. Apple activation completes → create App Store Connect app record.
3. Generate screenshots (iPhone 6.7", 6.5", iPad; Android phone + tablet).
4. Build Android `.aab` locally (Android SDK works on Linux) → upload to Play Console.
5. Build iOS `.ipa` (Mac or Codemagic) → upload via Transporter/TestFlight.
6. Fill store listings, submit for review.

## Apple review risk notes

- The app is a Capacitor wrapper around the live web app. To maximize acceptance odds,
  native plugins (camera, push, geolocation, haptics) are integrated — not a bare WebView.
- Guideline 4.2 (minimum functionality): the app has real native-adjacent features
  (bookings, payments, QR scanning, photo complaints, push reminders).
- No placeholder content, no "demo" wording, privacy policy linked.
