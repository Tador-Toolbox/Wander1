# Wandr – Personal Travel Map (Google Maps Edition)

Full-stack travel map app. Save places with an interactive Google Maps map, tags, notes, and autocomplete search.

**Stack:** Node.js · Express · MongoDB · JWT · Google Maps JavaScript API

---

## Project Structure

```
wandr/
├── server.js              ← Express entry point
├── package.json
├── .env.example
├── .gitignore
├── middleware/
│   └── auth.js            ← JWT verification
├── models/
│   ├── User.js
│   └── Place.js
├── routes/
│   ├── auth.js            ← POST /api/auth/register, /api/auth/login
│   └── places.js          ← GET/POST/PUT/DELETE /api/places
└── public/
    └── index.html         ← Full SPA (served by Express)
```

---

## Google Maps API Key Setup

### Which APIs to enable (all free tier):

1. Go to https://console.cloud.google.com
2. Create a project (or select existing one)
3. Enable these APIs under **APIs & Services → Library**:
   - **Maps JavaScript API** – renders the map
   - **Places API** – autocomplete in the Add Place form
   - (Optional) **Geocoding API** – if you add server-side geocoding later
4. Under **APIs & Services → Credentials** → Create a new **API Key**
5. Recommended: restrict the key to your domain under **Application restrictions**

---

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create `.env`

```bash
cp .env.example .env
```

Edit `.env`:

```
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/wandr
JWT_SECRET=some_long_random_string_here_min_32_chars
GOOGLE_MAPS_API_KEY=AIzaSy...your_key_here
PORT=3000
```

### 3. Run locally

```bash
npm run dev
```

Open http://localhost:3000

---

## MongoDB Atlas Setup

1. Go to https://cloud.mongodb.com → Create a **free M0 cluster**
2. **Database Access** → Add user with password (remember it)
3. **Network Access** → Add IP `0.0.0.0/0`
4. **Connect** → **Drivers** → copy the connection string
5. Replace `<password>` in the string with your DB user's password
6. Paste as `MONGODB_URI` in `.env`

---

## GitHub Setup

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/wandr.git
git push -u origin main
```

> `.env` is already in `.gitignore` — never commit it.

---

## Deploy to Render

1. https://render.com → **New → Web Service**
2. Connect your GitHub repo
3. Settings:
   | Field | Value |
   |---|---|
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Environment | Node |
4. **Environment Variables** → Add:
   - `MONGODB_URI`
   - `JWT_SECRET`
   - `GOOGLE_MAPS_API_KEY`
5. Click **Deploy** → done ✅

Render auto-deploys on every `git push` to `main`.

---

## How the API Key is Kept Safe

The Google Maps API key is **never hard-coded in the HTML**. Instead:

- The frontend fetches `/api/config/maps-key` after login
- That endpoint requires a valid JWT
- The key is stored only in `.env` / Render environment variables

For extra security on production, go to Google Cloud Console → restrict your key to your Render domain.

---

## Features (MVP)

- Email / password auth with JWT (30-day tokens)
- Google Maps with dark theme + colored pins per tag
- **Places Autocomplete** on Add Place form
- Quick Add via GPS
- Full Add: name, location, notes, link, tags
- Instagram URL location detection
- List view with search + tag filter
- Edit / Delete places
- Per-user data (every account has their own places)
