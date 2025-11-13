# MailTracker AI Dashboard

React + Vite analytics dashboard styled with Tailwind CSS. Displays message-level insights captured by the MailTracker AI backend.

## Features

- Mock login that stores a user identifier locally.
- Fetches stats from `/stats/user/:userId` endpoint.
- Responsive summary cards, recent email list, and line chart using Recharts.
- Tailwind CSS utilities for consistent styling.

## Project Structure

```
dashboard/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── .env.example
├── src/
│   ├── App.js
│   ├── main.jsx
│   ├── index.css
│   ├── pages/
│   │   ├── Login.js
│   │   └── Dashboard.js
│   └── components/
│       ├── Navbar.js
│       ├── EmailList.js
│       └── StatsChart.js
└── README.md
```

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and point `VITE_API_BASE_URL` to your backend (local or Render):
   ```bash
   cp .env.example .env
   ```
3. Run the dev server:
   ```bash
   npm run dev
   ```

Visit `http://localhost:5173` to view the dashboard.

## Deploying for Free

You can deploy the dashboard on Render Static Sites or Vercel:

- **Build command:** `npm install && npm run build`
- **Publish directory:** `dist`
- Configure `VITE_API_BASE_URL` as an environment variable pointing to your backend URL.

## Mock Login Instructions

1. Enter any email address or identifier on the login screen.
2. The value is saved in `localStorage` and used to request `/stats/user/{userId}`.
3. Use the same identifier (e.g., your Gmail address) when sending emails so the backend stores messages under that user ID.
