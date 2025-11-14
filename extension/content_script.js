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
 * Simplified and direct approach that works with Gmail's actual DOM structure
 */
const extractRecipients = composeRoot => {
  const recipients = { to: [], cc: [], bcc: [] };
  const allFoundEmails = new Set();

  // Helper function to extract email from text
  const extractEmailsFromText = (text) => {
    if (!text || typeof text !== 'string') return [];
    const emailRegex = /([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/g;
    const matches = text.match(emailRegex) || [];
    return matches.map(email => email.toLowerCase().trim());
  };

  // Helper function to validate email
  const isValidEmail = (email) => {
    if (!email || typeof email !== 'string') return false;
    const normalized = email.trim().toLowerCase();
    return /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(normalized);
  };

  // Helper function to extract from "Name <email>" format
  const extractEmailFromFormat = (text) => {
    if (!text) return null;
    const match = text.match(/<([^>]+)>/) || text.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
    return match ? (match[1] || match[0]).trim().toLowerCase() : null;
  };

  console.log('[MailTracker AI] Starting recipient extraction...');

  // Method 1: Direct extraction from Gmail's chip-based UI
  // Find all textbox/contenteditable elements and extract emails from them
  const allTextboxes = composeRoot.querySelectorAll('div[role="textbox"], div[contenteditable="true"]');
  console.log(`[MailTracker AI] Found ${allTextboxes.length} textbox/contenteditable elements`);
  
  allTextboxes.forEach((textbox, index) => {
    const ariaLabel = (textbox.getAttribute('aria-label') || '').toLowerCase();
    const textContent = textbox.textContent || textbox.innerText || '';
    const innerHTML = textbox.innerHTML || '';
    
    console.log(`[MailTracker AI] Textbox ${index + 1}: aria-label="${ariaLabel}", text length=${textContent.length}`);
    
    // Determine which field this belongs to based on aria-label
    let field = null;
    if (ariaLabel.includes('to') && !ariaLabel.includes('cc') && !ariaLabel.includes('bcc')) {
      field = 'to';
    } else if (ariaLabel.includes('cc') && !ariaLabel.includes('bcc')) {
      field = 'cc';
    } else if (ariaLabel.includes('bcc')) {
      field = 'bcc';
    } else if (index === 0 && !field) {
      // First textbox is usually TO
      field = 'to';
    } else if (index === 1 && !field && !recipients.to.length) {
      // Second textbox might be CC if TO is empty
      field = 'cc';
    }
    
    if (field) {
      // Extract emails from this textbox
      const emails = new Set();
      
      // Extract from text content
      extractEmailsFromText(textContent).forEach(e => {
        if (isValidEmail(e)) emails.add(e);
      });
      
      // Extract from HTML
      extractEmailsFromText(innerHTML).forEach(e => {
        if (isValidEmail(e)) emails.add(e);
      });
      
      // Extract from all child elements (chips)
      const allChildren = textbox.querySelectorAll('*');
      allChildren.forEach(child => {
        // Check data attributes
        const dataEmail = child.getAttribute('data-email') || child.getAttribute('email') || child.getAttribute('data-value');
        if (dataEmail && isValidEmail(dataEmail)) {
          emails.add(dataEmail.toLowerCase().trim());
        }
        
        // Check text content
        const childText = child.textContent || child.innerText || '';
        extractEmailsFromText(childText).forEach(e => {
          if (isValidEmail(e)) emails.add(e);
        });
        
        // Check all attributes
        Array.from(child.attributes).forEach(attr => {
          if (attr.value && attr.value.includes('@')) {
            extractEmailsFromText(attr.value).forEach(e => {
              if (isValidEmail(e)) emails.add(e);
            });
          }
        });
      });
      
      // Add to recipients
      emails.forEach(email => {
        if (!allFoundEmails.has(email)) {
          recipients[field].push(email);
          allFoundEmails.add(email);
          console.log(`[MailTracker AI] Found ${field} email: ${email}`);
        }
      });
    }
  });
  
  // Method 2: Extract from textarea elements (older Gmail)
  ['to', 'cc', 'bcc'].forEach(field => {
    const textarea = composeRoot.querySelector(`textarea[name="${field}"]`);
    if (textarea && textarea.value) {
      const emails = textarea.value
        .split(/[,;]/)
        .map(item => extractEmailFromFormat(item.trim()) || item.trim().toLowerCase())
        .filter(isValidEmail);
      emails.forEach(email => {
        if (!allFoundEmails.has(email)) {
          recipients[field].push(email);
          allFoundEmails.add(email);
        }
      });
    }
  });

  // Clean up, normalize, and deduplicate emails
  Object.keys(recipients).forEach(key => {
    if (!recipients[key] || !Array.isArray(recipients[key]) || !recipients[key].length) {
      delete recipients[key];
    } else {
      // Normalize and validate all emails
      const normalizedEmails = new Set();
      
      recipients[key].forEach(email => {
        if (!email || typeof email !== 'string') return;
        
        // Extract email from "Name <email>" format if present
        const cleanEmail = extractEmailFromFormat(email) || email.trim().toLowerCase();
        
        // Split concatenated emails (if any)
        const splitEmails = extractEmailsFromText(cleanEmail);
        if (splitEmails.length > 0) {
          splitEmails.forEach(e => {
            const normalized = e.trim().toLowerCase();
            if (isValidEmail(normalized)) {
              normalizedEmails.add(normalized);
            }
          });
        } else {
          // Single email
          const normalized = cleanEmail.trim().toLowerCase();
          if (isValidEmail(normalized)) {
            normalizedEmails.add(normalized);
          }
        }
      });
      
      // Convert Set back to array
      recipients[key] = Array.from(normalizedEmails);
      
      // Delete if empty after filtering
      if (recipients[key].length === 0) {
        delete recipients[key];
      } else {
        console.log(`[MailTracker AI] Extracted ${recipients[key].length} ${key} recipient(s):`, recipients[key]);
      }
    }
  });

  // Final debug logging with summary
  const totalRecipients = (recipients.to?.length || 0) + 
                          (recipients.cc?.length || 0) + 
                          (recipients.bcc?.length || 0);
  console.log('[MailTracker AI] Final extracted recipients:', {
    to: recipients.to?.length || 0,
    cc: recipients.cc?.length || 0,
    bcc: recipients.bcc?.length || 0,
    total: totalRecipients,
    details: recipients
  });

  return recipients;
};

/**
 * Append tracking pixel images to the end of the compose body
 * For multiple recipients, generates one pixel per recipient with unique token
 */
const appendTrackingPixel = (bodyEl, uid, recipientTokens = null) => {
  if (!bodyEl) return;
  
  // If we have recipient tokens, generate one pixel per recipient
  if (recipientTokens && Object.keys(recipientTokens).length > 0) {
    Object.entries(recipientTokens).forEach(([email, token]) => {
      const pixelUrl = `${MAILTRACKER_BACKEND_BASE}/pixel?uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}`;
      
      // Check if this specific pixel URL is already in the body
      if (bodyEl.innerHTML.includes(pixelUrl)) {
        return; // already appended
      }

      const pixelImg = document.createElement('img');
      pixelImg.src = pixelUrl;
      pixelImg.width = 1;
      pixelImg.height = 1;
      pixelImg.style.display = 'none';
      pixelImg.alt = '';
      pixelImg.setAttribute('data-recipient', email); // For debugging

      bodyEl.appendChild(pixelImg);
    });
    
    console.log('[MailTracker AI] Added tracking pixels for', Object.keys(recipientTokens).length, 'recipients');
  } else {
    // Fallback: single pixel without token (for backward compatibility)
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
    console.log('[MailTracker AI] Added single tracking pixel (no recipient tokens)');
  }
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
    // Ensure href is a string before calling string methods
    if (!href || 
        typeof href !== 'string' ||
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
 * Returns recipientTokens if available
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

    // Try to send notification, but handle extension context invalidated gracefully
    try {
      chrome.runtime.sendMessage({
        type: 'mailtracker:notify',
        payload: {
          title: 'MailTracker AI',
          message: 'Tracking enabled for your outgoing email.'
        }
      });
    } catch (runtimeError) {
      // Extension context might be invalidated (extension reloaded)
      // This is not critical, just log it
      if (runtimeError.message && runtimeError.message.includes('Extension context invalidated')) {
        console.log('[MailTracker AI] Extension context invalidated (extension may have reloaded)');
      } else {
        console.warn('[MailTracker AI] Failed to send notification:', runtimeError);
      }
    }

    // Return recipientTokens if available
    return result.recipientTokens || null;
  } catch (error) {
    // Handle extension context invalidated error gracefully
    if (error.message && error.message.includes('Extension context invalidated')) {
      console.log('[MailTracker AI] Extension context invalidated - extension may have reloaded. Tracking pixel will still work.');
      // Return null so we still add the pixel (it will work even without registration)
      return null;
    }
    console.error('[MailTracker AI] Register error:', error);
    console.error('[MailTracker AI] Failed to register:', { uid, recipients, subject });
    return null;
  }
};

/**
 * Extract recipients with retry mechanism to handle DOM updates
 * Gmail's chips might not be fully rendered immediately
 */
const extractRecipientsWithRetry = async (composeRoot, maxRetries = 3, delay = 100) => {
  let bestResult = { to: [], cc: [], bcc: [] };
  let bestTotal = 0;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      // Wait a bit for DOM to update
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    const result = extractRecipients(composeRoot);
    const total = (result.to?.length || 0) + (result.cc?.length || 0) + (result.bcc?.length || 0);

    // If we found more recipients, use this result
    if (total > bestTotal) {
      bestResult = result;
      bestTotal = total;
      console.log(`[MailTracker AI] Attempt ${attempt + 1}: Found ${total} recipients`);
    }

    // If we found recipients in all fields, we can stop early
    if (bestTotal > 0 && 
        (result.to?.length || 0) > 0 && 
        (result.cc?.length || 0) >= 0 && 
        (result.bcc?.length || 0) >= 0) {
      // Check if we're getting consistent results
      if (attempt > 0 && total === bestTotal) {
        console.log(`[MailTracker AI] Consistent result after ${attempt + 1} attempts, using it`);
        break;
      }
    }
  }

  return bestResult;
};

/**
 * Handle click on Gmail send buttons and wire up tracking
 */
const handleSendClick = async event => {
  if (!trackingEnabled) {
    return; // user disabled tracking via popup toggle
  }

  const button = event.currentTarget;
  const composeRoot = button.closest('div[role="dialog"], td.Bu');
  if (!composeRoot) {
    console.warn('[MailTracker AI] Compose root not found');
    return;
  }

  const bodyEl = composeRoot.querySelector('div[aria-label="Message Body"], div.editable, div[contenteditable="true"]');
  const subjectInput = composeRoot.querySelector('input[name="subjectbox"], input[aria-label*="Subject" i]');

  if (!bodyEl) {
    console.warn('[MailTracker AI] Message body not found');
    return;
  }

  const uid = generateUUID();
  
  // Extract recipients with retry mechanism to ensure we get all of them
  const recipients = await extractRecipientsWithRetry(composeRoot);
  const subject = subjectInput ? subjectInput.value : '';

  // Final check: Log what we extracted
  const totalRecipients = (recipients.to?.length || 0) + 
                          (recipients.cc?.length || 0) + 
                          (recipients.bcc?.length || 0);
  
  if (totalRecipients === 0) {
    console.warn('[MailTracker AI] No recipients found! This might indicate an extraction issue.');
  } else {
    console.log(`[MailTracker AI] Successfully extracted ${totalRecipients} recipient(s) before send`);
  }

  // Register message first to get recipient tokens
  const recipientTokens = await registerMessage({ uid, recipients, subject });
  
  // Add tracking pixels with recipient tokens (if available)
  appendTrackingPixel(bodyEl, uid, recipientTokens);
  rewriteLinks(bodyEl, uid);
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
