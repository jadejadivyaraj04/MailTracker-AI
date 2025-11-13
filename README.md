# MailTracker AI

Free, privacy-aware Gmail email tracker with analytics dashboard. Includes a Chrome extension, Node.js backend, and React dashboard ready for free deployment on Render and MongoDB Atlas.

## Repository Structure

```
.
├── extension/   # Chrome extension (Manifest V3)
├── server/      # Express + MongoDB backend API
├── dashboard/   # React + Tailwind analytics dashboard
└── README.md    # Project-wide documentation
```

## Phase 1 – Chrome Extension

- Injects a tracking pixel and rewrites links inside Gmail compose.
- Stores a user identifier and tracking toggle via popup UI.
- Uses background service worker for notifications and storage sync.

### Load Unpacked

1. Build or deploy the backend first to have a valid API URL.
2. Visit `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` directory.
4. Configure the popup:
   - Toggle tracking on/off as needed.
   - Enter a user identifier (e.g., your Gmail address). Use the same value when signing into the dashboard.

## Phase 2 – Backend API

- Node.js (Express) service that records message metadata, open events, and click events.
- MongoDB Atlas stores `Message`, `OpenEvent`, and `ClickEvent` collections.
- Provides REST endpoints consumed by the extension and dashboard.

### Local Setup

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Deploy to Render (free tier) as a Web Service with `npm install` build and `npm start` start command. Add environment variables:
- `MONGO_URI` – Atlas connection string.
- `PORT` – Usually `5000` (Render will inject its own `PORT`).
- Optional `ALLOWED_ORIGINS` – Comma-separated dashboard origins.

## Phase 3 – React Dashboard

- Built with Vite + React + Tailwind CSS + Recharts.
- Mock login accepts any email/ID and stores in `localStorage`.
- Fetches aggregated analytics from `/stats/user/:userId`.

### Local Setup

```bash
cd dashboard
cp .env.example .env   # Set VITE_API_BASE_URL to your backend
npm install
npm run dev
```

### Free Hosting

Deploy as a static site (Render Static Site or Vercel):
- **Build command:** `npm install && npm run build`
- **Publish directory:** `dist`
- **Environment variable:** `VITE_API_BASE_URL` – URL of your deployed backend.

## MongoDB Atlas (Free Tier)

1. Create a free shared cluster.
2. Add database user credentials.
3. Allow access from Render (either 0.0.0.0/0 or Render IP range).
4. Use the provided connection URI in the backend `.env` and Render environment settings.

## Optional Phase 4 – Alerts

Ideas for extending the system with scheduled jobs (e.g., Render cron jobs or background worker):
- Detect emails without opens after 24 hours and notify via Chrome notifications or email (SendGrid/Resend free tiers).
- Flag emails reopened after 3 days for follow-up outreach.

## Development Tips

- Update `MAILTRACKER_BACKEND_BASE` in `extension/content_script.js` if you self-host the backend at a different URL.
- Use the same user identifier in the extension popup and dashboard login to keep analytics aligned.
- Tailwind + Recharts make it easy to add new views or data slices as the project evolves.

## License

MIT – build and adapt freely. Attribution appreciated but not required.
