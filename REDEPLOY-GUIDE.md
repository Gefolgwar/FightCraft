# 🚀 Project Setup & Deployment Guide

This guide describes how to set up the project on a new machine and deploy it to Firebase.

## 📋 Prerequisites

1. **Node.js**: Install the latest LTS version.
2. **Git**: Ensure Git is installed and configured.
3. **Firebase CLI**: Install globally via npm:
   ```bash
   npm install -g firebase-tools
   ```
4. **Google Cloud SDK (gsutil)**: Needed for CORS configuration on Storage.
   - [Download & Install](https://cloud.google.com/sdk/docs/install)

## 🛠️ Local Setup

1. **Clone the repository**:
   ```bash
   git clone <your-repo-url>
   cd capacitor-project
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Login to Firebase**:
   ```bash
   firebase login
   ```

4. **Initialize Capacitor (Optional)**:
   ```bash
   npx cap sync
   ```

---

## 🌍 Running Locally

Start a local server with cache disabled (to ensure latest JS loads):
```bash
npx http-server www -p 8080 --cache -1
```
Open: http://localhost:8080

---

## 📤 Deployment

### 1. Deploy Hosting & Rules
To deploy everything (HTML/JS, Firestore rules, Storage rules):
```bash
firebase deploy
```

### 2. Deploy only Rules
```bash
firebase deploy --only firestore:rules,storage
```

### 3. Configure CORS (Required for Bundles)
If you move to a new project or reset Storage, you MUST apply CORS rules:
```bash
gsutil cors set cors.json gs://<your-bucket-name>.firebasestorage.app
```

---

## 📦 Static Bundles Optimization

The project uses static bundles to reduce Firestore reads. To regenerate and upload bundles:

1. Open http://localhost:8080/admin.html
2. Login as Admin.
3. Use the **Admin Bundler** tool to "Generate and Upload All Bundles".
4. This will update the `world_metadata/current_state` document and upload JSON files to Storage.

---

## 💾 Administration & Backups

- **Database Backup**: Follow the steps in `BACKUP-GUIDE.md`.
- **Firestore Monitoring**: Use `www/db-usage.html` to track reads and costs.
