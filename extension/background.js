// MailTracker AI Background Service Worker
// Manages storage defaults, exposes messaging bridge, and shows notifications

const syncUserEmail = () => {
  if (typeof chrome.identity !== 'undefined' && chrome.identity.getProfileUserInfo) {
    chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (userInfo) => {
      if (userInfo && userInfo.email) {
        console.log('[MailTracker AI] Synced user email:', userInfo.email);
        chrome.storage.sync.set({ userId: userInfo.email });
      }
    });
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ trackingEnabled: true, userId: 'default' }, items => {
    const updates = {};
    if (typeof items.trackingEnabled !== 'boolean') {
      updates.trackingEnabled = true;
    }
    if (!items.userId || items.userId === 'default') {
      // Identity will overwrite this if successful
      updates.userId = 'default';
    }
    if (Object.keys(updates).length) {
      chrome.storage.sync.set(updates, syncUserEmail);
    } else {
      syncUserEmail();
    }
  });
});

/**
 * Display Chrome notification if permission granted
 */
const showNotification = ({ title, message }) => {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/128.png',
    title,
    message
  });
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request) return;

  if (request.type === 'mailtracker:notify') {
    showNotification(request.payload || { title: 'MailTracker AI', message: 'Event received.' });
  }

  if (request.type === 'mailtracker:get-status') {
    chrome.storage.sync.get({ trackingEnabled: true }, items => {
      sendResponse({ trackingEnabled: items.trackingEnabled });
    });
    return true; // keep messaging channel alive for async response
  }

  if (request.type === 'mailtracker:set-status') {
    chrome.storage.sync.set({ trackingEnabled: Boolean(request.payload?.trackingEnabled) }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (request.type === 'mailtracker:get-user') {
    chrome.storage.sync.get({ userId: 'default' }, items => {
      if (items.userId === 'default') {
        // Try to sync again if still default
        syncUserEmail();
      }
      sendResponse({ userId: items.userId });
    });
    return true;
  }

  if (request.type === 'mailtracker:set-user') {
    chrome.storage.sync.set({ userId: request.payload?.userId || 'default' }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  return undefined;
});
