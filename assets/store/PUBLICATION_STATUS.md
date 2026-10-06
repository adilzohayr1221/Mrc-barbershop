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

- **iOS build needs a Mac.** Resolved via Codemagic cloud build (repo github.com/adilzohayr1221/Mrc-barbershop, app "Mrc-barbershop", workflow ios-release, App Store Connect API integration ACTIVE with the new "Codemagic" key YG49KM32HZ). Build #2 (2026-10-06 12:07 EDT, build 6ac5150a7394575b200bb3a5) FAILED at step 5 "Fetch signing files (App Store Connect API)": `Cannot save Signing Certificates without certificate private key`. Fix options: (a) revoke the distribution certificate in the Apple Developer Portal and let Codemagic auto-signing create a fresh one with a private key it holds; (b) upload the existing .p12 (certificate + private key) into Codemagic Code signing identities. Option (a) touches his Apple Developer account → confirm with him first; option (b) needs the .p12 from wherever the cert was created.

- **Submission needs his logins.** App Store Connect + Play Console are identity-bound.
  He must create the app records and either submit himself or add me via browser takeover.

## Build history (2026-10-06)

- Build #6 (6ac52a0c7394575b200bbb3d, commit cef7874): FAILED at "Build .ipa" — `ios/App/App.xcworkspace` didn't exist (pod install missing).
- Build #7 (6ac532697394575b200bbdd4): FAILED — "No Podfile found" (project uses Capacitor 8 SPM, not CocoaPods).
- Build #8 (6ac5399f7394575b200bc02e, commit 5832382 "Fix: build xcodeproj directly (SPM, no Pods)", 14:24 EDT, 1m12s): FAILED at step 5 "Build .ipa" during "Archive App.xcodeproj" — xcodebuild exit status 65: `error: "App" requires a provisioning profile. Select a provisioning profile in the Signing & Capabilities editor. (in target 'App' from project 'App')`. No provisioning profile configured for manual code signing. No .ipa produced; only `Mrc-barbershop_8_artifacts.zip` [10.61 KB] (logs). Publishing to App Store Connect did not run.
- Signing was already switched to manual code signing with a distribution certificate + App Store provisioning profile N5HCH7FK97 uploaded to Codemagic; the archive step still can't resolve the profile for target 'App'. Likely next fix: check Codemagic code-signing settings (manual signing profile name/type, "Use Xcode-managed signing" off, profile bound to bundle id com.mrc.barbershop), or let Codemagic auto-signing manage it.
- The 20-min monitor cron `codemagic-build-8-monitor` was removed after the failed status was confirmed.

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
