# ⚔️ Fight Craft - Optimized Mobile Game

A high-performance mobile RPG built with **Capacitor** and **Firebase**. This project features a state-of-the-art data synchronization engine that drastically reduces server costs and improves loading times.

## 🚀 Key Achievements: Firestore Optimization

The most significant feature of this version is the **99.6% reduction in Firestore read operations** during game initialization.
- **Before**: 2600+ reads per startup.
- **After**: ~5-15 reads per startup.

This was achieved using a **Static Bundles** strategy:
- Large datasets (world objects, templates, zones) are bundled into compressed JSON files in Firebase Storage.
- The **SyncEngine** prioritizes loading these bundles over individual document queries.
- **IndexedDB** is used for persistent local caching with smart version invalidation.

## 🛠️ Technology Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+ Modules).
- **Backend/Platform**: Firebase (Auth, Firestore, Realtime Database, Storage, Hosting).
- **Mobile Wrapper**: Capacitor.js (Android-ready).
- **Optimization**: Custom 'Static Bundles' Sync Engine.

## 📁 Project Structure

- `www/`: Web application source code.
  - `js/`: Modular JavaScript logic (SyncEngine, Firebase Service, UI Controllers).
  - `admin.html`: Tooling for bundle generation and world management.
- `android/`: Native Android project configurations.
- `firestore.rules`, `storage.rules`: Security and access control configurations.
- `cors.json`: Cross-Origin Resource Sharing configuration for Static Bundles.

## 📖 Documentation

- [Setup & Deployment Guide](REDEPLOY-GUIDE.md): How to sync, run locally, and deploy to production.
- [Backup & Restore Guide](BACKUP-GUIDE.md): Instructions for Firestore data management.
- [Implementation Notes](MODULARIZATION-SUCCESS.md): Technical details on the project's modular architecture.

## 🚦 Quick Start

1. Install dependencies: `npm install`
2. Run locally: `npx http-server www -p 8080 --cache -1`
3. Deploy to Firebase: `firebase deploy`

---

*This project is private and intended for development and testing purposes.*
