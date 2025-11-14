import express from 'express';
import crypto from 'crypto';
import Message from '../models/Message.js';
import OpenEvent from '../models/OpenEvent.js';
import ClickEvent from '../models/ClickEvent.js';

const router = express.Router();

const PIXEL_BUFFER = Buffer.from('R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

// Minimum time (in milliseconds) after sending before we count an open as valid
// This filters out email preview services that load images immediately
const MIN_OPEN_DELAY_MS = 3000; // 3 seconds

// Known bot/preview user agents that should be filtered out
const BOT_USER_AGENTS = [
  'googlebot',
  'bingbot',
  'slurp',
  'duckduckbot',
  'baiduspider',
  'yandexbot',
  'sogou',
  'exabot',
  'facebot',
  'ia_archiver',
  'preview',
  'crawler',
  'spider',
  'bot'
];

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

/**
 * Check if user agent is likely a bot or preview service
 */
const isBotOrPreview = (userAgent) => {
  if (!userAgent) return true; // No user agent = likely bot
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some(bot => ua.includes(bot));
};

/**
 * Check if open event should be considered valid
 * Filters out previews and bots
 */
const isValidOpen = (message, userAgent) => {
  // Filter out bots
  if (isBotOrPreview(userAgent)) {
    return false;
  }

  // Check if enough time has passed since sending (filters out previews)
  if (message?.sentAt) {
    const timeSinceSent = Date.now() - new Date(message.sentAt).getTime();
    if (timeSinceSent < MIN_OPEN_DELAY_MS) {
      return false; // Too soon after sending = likely preview
    }
  }

  return true;
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

    // Generate unique token for each recipient
    const allRecipients = [
      ...normalizedRecipients.to,
      ...normalizedRecipients.cc,
      ...normalizedRecipients.bcc
    ];
    
    const recipientTokens = {};
    if (allRecipients.length > 0) {
      allRecipients.forEach(email => {
        // Generate a unique token for each recipient (16 bytes = 32 hex chars)
        recipientTokens[email] = crypto.randomBytes(16).toString('hex');
      });
    }

    console.log('[MailTracker AI] Registering message:', {
      uid,
      subject,
      recipients: normalizedRecipients,
      recipientCount: allRecipients.length,
      userId
    });

    // Build update object - only include recipientTokens if there are recipients
    const updateData = {
      uid,
      userId,
      subject,
      recipients: normalizedRecipients,
      sentAt,
      metadata
    };
    
    // Only add recipientTokens if we have recipients (avoid empty Map issues)
    if (Object.keys(recipientTokens).length > 0) {
      updateData.recipientTokens = recipientTokens;
    }

    await Message.findOneAndUpdate(
      { uid },
      updateData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Return tokens so content script can use them for pixel URLs
    return res.json({ 
      ok: true, 
      recipientTokens: Object.keys(recipientTokens).length > 0 ? recipientTokens : null
    });
  } catch (error) {
    console.error('[MailTracker AI] register error', error);
    console.error('[MailTracker AI] register error stack', error.stack);
    return res.status(500).json({ error: 'Failed to save message metadata', details: error.message });
  }
});

