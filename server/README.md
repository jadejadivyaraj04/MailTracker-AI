# MailTracker AI Backend

Node.js + Express API for logging email opens and link clicks. Designed for free deployment on Render with MongoDB Atlas as the database.

## Features

- `/register` endpoint ingests outgoing message metadata.
- `/pixel` serves a transparent tracking GIF while logging an open event.
- `/redirect` records link clicks and forwards users to the intended URL.
- `/stats/:uid` returns message-level analytics.
- `/stats/user/:userId` aggregates stats across a sender or account.
- Hardened with Helmet, CORS controls, compression, logging, and rate limiting.

## Project Structure

```
server/
├── server.js
├── db.js
├── routes/
│   └── track.js
├── models/
│   ├── Message.js
│   ├── OpenEvent.js
│   └── ClickEvent.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and configure your MongoDB Atlas URI:
   ```bash
   cp .env.example .env
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

The API defaults to `http://localhost:5000`.

## Environment Variables

| Name          | Description                                      |
| ------------- | ------------------------------------------------ |
| `MONGO_URI`   | MongoDB Atlas connection string                  |
| `PORT`        | HTTP port (defaults to `5000`)                   |
| `ALLOWED_ORIGINS` | Optional comma-separated whitelist for CORS |

## Deploying to Render (Free Tier)

1. Push this repository to GitHub.
2. Create a **Web Service** on [Render.com](https://render.com/).
3. Select the repo and choose the free plan.
4. Set the build command to `npm install` and start command to `npm start`.
5. Add environment variables in Render:
   - `MONGO_URI` with your Atlas connection string.
   - `PORT` with `5000` (Render also provides `PORT`, which will override).
   - Optional: `ALLOWED_ORIGINS` (e.g., `https://your-dashboard.onrender.com`).
6. Deploy. Render will install dependencies and boot the server automatically.

## MongoDB Atlas Setup (Free Tier)

1. Sign up at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas/register).
2. Create a free shared cluster.
3. Add a database user and note the username/password.
4. Whitelist Render’s IP ranges or enable access from anywhere.
5. Copy the connection URI and place it in your `.env` / Render environment variables.

## API Reference

### `POST /register`
- Body: `{ uid, recipients, subject, timestamp, userId, metadata }`
- Response: `{ ok: true }`

### `GET /pixel?uid=UUID`
- Response: `1x1` GIF image.

### `GET /redirect?uid=UUID&to=ENCODED_URL`
- Records the click and redirects to the decoded URL.

### `GET /stats/:uid`
- Returns message details along with open/click arrays.

### `GET /stats/user/:userId`
- Aggregated stats grouped by message for a given user account.

## Production Tips

- Configure `ALLOWED_ORIGINS` to limit dashboard access.
- Consider enabling [Render cron jobs](https://render.com/docs/cron-jobs) or background workers for alerting (Phase 4).
- Monitor MongoDB Atlas metrics to stay within free tier limits.
