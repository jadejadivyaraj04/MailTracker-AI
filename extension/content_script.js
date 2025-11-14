// MailTracker AI Content Script
// Injected into Gmail to append tracking pixels, rewrite links, and notify backend

const MAILTRACKER_BACKEND_BASE = 'https://mailtracker-ai.onrender.com';
let trackingEnabled = true; // default, will sync with storage
let userId = 'default';

/**
 * Generate RFC4122 version 4 UUID using crypto.getRandomValues
 */
const generateUUID = () => {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (
    c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4
  ).toString(16));
};

/**
 * Fetch current tracking preferences from storage and keep them in sync
 */
const initStorageSync = () => {
  chrome.storage.sync.get({ trackingEnabled: true, userId: 'default' }, ({ trackingEnabled: storedTracking, userId: storedUserId }) => {
    trackingEnabled = storedTracking;
    userId = storedUserId || 'default';
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.trackingEnabled) {
      trackingEnabled = changes.trackingEnabled.newValue;
    }
    if (changes.userId) {
      userId = changes.userId.newValue || 'default';
    }
  });
};

/**
 * Extract recipients (to/cc/bcc) from the compose dialog
 * Gmail uses complex DOM structure, so we need multiple selectors
 */
const extractRecipients = composeRoot => {
  const recipients = { to: [], cc: [], bcc: [] };

  // Method 1: Try textarea with name attribute (older Gmail)
  ['to', 'cc', 'bcc'].forEach(field => {
    const textarea = composeRoot.querySelector(`textarea[name="${field}"]`);
    if (textarea && textarea.value) {
      const emails = textarea.value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
      if (emails.length) {
        recipients[field] = emails;
      }
    }
  });

  // Method 2: Try input fields (newer Gmail compose)
  const toInput = composeRoot.querySelector('input[aria-label*="To"], input[aria-label*="Recipients"]');
  if (toInput && toInput.value) {
    const emails = toInput.value
      .split(',')
      .map(item => item.trim().replace(/<.*?>/, '').trim()) // Remove name tags like "Name <email>"
      .filter(Boolean);
    if (emails.length && !recipients.to.length) {
      recipients.to = emails;
    }
  }

  // Method 3: Extract from chips/tokens (Gmail's chip-based UI)
  const extractFromChips = (labelText) => {
    const chips = composeRoot.querySelectorAll(`span[aria-label*="${labelText}"], div[aria-label*="${labelText}"]`);
    const emails = [];
    chips.forEach(chip => {
      const emailMatch = chip.textContent.match(/[\w\.-]+@[\w\.-]+\.\w+/);
      if (emailMatch) {
        emails.push(emailMatch[0]);
      }
    });
    return emails;
  };

  // Try to extract from visible chips
  if (!recipients.to.length) {
    const toChips = extractFromChips('To');
    if (toChips.length) recipients.to = toChips;
  }

  if (!recipients.cc.length) {
    const ccChips = extractFromChips('Cc');
    if (ccChips.length) recipients.cc = ccChips;
  }

  if (!recipients.bcc.length) {
    const bccChips = extractFromChips('Bcc');
    if (bccChips.length) recipients.bcc = bccChips;
  }

  // Method 4: Try to find email addresses in the compose header area
  const composeHeader = composeRoot.querySelector('[role="dialog"] > div, .aHl');
  if (composeHeader && (!recipients.to.length || !recipients.cc.length || !recipients.bcc.length)) {
    const allText = composeHeader.textContent || '';
    const emailRegex = /[\w\.-]+@[\w\.-]+\.\w+/g;
    const foundEmails = allText.match(emailRegex) || [];
    
    // If we found emails but couldn't categorize them, put them in "to"
    if (foundEmails.length && !recipients.to.length && !recipients.cc.length && !recipients.bcc.length) {
      recipients.to = [...new Set(foundEmails)]; // Remove duplicates
    }
  }

  // Clean up empty arrays
  Object.keys(recipients).forEach(key => {
    if (!recipients[key].length) {
      delete recipients[key];
    }
  });

  return recipients;
};

/**
 * Append tracking pixel image to the end of the compose body
 */
const appendTrackingPixel = (bodyEl, uid) => {
  if (!bodyEl) return;
  const pixelUrl = `${MAILTRACKER_BACKEND_BASE}/pixel?uid=${encodeURIComponent(uid)}`;

  if (bodyEl.innerHTML.includes(pixelUrl)) {
    return; // already appended for this UID
  }

  const pixelImg = document.createElement('img');
  pixelImg.src = pixelUrl;
  pixelImg.width = 1;
  pixelImg.height = 1;
  pixelImg.style.display = 'none';
  pixelImg.alt = '';

  bodyEl.appendChild(pixelImg);
};

/**
 * Rewrite links in the compose body to pass through our redirect endpoint
 */
