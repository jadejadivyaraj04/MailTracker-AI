import express from 'express';
import crypto from 'crypto';
import Message from '../models/Message.js';
import OpenEvent from '../models/OpenEvent.js';
import ClickEvent from '../models/ClickEvent.js';

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

router.post('/register', async (req, res) => {
  try {
    const { uid, recipients = {}, subject = '', timestamp, userId = 'default', metadata = {} } = req.body || {};

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

    // Generate unique token for each recipient (To, Cc, Bcc)
    const recipientTokens = {};
    const allRecipients = [
      ...normalizedRecipients.to,
      ...normalizedRecipients.cc,
      ...normalizedRecipients.bcc
    ];

    allRecipients.forEach(email => {
      // Generate a unique token for each recipient
      const token = crypto.randomBytes(16).toString('hex');
      recipientTokens[email] = token;
    });

    console.log('[MailTracker AI] Registering message:', {
      uid,
      subject,
      recipients: normalizedRecipients,
      userId,
      recipientCount: allRecipients.length
    });

    await Message.findOneAndUpdate(
      { uid },
      {
        uid,
        userId,
        subject,
        recipients: normalizedRecipients,
        recipientTokens, // Store tokens in database
        sentAt,
        metadata
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

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
  const { uid, token } = req.query; // Extract both uid and token

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
      const message = await Message.findOne({ uid });

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
    await OpenEvent.create({
      messageUid: uid,
      recipientEmail, // Will be null if token invalid or not provided
      ipHash: hashIp(ip, userAgent),
      userAgent
    });

    console.log('[MailTracker AI] OpenEvent created:', {
      messageUid: uid,
      recipientEmail,
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

    // Calculate recipient read status (only for "To" recipients)
    const toRecipients = (message.recipients.to || []).filter(Boolean);

    // Normalize email for comparison (lowercase, trim)
    const normalizeEmail = (email) => (email || '').toLowerCase().trim();

    const recipientStatus = toRecipients.map(email => {
      // Only mark as read if there's an actual open event with matching recipientEmail
      // Strict validation: recipientEmail must be a non-empty string and match exactly
      const normalizedRecipientEmail = normalizeEmail(email);

      // Default to false - only set to true if we find a confirmed match
      let hasOpened = false;
      let readAt = null;

      // Only check opens that have a recipientEmail (skip null/undefined)
      const opensWithRecipient = opens.filter(open =>
        open.recipientEmail &&
        typeof open.recipientEmail === 'string' &&
        open.recipientEmail.trim().length > 0
      );

      // Find exact match - but only count opens that happen AFTER the email was sent
      // This prevents sender previews from being counted as recipient opens
      const sentAtTime = message.sentAt ? new Date(message.sentAt).getTime() : 0;
      const BUFFER_SECONDS = 2; // Buffer to account for timing differences (reduced for testing)

      const matchingOpen = opensWithRecipient.find(open => {
        const normalizedOpenEmail = normalizeEmail(open.recipientEmail);
        const emailMatches = normalizedOpenEmail &&
          normalizedOpenEmail === normalizedRecipientEmail;

        if (!emailMatches) {
          return false;
        }

        // Only count opens that happen after the email was sent (with buffer)
        const openTime = open.createdAt ? new Date(open.createdAt).getTime() : 0;
        const timeDiffSeconds = (openTime - sentAtTime) / 1000;

        // Open must happen at least BUFFER_SECONDS after send time
        return timeDiffSeconds >= BUFFER_SECONDS;
      });

      // Only set to true if we have a confirmed match that happened after sending
      if (matchingOpen) {
        hasOpened = true;
        readAt = matchingOpen.createdAt;
      }

      // Explicitly return false if no match found
      return {
        email,
        read: hasOpened === true, // Explicitly ensure boolean true
        readAt: readAt
      };
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
    const messages = await Message.find({ userId }).sort({ createdAt: -1 }).limit(200);
    const uids = messages.map(message => message.uid).filter(Boolean);

    if (!uids.length) {
      return res.json({
        userId,
        totalMessages: 0,
        totalOpens: 0,
        totalClicks: 0,
        messages: []
      });
    }

    const [openAgg, clickAgg] = await Promise.all([
      OpenEvent.aggregate([
        { $match: { messageUid: { $in: uids } } },
        { $group: { _id: '$messageUid', count: { $sum: 1 }, lastOpenedAt: { $max: '$createdAt' } } }
      ]),
      ClickEvent.aggregate([
        { $match: { messageUid: { $in: uids } } },
        { $group: { _id: '$messageUid', count: { $sum: 1 }, lastClickedAt: { $max: '$createdAt' } } }
      ])
    ]);

    const openMap = Object.fromEntries(openAgg.map(item => [item._id, item]));
    const clickMap = Object.fromEntries(clickAgg.map(item => [item._id, item]));

    // Get detailed opens for recipient status
    const detailedOpens = await OpenEvent.find({ messageUid: { $in: uids } })
      .select('messageUid recipientEmail createdAt')
      .lean();

    const summary = messages.map(message => {
      const opens = openMap[message.uid];
      const clicks = clickMap[message.uid];

      // Calculate recipient read status for this message (only for "To" recipients)
      const toRecipients = (message.recipients.to || []).filter(Boolean);

      // Normalize email for comparison (lowercase, trim)
      const normalizeEmail = (email) => (email || '').toLowerCase().trim();

      const messageOpens = detailedOpens.filter(open => open.messageUid === message.uid);

      const recipientStatus = toRecipients.map(email => {
        // Only mark as read if there's an actual open event with matching recipientEmail
        // Strict validation: recipientEmail must be a non-empty string and match exactly
        const normalizedRecipientEmail = normalizeEmail(email);

        // Default to false - only set to true if we find a confirmed match
        let hasOpened = false;
        let readAt = null;

        // Only check opens that have a recipientEmail (skip null/undefined)
        const opensWithRecipient = messageOpens.filter(open =>
          open.recipientEmail &&
          typeof open.recipientEmail === 'string' &&
          open.recipientEmail.trim().length > 0
        );

        // Find exact match - but only count opens that happen AFTER the email was sent
        // This prevents sender previews from being counted as recipient opens
        const sentAtTime = message.sentAt ? new Date(message.sentAt).getTime() : 0;
        const BUFFER_SECONDS = 2; // Buffer to account for timing differences (reduced for testing)

        const matchingOpen = opensWithRecipient.find(open => {
          const normalizedOpenEmail = normalizeEmail(open.recipientEmail);
          const emailMatches = normalizedOpenEmail &&
            normalizedOpenEmail === normalizedRecipientEmail;

          if (!emailMatches) {
            return false;
          }

          // Only count opens that happen after the email was sent (with buffer)
          const openTime = open.createdAt ? new Date(open.createdAt).getTime() : 0;
          const timeDiffSeconds = (openTime - sentAtTime) / 1000;

          // Open must happen at least BUFFER_SECONDS after send time
          return timeDiffSeconds >= BUFFER_SECONDS;
        });

        // Only set to true if we have a confirmed match that happened after sending
        if (matchingOpen) {
          hasOpened = true;
          readAt = matchingOpen.createdAt;
        }

        // Explicitly return false if no match found
        return {
          email,
          read: hasOpened === true, // Explicitly ensure boolean true
          readAt: readAt
        };
      });

      return {
        uid: message.uid,
        subject: message.subject,
        sentAt: message.sentAt,
        recipients: message.recipients,
        openCount: opens?.count || 0,
        clickCount: clicks?.count || 0,
        lastOpenedAt: opens?.lastOpenedAt || null,
        lastClickedAt: clicks?.lastClickedAt || null,
        recipientStatus // New: per-recipient read status
      };
    });

    const totalOpens = openAgg.reduce((acc, item) => acc + item.count, 0);
    const totalClicks = clickAgg.reduce((acc, item) => acc + item.count, 0);

    return res.json({
      userId,
      totalMessages: messages.length,
      totalOpens,
      totalClicks,
      messages: summary
    });
  } catch (error) {
    console.error('[MailTracker AI] user stats error', error);
    if (error?.stack) {
      console.error(error.stack);
    }
    return res.status(500).json({ error: 'Failed to load user stats' });
  }
});

export default router;
