import express from 'express';
import crypto from 'crypto';
import Message from '../models/Message.js';
import OpenEvent from '../models/OpenEvent.js';
import ClickEvent from '../models/ClickEvent.js';
/**
 * Simple In-Memory LRU Cache for message metadata
 */
class SimpleCache {
  constructor(limit = 1000) {
    this.limit = limit;
    this.cache = new Map();
  }
  set(key, value) {
    if (this.cache.size >= this.limit) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  get(key) {
    if (!this.cache.has(key)) return null;
    const val = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }
  delete(key) { this.cache.delete(key); }
  clear() { this.cache.clear(); }
}
const messageCache = new SimpleCache(2000);

const router = express.Router();

const PIXEL_BUFFER = Buffer.from('R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

const hashIp = (ip, userAgent = '') => {
  return crypto.createHash('sha256').update(`${ip}|${userAgent}`).digest('hex');
};

const getClientIp = req => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '0.0.0.0';
};

const normalizeEmail = (email) => (email || '').toLowerCase().trim();

/**
 * Core logic to calculate validated metrics for a message
 * Filters out sender opens, applies buffer, and handles lazy identification
 */
const validateMessageStats = (message, opens = [], clicks = []) => {
  const sentAtTime = message.sentAt ? new Date(message.sentAt).getTime() : 0;
  const BUFFER_SECONDS = 1; // Lowered for fast tests
  const normalizedSenderEmail = message.senderEmail ? normalizeEmail(message.senderEmail) : null;
  const tokenMap = message.recipientTokens || {};
  const tokens = tokenMap instanceof Map ? Object.fromEntries(tokenMap) : tokenMap;

  // 1. Filter opens to get "Valid Human Recipient Opens"
  const validOpens = opens.filter(open => {
    // Determine the email for this open (stored or via token)
    let openEmail = normalizeEmail(open.recipientEmail);

    // Lazy Identification: If no email stored, try matching via token
    if (!openEmail && open.token) {
      const matchingEntry = Object.entries(tokens).find(([_, storedToken]) => storedToken === open.token);
      if (matchingEntry) {
        openEmail = normalizeEmail(matchingEntry[0]);
      }
    }

    // Must have an identified recipient email at this point
    if (!openEmail) return false;

    // Smart Sender/Self-Open Protection:
    const isSenderIp = message.metadata?.senderIpHash && open.ipHash === message.metadata.senderIpHash;
    const openTime = open.createdAt ? new Date(open.createdAt).getTime() : 0;
    const timeDiffSeconds = (openTime - sentAtTime) / 1000;

    // If it's coming from the sender's IP, we are VERY suspicious.
    if (isSenderIp) {
      // If it's within 10 seconds, it is almost certainly the sender's browser loading the sent box.
      if (timeDiffSeconds < 10) {
        console.log(`[MailTracker AI] Skipping open: detected sender self-trigger within 10s window (${timeDiffSeconds}s)`);
        return false;
      }

      // If it's the sender's IP AND the sender's email, it's a self-open (ignore)
      const isSenderEmail = normalizedSenderEmail && openEmail === normalizedSenderEmail;
      if (isSenderEmail) {
        console.log(`[MailTracker AI] Skipping open: confirmed sender self-view (Email+IP)`);
        return false;
      }
    }

    // No buffer for proxies or other IPs - if it's a valid identified recipient, count it!
    return true;
  });

  // 2. Map read status to specific recipients (To list)
  const toRecipients = (message.recipients?.to || []).filter(Boolean);
  const recipientStatus = toRecipients.map(email => {
    const targetEmail = normalizeEmail(email);

    // Find if ANY valid open belongs to this specific email
    const openForThisUser = validOpens.find(open => {
      const openEmail = normalizeEmail(open.recipientEmail);
      const matchesDirect = openEmail === targetEmail;

      const tokenForThisUser = tokens[email];
      const matchesToken = tokenForThisUser && tokenForThisUser === open.token;

      if (matchesDirect || matchesToken) {
        console.log(`[MailTracker AI] ✅ Valid open for ${email}: direct=${matchesDirect}, token=${matchesToken}`);
        return true;
      }
      return false;
    });

    if (!openForThisUser && validOpens.length > 0) {
      console.log(`[MailTracker AI] ❌ No match for recipient ${email} among ${validOpens.length} valid opens`);
    }

    return {
      email,
      read: !!openForThisUser,
      readAt: openForThisUser ? openForThisUser.createdAt : null
    };
  });

  return {
    openCount: validOpens.length,
    clickCount: clicks.length, // Clicks are generally always valid
    recipientStatus,
    lastOpenedAt: validOpens.length > 0 ? validOpens[validOpens.length - 1].createdAt : null,
    lastClickedAt: clicks.length > 0 ? clicks[clicks.length - 1].createdAt : null
  };
};

const checkIfProxy = (userAgent = '') => {
  const ua = userAgent.toLowerCase();
  // Known email proxy indicators
  return (
    ua.includes('google-proxy-imagemessagely') ||
    ua.includes('googleimageproxy') ||
    ua.includes('outlooks-edge-content') ||
    ua.includes('via ggpht.com') ||
    ua.includes('apple-mail-canvas')
  );
};

router.post('/register', async (req, res) => {
  try {
    const { uid, recipients = {}, subject = '', timestamp, userId = 'default', senderEmail, metadata = {} } = req.body || {};

    if (!uid) {
      return res.status(400).json({ error: 'uid is required' });
    }

    const sentAt = timestamp ? new Date(timestamp) : new Date();

    // Normalize all recipient emails (lowercase, trim)
    const normalizeEmailArray = (arr) => (arr || []).map(email =>
      (email || '').toLowerCase().trim()
    ).filter(Boolean);

    const normalizedRecipients = {
      to: normalizeEmailArray(recipients.to),
      cc: normalizeEmailArray(recipients.cc),
      bcc: normalizeEmailArray(recipients.bcc)
    };

    // Normalize sender email
    const normalizedSenderEmail = senderEmail ? senderEmail.toLowerCase().trim() : null;

    // Use tokens provided by client or generate if missing
    const recipientTokens = req.body.recipientTokens || {};
    const allRecipients = [
      ...normalizedRecipients.to,
      ...normalizedRecipients.cc,
      ...normalizedRecipients.bcc
    ];

    allRecipients.forEach(email => {
      // Only generate if client didn't provide one
      if (!recipientTokens[email]) {
        recipientTokens[email] = crypto.randomBytes(16).toString('hex');
      }
    });

    console.log('[MailTracker AI] Registering message:', {
      uid,
      subject,
      recipients: normalizedRecipients,
      senderEmail: normalizedSenderEmail,
      userId,
      recipientCount: allRecipients.length
    });

    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const senderIpHash = hashIp(ip, userAgent);

    const updatedMessage = await Message.findOneAndUpdate(
      { uid },
      {
        uid,
        userId,
        senderEmail: normalizedSenderEmail,
        subject,
        recipients: normalizedRecipients,
        recipientTokens,
        sentAt,
        metadata: { ...metadata, senderIpHash }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Populate cache
    messageCache.set(uid, updatedMessage);

    // Return recipientTokens to extension
    return res.json({ ok: true, recipientTokens });
  } catch (error) {
    console.error('[MailTracker AI] register error:', error);
    console.error('[MailTracker AI] Error details:', {
      message: error.message,
      stack: error.stack,
      uid,
      recipientCount: allRecipients?.length || 0
    });
    return res.status(500).json({
      error: 'Failed to save message metadata',
      details: error.message
    });
  }
});

// Handle OPTIONS preflight for pixel endpoint
router.options('/pixel', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});
router.get('/pixel', async (req, res) => {
  const { uid, token } = req.query;
  console.log(`[MailTracker AI] Incoming pixel request: uid=${uid}, token=${token || 'NONE'}`);

  if (!uid) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).end();
  }

  try {
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    // Look up message and validate token to identify recipient
    let recipientEmail = null;

    try {
      // Check cache first
      let message = messageCache.get(uid);
      if (!message) {
        message = await Message.findOne({ uid });
        if (message) messageCache.set(uid, message);
      }

      if (message && message.recipientTokens && token) {
        // Token-based identification (new method - most accurate)
        const tokenMap = message.recipientTokens;

        // Convert Map to Object if needed (Mongoose returns Map for Map type)
        const tokens = tokenMap instanceof Map ? Object.fromEntries(tokenMap) : tokenMap;

        // Find which recipient this token belongs to
        const matchingEntry = Object.entries(tokens).find(([email, storedToken]) => storedToken === token);

        if (matchingEntry) {
          recipientEmail = matchingEntry[0]; // Get email from token
          console.log('[MailTracker AI] Pixel loaded - Recipient identified via token:', recipientEmail);
        } else {
          console.log('[MailTracker AI] Pixel loaded - Token provided but invalid:', token);
        }
      } else if (message && message.recipients && !token) {
        // Fallback for backward compatibility (old emails without tokens)
        const toRecipients = (message.recipients.to || []).filter(Boolean);

        if (toRecipients.length === 1) {
          const normalizedEmail = toRecipients[0].toLowerCase().trim();
          if (normalizedEmail && normalizedEmail.length > 0) {
            recipientEmail = normalizedEmail;
            console.log('[MailTracker AI] Pixel loaded - Single "To" recipient (fallback):', recipientEmail);
          }
        } else if (toRecipients.length > 1) {
          console.log('[MailTracker AI] Pixel loaded - Multiple recipients but no token, cannot identify individual');
        } else {
          console.log('[MailTracker AI] Pixel loaded - No "To" recipients found');
        }
      } else if (!message) {
        console.log('[MailTracker AI] Pixel loaded - Message not found for uid:', uid);
      } else if (!token) {
        console.log('[MailTracker AI] Pixel loaded - No token provided (old pixel format)');
      }
    } catch (lookupError) {
      console.warn('[MailTracker AI] Could not lookup message for recipient tracking', lookupError);
    }

    // Create OpenEvent (with or without recipient identification)
    const isProxy = checkIfProxy(userAgent);

    await OpenEvent.create({
      messageUid: uid,
      recipientEmail,
      token: token || null,
      ipHash: hashIp(ip, userAgent),
      userAgent,
      isProxy
    });
    console.log(`[MailTracker AI] Open logged: uid=${uid}, recipient=${recipientEmail || 'UNKNOWN'}, token=${token || 'NONE'}, isProxy=${isProxy}`);

    console.log('[MailTracker AI] OpenEvent created:', {
      messageUid: uid,
      recipientEmail,
      isProxy,
      hasToken: !!token,
      tokenValid: !!recipientEmail
    });
  } catch (error) {
    console.error('[MailTracker AI] pixel logging error', error);
  }

  // Set CORS headers for cross-origin image loading
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.end(PIXEL_BUFFER);
});