router.get('/pixel', async (req, res) => {
  const { uid, token } = req.query;

  if (!uid) {
    return res.status(400).end();
  }

  try {
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    // Look up message to validate and determine recipient
    let message = null;
    let recipientEmail = null;
    let isValid = false;

    try {
      message = await Message.findOne({ uid });
      
      if (message) {
        // Validate if this is a legitimate open (not a bot/preview)
        isValid = isValidOpen(message, userAgent);
        
        if (isValid) {
          // Method 1: If token is provided, look up recipient from token
          if (token && message.recipientTokens) {
            // Find recipient email that matches this token
            // recipientTokens is stored as Mixed type (plain object)
            const recipientTokens = message.recipientTokens;
            
            if (recipientTokens && typeof recipientTokens === 'object') {
              for (const [email, storedToken] of Object.entries(recipientTokens)) {
                if (storedToken === token) {
                  recipientEmail = email.toLowerCase().trim();
                  console.log('[MailTracker AI] Pixel loaded - Recipient identified from token:', recipientEmail);
                  break;
                }
              }
            }
            
            if (!recipientEmail) {
              console.log('[MailTracker AI] Pixel loaded - Token provided but not found in recipientTokens');
            }
          }
          
          // Method 2: Fallback to single recipient detection (for backward compatibility)
          if (!recipientEmail && message?.recipients) {
            const allRecipients = [
              ...(message.recipients.to || []),
              ...(message.recipients.cc || []),
              ...(message.recipients.bcc || [])
            ].filter(Boolean);
            
            // Only track recipient if there's exactly one (we can't distinguish multiple without token)
            if (allRecipients.length === 1) {
              recipientEmail = allRecipients[0].toLowerCase().trim();
              console.log('[MailTracker AI] Pixel loaded - Single recipient detected (fallback):', recipientEmail);
            } else if (allRecipients.length > 1 && !token) {
              console.log('[MailTracker AI] Pixel loaded - Multiple recipients, no token provided, cannot track individual opens:', allRecipients.length);
            } else if (allRecipients.length === 0) {
              console.log('[MailTracker AI] Pixel loaded - No recipients found in message');
            }
          }
        }
      }
    } catch (lookupError) {
      // If message lookup fails, continue without recipient tracking
      console.warn('[MailTracker AI] Could not lookup message for recipient tracking', lookupError);
    }

    // Only create OpenEvent if it's a valid open (not a bot/preview)
    if (isValid) {
      const ipHashValue = hashIp(ip, userAgent);
      
      // Deduplication: Check if there's already an open event from the same IP/user agent
      // within the last 5 seconds (to handle multiple pixels loading simultaneously)
      const fiveSecondsAgo = new Date(Date.now() - 5000);
      const existingOpen = await OpenEvent.findOne({
        messageUid: uid,
        ipHash: ipHashValue,
        createdAt: { $gte: fiveSecondsAgo }
      });
      
      if (existingOpen) {
        // If we have a recipient email from token, update the existing event
        // (This handles the case where multiple pixels load, and we want to identify the actual recipient)
        if (recipientEmail) {
          // Only update if existing event doesn't have a recipient email, or if it matches
          // (to avoid overwriting correct recipient with wrong one from different pixel)
          if (!existingOpen.recipientEmail || existingOpen.recipientEmail === recipientEmail) {
            existingOpen.recipientEmail = recipientEmail;
            await existingOpen.save();
            console.log('[MailTracker AI] OpenEvent updated with recipient email:', { 
              messageUid: uid, 
              recipientEmail 
            });
          } else {
            console.log('[MailTracker AI] OpenEvent skipped (different recipient already set):', { 
              messageUid: uid, 
              recipientEmail,
              existingRecipient: existingOpen.recipientEmail
            });
          }
        } else {
          console.log('[MailTracker AI] OpenEvent skipped (duplicate within 5s, no recipient identified):', { 
            messageUid: uid,
            existingRecipient: existingOpen.recipientEmail
          });
        }
      } else {
        // Create new open event
        await OpenEvent.create({
          messageUid: uid,
          recipientEmail, // Will be null if multiple recipients or lookup failed
          ipHash: ipHashValue,
          userAgent
        });
        
        console.log('[MailTracker AI] OpenEvent created (valid):', { 
          messageUid: uid, 
          recipientEmail, 
          hasRecipientEmail: !!recipientEmail,
          userAgent: userAgent.substring(0, 50) // Log first 50 chars for debugging
        });
      }
    } else {
      // Log filtered opens for debugging
      const reason = !message ? 'message not found' : 
                     isBotOrPreview(userAgent) ? 'bot/preview user agent' : 
                     'opened too soon after sending (likely preview)';
      console.log('[MailTracker AI] OpenEvent filtered (invalid):', { 
        messageUid: uid, 
        reason,
        userAgent: userAgent.substring(0, 50),
        timeSinceSent: message ? Date.now() - new Date(message.sentAt).getTime() : 'N/A'
      });
    }
  } catch (error) {
    console.error('[MailTracker AI] pixel logging error', error);
  }

  // Always return the pixel image, even if we filtered the event
  // This prevents broken images in emails
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

    // Calculate recipient read status
    const allRecipients = [
      ...(message.recipients.to || []),
      ...(message.recipients.cc || []),
      ...(message.recipients.bcc || [])
    ].filter(Boolean);

    // Normalize email for comparison (lowercase, trim)
    const normalizeEmail = (email) => (email || '').toLowerCase().trim();

    const recipientStatus = allRecipients.map(email => {
      // Only mark as read if there's an actual open event with matching recipientEmail
      const matchingOpen = opens.find(open => 
        open.recipientEmail && 
        normalizeEmail(open.recipientEmail) === normalizeEmail(email)
      );
      
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

      // Calculate recipient read status for this message
      const allRecipients = [
        ...(message.recipients.to || []),
        ...(message.recipients.cc || []),
        ...(message.recipients.bcc || [])
      ].filter(Boolean);

      // Normalize email for comparison (lowercase, trim)
      const normalizeEmail = (email) => (email || '').toLowerCase().trim();

      const messageOpens = detailedOpens.filter(open => open.messageUid === message.uid);
      
      const recipientStatus = allRecipients.map(email => {
        // Only mark as read if there's an actual open event with matching recipientEmail
        const matchingOpen = messageOpens.find(open => 
          open.recipientEmail && 
          normalizeEmail(open.recipientEmail) === normalizeEmail(email)
        );
        
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
