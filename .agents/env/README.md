# 🔐 Environment — Sensitive Data

## What is this?

This folder contains `.env` files with sensitive data (API keys, signing passwords).
Scripts in `execution/` read these values and NEVER hardcode them.

## How to use

1. Copy `.env.example` → `.env`
2. Fill in the real values
3. **NEVER** commit `.env` to git

## Files

| File | Status | Purpose |
|------|--------|---------|
| `.env.example` | ✅ In git | Template with placeholder values |
| `.env` | 🚫 NOT in git | Real values (created manually) |

## What is stored here

- `FIREBASE_PROJECT_ID` — Firebase project ID
- `FIREBASE_KEY_PATH` — Path to the Service Account key file
- `KEYSTORE_PASSWORD` / `KEY_PASSWORD` — Passwords for Android APK/AAB signing
- `LIVE_URL` — Production site URL

## What is NOT here

- `firebase-key.json` — Lives in the project root (already in `.gitignore`)
- MCP configuration — In `.claude/settings.json`
