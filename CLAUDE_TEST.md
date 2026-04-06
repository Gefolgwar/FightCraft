# FightCraft - Project Architecture Summary

This is a brief summary of the project architecture and configuration files based on the repository structure.

## Overview
FightCraft is a geolocation-based RPG built with HTML5, vanilla JavaScript (ES6 modules), and TailwindCSS. It uses Firebase for the backend and is wrapped with Capacitor to build as a native Android application.

There is no bundler (like Webpack or Vite) used for the frontend; JS files are served directly as ES6 modules, and styling is handled via a TailwindCSS CDN.

## Architecture Components

- **Frontend (`www/`)**: 
  - Pure HTML/JS/CSS structure.
  - `www/index.html` serves as the entry point, which dynamically loads UI and initializes the app via `www/js/app.js`.
  - Modules are separated by functionality (e.g., `map.js`, `combat.js`, `pvp.js`, `sync-engine.js`).
- **Mobile Wrapper (`android/`)**: 
  - Capacitor is used to sync the `www/` web assets into a native Android app.
- **Backend (Firebase)**:
  - **Firestore**: Persistent storage for user profiles, characters, templates, and map data.
  - **Realtime Database (RTDB)**: Ephemeral, real-time state such as player map positions and PvP battle syncing.
  - **Storage**: Used for static bundles in the SyncEngine to minimize Firestore read costs.

## Configuration Files

The project relies on several key configuration files at the root level to tie these services together:

### Firebase Configuration
- `firebase.json`: Defines Firebase hosting paths, emulators, and service rule targets.
- `.firebaserc`: Contains the default Firebase project alias (e.g., `fight-craft-3c3f0`).
- `firestore.rules`: Security rules for Cloud Firestore.
- `database.rules.json`: Security rules for Firebase Realtime Database.
- `storage.rules`: Security rules for Firebase Storage.
- `cors.json`: Cross-Origin Resource Sharing configuration, typically for Firebase Storage.
- `firebase-key.json` / `android/app/google-services.json`: Service account and Android client credentials for Firebase.

### Build & Dependency Configuration
- `package.json` & `package-lock.json`: NPM dependencies (primarily Firebase CLI, Capacitor CLI) and NPM scripts for Android builds (`npm run android:build`, etc.).
- `capacitor.config.json`: Configuration for the Capacitor wrapper, linking the web directory (`www`) to the Android build.
- `www/manifest.json`: Web App Manifest for progressive web app properties.