const rewriteLinks = (bodyEl, uid) => {
  if (!bodyEl) return;
  
  // Get all links including those in iframes (Gmail's compose editor)
  const links = bodyEl.querySelectorAll('a[href]');
  
  links.forEach(link => {
    const href = link.getAttribute('href');

    // Skip if already rewritten, invalid, or mailto links
    if (!href || 
        href.startsWith(MAILTRACKER_BACKEND_BASE) || 
        href.startsWith('mailto:') ||
        href.startsWith('javascript:') ||
        href.startsWith('#') ||
        href.trim() === '') {
      return;
    }

    // Only rewrite http/https links
    if (!href.match(/^https?:\/\//i)) {
      return;
    }

    const redirectUrl = `${MAILTRACKER_BACKEND_BASE}/redirect?uid=${encodeURIComponent(uid)}&to=${encodeURIComponent(href)}`;
    link.setAttribute('href', redirectUrl);
    
    // Also update the href property directly (some editors use this)
    if (link.href) {
      link.href = redirectUrl;
    }
  });

  // Also check innerHTML for links that might be added later
  const htmlContent = bodyEl.innerHTML || '';
  if (htmlContent.includes('href=') && !htmlContent.includes(MAILTRACKER_BACKEND_BASE)) {
    // Replace links in HTML content
    const linkRegex = /(<a\s+[^>]*href=["'])(https?:\/\/[^"']+)(["'][^>]*>)/gi;
    const updatedHtml = htmlContent.replace(linkRegex, (match, prefix, url, suffix) => {
      if (url.startsWith(MAILTRACKER_BACKEND_BASE)) return match;
      const trackedUrl = `${MAILTRACKER_BACKEND_BASE}/redirect?uid=${encodeURIComponent(uid)}&to=${encodeURIComponent(url)}`;
      return `${prefix}${trackedUrl}${suffix}`;
    });
    
    if (updatedHtml !== htmlContent) {
      bodyEl.innerHTML = updatedHtml;
    }
  }
};

/**
 * Send metadata about the outgoing email to the backend
 */
const registerMessage = async ({ uid, recipients, subject }) => {
  // Debug logging
  console.log('[MailTracker AI] Registering message:', {
    uid,
    subject,
    recipients,
    userId
  });

  try {
    const response = await fetch(`${MAILTRACKER_BACKEND_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid,
        recipients,
        subject,
        timestamp: new Date().toISOString(),
        userId
      })
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const result = await response.json();
    console.log('[MailTracker AI] Message registered successfully:', result);

    chrome.runtime.sendMessage({
      type: 'mailtracker:notify',
      payload: {
        title: 'MailTracker AI',
        message: 'Tracking enabled for your outgoing email.'
      }
    });
  } catch (error) {
    console.error('[MailTracker AI] Register error:', error);
    console.error('[MailTracker AI] Failed to register:', { uid, recipients, subject });
  }
};

/**
 * Handle click on Gmail send buttons and wire up tracking
 */
const handleSendClick = event => {
  if (!trackingEnabled) {
    return; // user disabled tracking via popup toggle
  }

  const button = event.currentTarget;
  const composeRoot = button.closest('div[role="dialog"], td.Bu');
  if (!composeRoot) {
    return;
  }

  const bodyEl = composeRoot.querySelector('div[aria-label="Message Body"], div.editable');
  const subjectInput = composeRoot.querySelector('input[name="subjectbox"]');

  if (!bodyEl) {
    console.warn('MailTracker AI: Message body not found');
    return;
  }

  const uid = generateUUID();
  appendTrackingPixel(bodyEl, uid);
  rewriteLinks(bodyEl, uid);

  const recipients = extractRecipients(composeRoot);
  const subject = subjectInput ? subjectInput.value : '';

  // Debug: Log what we extracted
  console.log('[MailTracker AI] Extracted recipients:', recipients);
  console.log('[MailTracker AI] Extracted subject:', subject);

  registerMessage({ uid, recipients, subject });
};

/**
 * Observe Gmail compose UI for send buttons and attach listeners once
 */
const observeComposeUI = () => {
  const seenButtons = new WeakSet();

  const attachListeners = root => {
    const buttons = root.querySelectorAll('div[role="button"][data-tooltip*="Send"], div[role="button"][aria-label^="Send"], div[role="button"][data-tooltip-id^="tooltip"]');

    buttons.forEach(button => {
      if (seenButtons.has(button)) return;
      seenButtons.add(button);
      button.addEventListener('click', handleSendClick, { capture: true });
    });
  };

  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches('div[role="dialog"]')) {
          attachListeners(node);
        } else {
          attachListeners(node);
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial attach for already open compose windows
  attachListeners(document.body);
};

const bootstrap = () => {
  initStorageSync();
  observeComposeUI();
};

document.addEventListener('DOMContentLoaded', bootstrap);

// Gmail is a SPA; ensure scripts run even if DOMContentLoaded already fired
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  bootstrap();
}
