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
      // Split by comma and extract emails from "Name <email>" format
      const emails = textarea.value
        .split(',')
        .map(item => {
          const trimmed = item.trim();
          // Extract email from "Name <email>" format
          const emailMatch = trimmed.match(/<([^>]+)>/) || trimmed.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
          return emailMatch ? (emailMatch[1] || emailMatch[0]).trim() : trimmed;
        })
        .filter(email => {
          // Validate it's actually an email
          return email && /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(email);
        });
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
      .map(item => {
        // Extract email from "Name <email>" format or just email
        const emailMatch = item.match(/<([^>]+)>/) || item.match(/([\w\.-]+@[\w\.-]+\.\w+)/);
        return emailMatch ? emailMatch[1] || emailMatch[0] : item.trim();
      })
      .map(email => email.trim())
      .filter(Boolean);
    if (emails.length && !recipients.to.length) {
      recipients.to = emails;
    }
  }

  // Method 3: Extract from chips/tokens (Gmail's chip-based UI)
  // Gmail uses specific aria-labels and data attributes for each field
  const extractFromChips = (fieldName) => {
    const emails = [];
    
    // Find the container for this specific field (To, Cc, or Bcc)
    const fieldLabels = {
      'to': ['To', 'Recipients'],
      'cc': ['Cc', 'CC'],
      'bcc': ['Bcc', 'BCC']
    };
    
    const labels = fieldLabels[fieldName.toLowerCase()] || [fieldName];
    
    // Try to find the field container first
    let fieldContainer = null;
    for (const label of labels) {
      // Look for the field label/header
      const labelElement = Array.from(composeRoot.querySelectorAll('div, span')).find(el => {
        const text = el.textContent?.trim() || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        return (text === label || ariaLabel.includes(label)) && 
               (ariaLabel.toLowerCase().includes('to') || 
                ariaLabel.toLowerCase().includes('cc') || 
                ariaLabel.toLowerCase().includes('bcc'));
      });
      
      if (labelElement) {
        // Find the parent container that holds the chips
        fieldContainer = labelElement.closest('div[role="textbox"], div[contenteditable="true"], div[aria-label*="' + label + '"]') ||
                         labelElement.parentElement;
        if (fieldContainer) break;
      }
    }
    
    // If we found a container, extract chips from it
    if (fieldContainer) {
      // Look for chip elements within this container
      const chips = fieldContainer.querySelectorAll('[data-email], [email], span[email], div[role="option"]');
      chips.forEach(chip => {
        // Try data-email attribute first (most reliable)
        const dataEmail = chip.getAttribute('data-email') || chip.getAttribute('email');
        if (dataEmail) {
          emails.push(dataEmail);
          return;
        }
        
        // Extract email from text content
        const text = chip.textContent || '';
        const emailRegex = /([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/g;
        const matches = text.match(emailRegex);
        if (matches) {
          emails.push(...matches);
        }
      });
    }
    
    // Fallback: Try direct selectors with field-specific aria-labels
    if (emails.length === 0) {
      for (const label of labels) {
        const selector = `div[aria-label*="${label}" i] [data-email], div[aria-label*="${label}" i] [email]`;
        const chips = composeRoot.querySelectorAll(selector);
        chips.forEach(chip => {
          const email = chip.getAttribute('data-email') || chip.getAttribute('email');
          if (email) emails.push(email);
        });
      }
    }
    
    return [...new Set(emails)]; // Remove duplicates
  };

  // Try to extract from visible chips for each field
  if (!recipients.to.length) {
    const toChips = extractFromChips('to');
    if (toChips.length) recipients.to = toChips;
  }

  if (!recipients.cc.length) {
    const ccChips = extractFromChips('cc');
    if (ccChips.length) recipients.cc = ccChips;
  }

  if (!recipients.bcc.length) {
    const bccChips = extractFromChips('bcc');
    if (bccChips.length) recipients.bcc = bccChips;
  }

  // Method 4: Try to find email addresses in the compose header area
  const composeHeader = composeRoot.querySelector('[role="dialog"] > div, .aHl');
  if (composeHeader && (!recipients.to.length || !recipients.cc.length || !recipients.bcc.length)) {
    const allText = composeHeader.textContent || '';
    const allHtml = composeHeader.innerHTML || '';
    // Improved email regex to handle all valid email formats
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/g;
    const foundEmails = [...(allText.match(emailRegex) || []), ...(allHtml.match(emailRegex) || [])];
    
    // If we found emails but couldn't categorize them, put them in "to"
    if (foundEmails.length && !recipients.to.length && !recipients.cc.length && !recipients.bcc.length) {
      recipients.to = [...new Set(foundEmails)]; // Remove duplicates
    }
  }
  
  // Method 5: Try to extract from Gmail's recipient input areas more precisely
  // Look for each field's input area specifically
  ['to', 'cc', 'bcc'].forEach(field => {
    if (recipients[field].length) return; // Skip if already found
    
    // Find input areas for this specific field
    const fieldInputs = composeRoot.querySelectorAll(
      `div[aria-label*="${field}" i][role="textbox"], 
       div[aria-label*="${field}" i][contenteditable="true"],
       textarea[name="${field}"]`
    );
    
    const fieldEmails = [];
    fieldInputs.forEach(input => {
      // Get all chips within this input area
      const chips = input.querySelectorAll('[data-email], [email]');
      chips.forEach(chip => {
        const email = chip.getAttribute('data-email') || chip.getAttribute('email');
        if (email) fieldEmails.push(email);
      });
      
      // Also check the input value itself
      const value = input.value || input.textContent || '';
      if (value) {
        const emailRegex = /([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/g;
        const matches = value.match(emailRegex);
        if (matches) fieldEmails.push(...matches);
      }
    });
    
    if (fieldEmails.length) {
      recipients[field] = [...new Set(fieldEmails)];
    }
  });

  /**
   * Split concatenated emails by detecting TLD boundaries
   * Example: "email1@example.comemail2@example.com" -> ["email1@example.com", "email2@example.com"]
   */
  const splitConcatenatedEmails = (text) => {
    if (!text || typeof text !== 'string') return [];
    
    const emails = [];
    // Common TLDs to split on
    const tldPattern = /\.(com|net|org|edu|gov|mil|co|io|ai|uk|ca|au|de|fr|jp|in|cn|br|ru|es|it|nl|se|no|dk|fi|pl|cz|gr|pt|ie|be|at|ch|nz|za|mx|ar|cl|co|pe|ve|ec|uy|py|bo|cr|pa|do|gt|hn|ni|sv|bz|jm|tt|bb|gd|lc|vc|ag|dm|kn|mu|sc|tz|ke|ug|et|gh|ng|sn|ci|cm|ga|cg|cd|ao|mz|zw|bw|na|sz|ls|mg|rw|bi|td|ne|ml|bf|mr|gm|gw|gn|sl|lr|tg|bj|dj|km|so|er|sd|ly|tn|dz|ma|eh|ss|ye|iq|sy|jo|lb|ps|il|sa|ae|om|qa|bh|kw|ir|af|pk|bd|lk|mv|np|bt|mm|th|la|kh|vn|ph|my|sg|bn|id|tl|pg|fj|nc|pf|ws|to|vu|sb|ki|nr|pw|fm|mh|as|gu|mp|vi|pr|do|ht|cu|jm|bs|ky|tc|vg|ai|ms|bl|mf|pm|wf|tf|re|yt|mo|hk|tw|kr|jp|cn|mn|kz|uz|tj|kg|tm|az|ge|am|by|ua|md|ro|bg|rs|me|ba|hr|si|sk|hu|ee|lv|lt|is|fo|gl|ax|sj|sx|bq|cw|aw|ky|vg|ai|ms|bl|mf|pm|wf|tf|re|yt|mo|hk|tw|kr|jp|cn|mn|kz|uz|tj|kg|tm|az|ge|am|by|ua|md|ro|bg|rs|me|ba|hr|si|sk|hu|ee|lv|lt|is|fo|gl|ax|sj|sx|bq|cw|aw)\b/gi;
    
    // Find all email patterns in the text
    const emailRegex = /[a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}/g;
    let match;
    const foundEmails = [];
    
    while ((match = emailRegex.exec(text)) !== null) {
      foundEmails.push(match[0]);
    }
    
    // If we found emails, return them
    if (foundEmails.length > 0) {
      return foundEmails;
    }
    
    // Fallback: Try to split by TLD pattern if no emails found
    // This handles cases like "email1@example.comemail2@example.com"
    const parts = text.split(tldPattern);
    const potentialEmails = [];
    let currentEmail = '';
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (tldPattern.test('.' + part)) {
        // This is a TLD
        currentEmail += '.' + part;
        // Check if currentEmail looks like an email
        if (currentEmail.includes('@') && currentEmail.match(/^[a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/)) {
          potentialEmails.push(currentEmail);
          currentEmail = '';
        }
      } else {
        currentEmail += part;
      }
    }
    
    // If we built any emails, return them
    if (potentialEmails.length > 0) {
      return potentialEmails;
    }
    
    // Last resort: return the original text if it looks like an email
    if (text.includes('@') && text.includes('.')) {
      return [text];
    }
    
    return [];
  };

  // Clean up and normalize emails
  Object.keys(recipients).forEach(key => {
    if (!recipients[key] || !Array.isArray(recipients[key]) || !recipients[key].length) {
      delete recipients[key];
    } else {
      // First, try to split any concatenated emails
      const allEmails = [];
      recipients[key].forEach(email => {
        if (!email || typeof email !== 'string') return;
        
        // Extract email from "Name <email>" format if present
        const emailMatch = email.match(/<([^>]+)>/) || email.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
        const cleanEmail = emailMatch ? (emailMatch[1] || emailMatch[0]) : email;
        
        // Split concatenated emails
        const splitEmails = splitConcatenatedEmails(cleanEmail);
        allEmails.push(...splitEmails);
      });
      
      // Normalize and validate
      const originalCount = allEmails.length;
      recipients[key] = allEmails
        .map(email => {
          if (!email || typeof email !== 'string') return null;
          
          const normalized = email.trim().toLowerCase();
          
          // Basic validation: has @, has ., reasonable length
          if (normalized && normalized.includes('@') && normalized.includes('.') && normalized.length > 5) {
            const parts = normalized.split('@');
            if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0 && parts[1].includes('.')) {
              return normalized;
            }
          }
          
          return null;
        })
        .filter(Boolean)
        .filter((email, index, array) => array.indexOf(email) === index); // Remove duplicates
      
      // Log if emails were filtered out
      if (recipients[key].length === 0 && originalCount > 0) {
        console.warn(`[MailTracker AI] All ${originalCount} emails in ${key} were filtered out during validation`);
      } else if (recipients[key].length < originalCount) {
        console.log(`[MailTracker AI] Filtered ${originalCount - recipients[key].length} invalid emails from ${key}`);
      }
      
      // Delete if empty after filtering
      if (recipients[key].length === 0) {
        delete recipients[key];
      }
    }
  });

  // Debug logging
  console.log('[MailTracker AI] Extracted recipients (normalized):', recipients);

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
 * Handle click on Gmail send buttons and wire up tracking
 */
const handleSendClick = async event => {
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
  const recipients = extractRecipients(composeRoot);
  const subject = subjectInput ? subjectInput.value : '';

  // Debug: Log what we extracted
  console.log('[MailTracker AI] Extracted recipients:', recipients);
  console.log('[MailTracker AI] Extracted subject:', subject);

  // Register message first to get recipient tokens
  // Use a short timeout to allow registration to complete before send
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
