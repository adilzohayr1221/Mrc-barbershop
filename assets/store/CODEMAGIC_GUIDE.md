# Codemagic Setup Guide — MRC Barbershop iOS Build

## Prerequisites
- ✅ Apple Developer Program active
- ✅ This repo has `codemagic.yaml` at the root
- ✅ Bundle ID: `com.mrc.barbershop`

## Step 1: Create Codemagic Account
1. Go to https://codemagic.io/signup
2. Sign up with GitHub (recommended) or email
3. Free tier includes 500 build minutes/month — enough for our needs

## Step 2: Add the Project
1. In Codemagic dashboard, click "Add application"
2. Connect your Git provider and select the `mrc-barbershop` repository
3. Choose "iOS" as project type
4. Codemagic will auto-detect `codemagic.yaml`

## Step 3: Apple Developer Integration (Code Signing)
**Option A — Automatic (Recommended):**
1. Go to Teams → Integrations → Apple Developer Portal → Connect
2. Enter your Apple ID credentials (App Store Connect API)
3. Codemagic will automatically manage certificates and provisioning profiles

**Option B — Manual with API Key:**
1. Go to App Store Connect → Users and Access → Integrations → App Store Connect API
2. Create a new API key with "App Manager" role
3. Note the **Issuer ID**, **Key ID**, and download the **.p8** private key
4. In Codemagic: Teams → Integrations → App Store Connect → Add integration
5. Enter Issuer ID, Key ID, and upload the .p8 file

## Step 4: Run the Build
1. Go to your app in Codemagic
2. Select workflow: `ios-release`
3. Click "Start new build"
4. Wait ~15-20 minutes
5. The .ipa will be automatically uploaded to TestFlight

## Step 5: TestFlight
1. Go to App Store Connect → TestFlight
2. Add internal testers (yourself)
3. Install via TestFlight app on iPhone
4. Test the full flow: login → book → pay → verify

## Step 6: Submit for Review
1. In App Store Connect, create the app record (if not exists)
2. Fill in: description, keywords, screenshots, privacy policy URL
3. Paste the Review Notes from `assets/store/REVIEW_NOTES.md`
4. Submit for review

## Troubleshooting
- **"No signing certificate"**: Reconnect Apple Developer integration
- **"Bundle ID mismatch"**: Ensure App Store Connect app uses `com.mrc.barbershop`
- **Build fails on `npm ci`**: Check Node version in codemagic.yaml (currently 20)
