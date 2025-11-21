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

    console.log('[MailTracker AI] Registering message:', {
      uid,
      subject,
      recipients: normalizedRecipients,
      userId
    });

    await Message.findOneAndUpdate(
      { uid },
      {
        uid,
        userId,
        subject,
        recipients: normalizedRecipients,
        sentAt,
        metadata
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error('[MailTracker AI] register error', error);
    return res.status(500).json({ error: 'Failed to save message metadata' });
  }
});

router.get('/pixel', async (req, res) => {
  const { uid } = req.query;

  if (!uid) {
    return res.status(400).end();
  }

  try {
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    // Look up message to determine recipient (only track "To" recipients)
    let recipientEmail = null;
    try {
      const message = await Message.findOne({ uid });
      if (message?.recipients) {
        const toRecipients = (message.recipients.to || []).filter(Boolean);
        
        // Only track recipient if there's exactly one "To" recipient (we can't distinguish multiple)
        // Normalize email (lowercase, trim) for consistent matching
        if (toRecipients.length === 1) {
          const normalizedEmail = toRecipients[0].toLowerCase().trim();
          // Only set recipientEmail if it's a valid non-empty string
          if (normalizedEmail && normalizedEmail.length > 0) {
            recipientEmail = normalizedEmail;
            console.log('[MailTracker AI] Pixel loaded - Single "To" recipient detected:', recipientEmail);
          } else {
            console.log('[MailTracker AI] Pixel loaded - Invalid recipient email, skipping recipient tracking');
          }
        } else if (toRecipients.length > 1) {
          console.log('[MailTracker AI] Pixel loaded - Multiple "To" recipients, cannot track individual opens:', toRecipients.length);
        } else {
          console.log('[MailTracker AI] Pixel loaded - No "To" recipients found in message');
        }
      }
    } catch (lookupError) {
      // If message lookup fails, continue without recipient tracking
      console.warn('[MailTracker AI] Could not lookup message for recipient tracking', lookupError);
    }

    await OpenEvent.create({
      messageUid: uid,
      recipientEmail, // Will be null if multiple recipients or lookup failed
      ipHash: hashIp(ip, userAgent),
      userAgent
    });
    
    console.log('[MailTracker AI] OpenEvent created:', { messageUid: uid, recipientEmail, hasRecipientEmail: !!recipientEmail });
  } catch (error) {
    console.error('[MailTracker AI] pixel logging error', error);
  }

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
      const matchingOpen = opens.find(open => {
        // Must have recipientEmail and it must be a string
        if (!open.recipientEmail || typeof open.recipientEmail !== 'string') {
          return false;
        }
        // Must not be empty after normalization
        const normalizedOpenEmail = normalizeEmail(open.recipientEmail);
        if (!normalizedOpenEmail) {
          return false;
        }
        // Must match exactly
        return normalizedOpenEmail === normalizedRecipientEmail;
      });
      
      const hasOpened = !!matchingOpen;
      
      return {
        email,
        read: hasOpened, // Only true if recipient actually opened
        readAt: hasOpened ? matchingOpen.createdAt : null
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
        const matchingOpen = messageOpens.find(open => {
          // Must have recipientEmail and it must be a string
          if (!open.recipientEmail || typeof open.recipientEmail !== 'string') {
            return false;
          }
          // Must not be empty after normalization
          const normalizedOpenEmail = normalizeEmail(open.recipientEmail);
          if (!normalizedOpenEmail) {
            return false;
          }
          // Must match exactly
          return normalizedOpenEmail === normalizedRecipientEmail;
        });
        
        const hasOpened = !!matchingOpen;
        
        return {
          email,
          read: hasOpened, // Only true if recipient actually opened
          readAt: hasOpened ? matchingOpen.createdAt : null
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
