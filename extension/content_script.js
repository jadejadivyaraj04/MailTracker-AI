// MailTracker AI Content Script
// Injected into Gmail to append tracking pixels, rewrite links, and notify backend

const MAILTRACKER_BACKEND_BASE = 'https://mailtracker-backend.onrender.com';
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
 */
const extractRecipients = composeRoot => {
  const fields = ['to', 'cc', 'bcc'];
  const recipients = {};

  fields.forEach(field => {
    const textarea = composeRoot.querySelector(`textarea[name="${field}"]`);
    if (textarea) {
      const value = textarea.value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
      if (value.length) {
        recipients[field] = value;
      }
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
  const links = bodyEl.querySelectorAll('a[href]');
  links.forEach(link => {
    const href = link.getAttribute('href');

    if (!href || href.startsWith(MAILTRACKER_BACKEND_BASE)) {
      return; // already rewritten or invalid
    }

    const redirectUrl = `${MAILTRACKER_BACKEND_BASE}/redirect?uid=${encodeURIComponent(uid)}&to=${encodeURIComponent(href)}`;
    link.setAttribute('href', redirectUrl);
  });
};

/**
 * Send metadata about the outgoing email to the backend
 */
const registerMessage = async ({ uid, recipients, subject }) => {
  try {
    await fetch(`${MAILTRACKER_BACKEND_BASE}/register`, {
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

    chrome.runtime.sendMessage({
      type: 'mailtracker:notify',
      payload: {
        title: 'MailTracker AI',
        message: 'Tracking enabled for your outgoing email.'
      }
    });
  } catch (error) {
    console.error('MailTracker AI register error', error);
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
