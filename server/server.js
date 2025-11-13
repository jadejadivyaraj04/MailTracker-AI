import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { connectDB } from './db.js';
import trackRouter from './routes/track.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

app.use(helmet());
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean).filter(Boolean);
const corsOptions = (() => {
  if (!allowedOrigins || allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
    return { origin: true, credentials: true };
  }

  return {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      const error = new Error(`Not allowed by CORS: ${origin}`);
      console.error('[MailTracker AI] CORS rejection', error.message);
      return callback(error);
    },
    credentials: true
  };
})();
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/', trackRouter);

const start = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`[MailTracker AI] Server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('[MailTracker AI] Failed to start server', error);
    process.exit(1);
  }
};

start();