router.get('/redirect', async (req, res) => {
  const { uid, to } = req.query;

  if (!uid || !to) {
    return res.status(400).send('Missing parameters');
  }

  let destination;
  try {
    destination = decodeURIComponent(to);
  } catch (error) {
    return res.status(400).send('Invalid destination');
  }

  try {
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    await ClickEvent.create({
      messageUid: uid,
      url: destination,
      ipHash: hashIp(ip, userAgent),
      userAgent
    });
  } catch (error) {
    console.error('[MailTracker AI] click logging error', error);
  }

  return res.redirect(destination);
});

router.get('/stats/:uid', async (req, res) => {
  const { uid } = req.params;

  try {
    const message = await Message.findOne({ uid });
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const [opens, clicks] = await Promise.all([
      OpenEvent.find({ messageUid: uid }).sort({ createdAt: 1 }),
      ClickEvent.find({ messageUid: uid }).sort({ createdAt: 1 })
    ]);

    // Use the validated stats helper for consistency
    const validated = validateMessageStats(message, opens, clicks);

    return res.json({
      message,
      openCount: validated.openCount,
      clickCount: validated.clickCount,
      opens: opens, // Return raw for transparency
      clicks: clicks,
      recipientStatus: validated.recipientStatus
    });

    return res.json({
      message,
      openCount: opens.length,
      clickCount: clicks.length,
      opens,
      clicks,
      recipientStatus // New: per-recipient read status
    });
  } catch (error) {
    console.error('[MailTracker AI] stats error', error);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
});

router.get('/stats/user/:userId', async (req, res) => {
  const userId = decodeURIComponent(req.params.userId || 'default');

  try {
    console.log('[MailTracker AI] Fetching stats for userId:', userId);
    const messages = await Message.find({ userId }).sort({ createdAt: -1 }).limit(200);
    console.log('[MailTracker AI] Found messages:', messages.length);

    const uids = messages.map(message => message.uid).filter(Boolean);

    if (!uids.length) {
      console.log('[MailTracker AI] No messages found, returning empty stats');
      return res.json({
        userId,
        totalMessages: 0,
        totalOpens: 0,
        totalClicks: 0,
        messages: []
      });
    }

    const detailedOpens = await OpenEvent.find({ messageUid: { $in: uids } }).lean();
    const detailedClicks = await ClickEvent.find({ messageUid: { $in: uids } }).lean();

    const summary = messages.map(message => {
      try {
        const messageOpens = detailedOpens.filter(o => o.messageUid === message.uid);
        const messageClicks = detailedClicks.filter(c => c.messageUid === message.uid);

        // Use the common validated stats helper
        const validated = validateMessageStats(message, messageOpens, messageClicks);

        return {
          uid: message.uid,
          subject: message.subject || '',
          sentAt: message.sentAt,
          recipients: message.recipients || { to: [], cc: [], bcc: [] },
          openCount: validated.openCount,
          clickCount: validated.clickCount,
          lastOpenedAt: validated.lastOpenedAt,
          lastClickedAt: validated.lastClickedAt,
          recipientStatus: validated.recipientStatus
        };
      } catch (msgError) {
        console.error('[MailTracker AI] Error processing message:', message?.uid, msgError);
        return {
          uid: message?.uid || 'unknown',
          subject: message?.subject || '',
          sentAt: message?.sentAt || new Date(),
          recipients: message?.recipients || { to: [], cc: [], bcc: [] },
          openCount: 0,
          clickCount: 0,
          lastOpenedAt: null,
          lastClickedAt: null,
          recipientStatus: []
        };
      }
    });

    const totalOpens = summary.reduce((acc, m) => acc + m.openCount, 0);
    const totalClicks = summary.reduce((acc, m) => acc + m.clickCount, 0);

    console.log('[MailTracker AI] Returning stats:', {
      userId,
      totalMessages: messages.length,
      totalOpens,
      totalClicks,
      summaryLength: summary.length
    });

    return res.json({
      userId,
      totalMessages: messages.length,
      totalOpens,
      totalClicks,
      messages: summary
    });
  } catch (error) {
    console.error('[MailTracker AI] user stats error:', error);
    if (error?.stack) {
      console.error('[MailTracker AI] Error stack:', error.stack);
    }
    // Always send a response, even on error
    return res.status(500).json({
      error: 'Failed to load user stats',
      details: error.message,
      userId: req.params.userId
    });
  }
});

// Debug endpoint to inspect message status
router.get('/debug/track/:uid', async (req, res) => {
  const { uid } = req.params;
  try {
    const message = await Message.findOne({ uid });
    const opens = await OpenEvent.find({ messageUid: uid });
    const clicks = await ClickEvent.find({ messageUid: uid });

    // Calculate stats using the helper
    const validated = message ? validateMessageStats(message, opens, clicks) : null;

    return res.json({
      exists: !!message,
      message,
      opens,
      clicks,
      validated,
      serverTime: new Date()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
