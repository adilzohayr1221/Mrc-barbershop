# capacitor-branch-map

Local Capacitor plugin that renders the customer branch map with **real
native Apple Maps** (`MKMapView`) instead of a web map, inside the iOS
app only. The website/PWA keeps the MapKit JS engine (with the Leaflet
fallback); this plugin exists because the owner wants the exact native
Maps experience in the App Store app.

## How it works

The web layer owns the page. It renders the usual framed `.modern-map`
placeholder (layout space only), measures its on-screen rect, and hands
the rect + branch data to this plugin. The plugin floats a
`BranchMapView` — a framed `MKMapView` wearing the same 6 pt metallic
gold frame (26 pt outer radius, 20 pt map radius) — directly above the
WebView at that rect, and keeps it glued there through
`updateFrame` calls while the page scrolls.

Pins are the ORIGINAL shop pins: the artwork in
`ios/Sources/BranchMapPlugin/Resources/` was rasterized from the exact
SVG strings in `src/components/mapPins.ts` (black teardrop + cream
medallion + drawn shop + gold badge; inverted gold pin for salons). The
badge number is a native label over the badge circle. Selection mirrors
the web CSS: ×1.22 scale about the pin tip, gold glow, pulsing gold
ring, other branch pins dimmed to 55 %.

## JS API

Provided natively under the plugin name **`BranchMap`**. The typed
client lives in `src/lib/native-branch-map.ts` (phase 2 wires it into
the customer page). Methods: `show`, `hide`, `updateFrame`, `setData`,
`setSelected`, `locateMe`. Events: `pinTapped`, `mapReady`,
`userLocated`, `locateError`. Full contract: see the doc comment at the
top of `src/lib/native-branch-map.ts`.

## Wiring (phase 2 — done)

1. Root `package.json` dependencies carry
   `"capacitor-branch-map": "file:./plugins/capacitor-branch-map"`
   and `package-lock.json` is in sync (`npm ci` in Codemagic fails
   otherwise).
2. `npx cap sync ios` has added this package to
   `ios/App/CapApp-SPM/Package.swift` (CLI-managed; never hand-edit).
   Web side: the `BranchMap` dispatcher gates on
   `isNativeBranchMapAvailable()` and mounts `BranchMapNative`, which
   drives this plugin through `src/lib/native-branch-map.ts`.
3. Nothing else: the Codemagic `ios-release` workflow already runs
   `npm ci` + `cap sync ios`, and `NSLocationWhenInUseUsageDescription`
   is already in `ios/App/App/Info.plist`.

⚠️ Versioning contract: the native binary and the website deploy
independently (the shell loads the live site). Web code must gate every
call behind `Capacitor.isPluginAvailable('BranchMap')` — the v1.0 app
currently in App Store review does NOT contain this plugin, and there
the web map must render exactly as today.
