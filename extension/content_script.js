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
 * Comprehensive extraction using multiple methods to capture all recipients
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

  // Method 1: Extract from textarea elements (older Gmail)
  ['to', 'cc', 'bcc'].forEach(field => {
    const textarea = composeRoot.querySelector(`textarea[name="${field}"]`);
    if (textarea && textarea.value) {
      const emails = textarea.value
        .split(/[,;]/)
        .map(item => extractEmailFromFormat(item.trim()) || item.trim().toLowerCase())
        .filter(isValidEmail);
      if (emails.length) {
        recipients[field].push(...emails);
        emails.forEach(e => allFoundEmails.add(e));
      }
    }
  });

  // Method 2: Extract from input fields
  ['to', 'cc', 'bcc'].forEach(field => {
    const inputs = composeRoot.querySelectorAll(
      `input[aria-label*="${field}" i],
       input[name="${field}"],
       input[placeholder*="${field}" i]`
    );
    inputs.forEach(input => {
      if (input.value) {
        const emails = input.value
          .split(/[,;]/)
          .map(item => extractEmailFromFormat(item.trim()) || item.trim().toLowerCase())
          .filter(isValidEmail);
        if (emails.length) {
          recipients[field].push(...emails);
          emails.forEach(e => allFoundEmails.add(e));
        }
      }
    });
  });

  // Method 3: Comprehensive chip extraction for each field
  const extractFromChips = (fieldName) => {
    const emails = new Set();
    const fieldLabels = {
      'to': ['To', 'Recipients', 'to'],
      'cc': ['Cc', 'CC', 'cc'],
      'bcc': ['Bcc', 'BCC', 'bcc']
    };
    const labels = fieldLabels[fieldName.toLowerCase()] || [fieldName];

    // Find all possible containers for this field
    const containers = [];
    
    // Method 3a: Find by aria-label containing field name
    labels.forEach(label => {
      const containersByAria = composeRoot.querySelectorAll(
        `div[aria-label*="${label}" i],
         div[aria-label*="${label}" i][role="textbox"],
         div[aria-label*="${label}" i][contenteditable="true"],
         div[data-field="${fieldName}"],
         div[data-field="${fieldName.toLowerCase()}"]`
      );
      containers.push(...Array.from(containersByAria));
    });

    // Method 3b: Find by text content matching label
    const allDivs = composeRoot.querySelectorAll('div');
    allDivs.forEach(div => {
      const text = div.textContent?.trim() || '';
      const ariaLabel = div.getAttribute('aria-label') || '';
      labels.forEach(label => {
        if ((text === label || ariaLabel.toLowerCase().includes(label.toLowerCase())) &&
            (ariaLabel.toLowerCase().includes('to') || 
             ariaLabel.toLowerCase().includes('cc') || 
             ariaLabel.toLowerCase().includes('bcc'))) {
          const container = div.closest('div[role="textbox"], div[contenteditable="true"]') || 
                           div.parentElement;
          if (container && !containers.includes(container)) {
            containers.push(container);
          }
        }
      });
    });

    // Extract from all found containers
    containers.forEach(container => {
      // Extract from chip elements with various selectors
      const chipSelectors = [
        '[data-email]',
        '[email]',
        '[data-value]',
        '[data-address]',
        'span[data-email]',
        'div[data-email]',
        'span[email]',
        'div[email]',
        '[role="option"]',
        '[role="listbox"] > *',
        '.chip',
        '[class*="chip"]',
        '[class*="Chip"]',
        '[class*="token"]',
        '[class*="Token"]'
      ];

      chipSelectors.forEach(selector => {
        try {
          const chips = container.querySelectorAll(selector);
          chips.forEach(chip => {
            // Try all possible data attributes
            const emailAttrs = [
              chip.getAttribute('data-email'),
              chip.getAttribute('email'),
              chip.getAttribute('data-value'),
              chip.getAttribute('data-address'),
              chip.getAttribute('data-address-value'),
              chip.getAttribute('aria-label')
            ].filter(Boolean);

            emailAttrs.forEach(attr => {
              const extracted = extractEmailFromFormat(attr) || attr.toLowerCase().trim();
              if (isValidEmail(extracted)) {
                emails.add(extracted);
              }
            });

            // Extract from text content
            const text = chip.textContent || chip.innerText || '';
            const textEmails = extractEmailsFromText(text);
            textEmails.forEach(e => {
              if (isValidEmail(e)) emails.add(e);
            });

            // Extract from all attributes
            Array.from(chip.attributes).forEach(attr => {
              if (attr.value && attr.value.includes('@')) {
                const attrEmails = extractEmailsFromText(attr.value);
                attrEmails.forEach(e => {
                  if (isValidEmail(e)) emails.add(e);
                });
              }
            });
          });
        } catch (e) {
          // Ignore selector errors
        }
      });

      // Extract from container's own text content
      const containerText = container.textContent || container.innerText || '';
      const containerEmails = extractEmailsFromText(containerText);
      containerEmails.forEach(e => {
        if (isValidEmail(e)) emails.add(e);
      });

      // Extract from container's innerHTML
      const containerHtml = container.innerHTML || '';
      const htmlEmails = extractEmailsFromText(containerHtml);
      htmlEmails.forEach(e => {
        if (isValidEmail(e)) emails.add(e);
      });
    });

    return Array.from(emails);
  };

  // Extract from chips for each field (only if not already found)
  ['to', 'cc', 'bcc'].forEach(field => {
    if (recipients[field].length === 0) {
      const chipEmails = extractFromChips(field);
      if (chipEmails.length) {
        recipients[field].push(...chipEmails);
        chipEmails.forEach(e => allFoundEmails.add(e));
      }
    }
  });

  // Method 4: Extract from all contenteditable/role="textbox" elements with field-specific aria-labels
  ['to', 'cc', 'bcc'].forEach(field => {
    if (recipients[field].length === 0) {
      const fieldInputs = composeRoot.querySelectorAll(
        `div[aria-label*="${field}" i][role="textbox"],
         div[aria-label*="${field}" i][contenteditable="true"],
         div[contenteditable="true"][aria-label*="${field}" i]`
      );
      
      const fieldEmails = new Set();
      fieldInputs.forEach(input => {
        // Get all text from this input
        const text = input.textContent || input.innerText || input.value || '';
        const html = input.innerHTML || '';
        
        // Extract emails from text
        extractEmailsFromText(text).forEach(e => {
          if (isValidEmail(e)) fieldEmails.add(e);
        });
        extractEmailsFromText(html).forEach(e => {
          if (isValidEmail(e)) fieldEmails.add(e);
        });

        // Get all child elements and extract from them
        const allChildren = input.querySelectorAll('*');
        allChildren.forEach(child => {
          const childText = child.textContent || child.innerText || '';
          const childHtml = child.innerHTML || '';
          extractEmailsFromText(childText).forEach(e => {
            if (isValidEmail(e)) fieldEmails.add(e);
          });
          extractEmailsFromText(childHtml).forEach(e => {
            if (isValidEmail(e)) fieldEmails.add(e);
          });
        });
      });
      
      if (fieldEmails.size > 0) {
        recipients[field].push(...Array.from(fieldEmails));
        fieldEmails.forEach(e => allFoundEmails.add(e));
      }
    }
  });

  // Method 5: Extract from entire compose header as fallback
  if (recipients.to.length === 0 && recipients.cc.length === 0 && recipients.bcc.length === 0) {
    const composeHeader = composeRoot.querySelector('[role="dialog"] > div, .aHl, [class*="compose"]');
    if (composeHeader) {
      const allText = composeHeader.textContent || composeHeader.innerText || '';
      const allHtml = composeHeader.innerHTML || '';
      const foundEmails = [
        ...extractEmailsFromText(allText),
        ...extractEmailsFromText(allHtml)
      ].filter(isValidEmail);
      
      if (foundEmails.length) {
        recipients.to.push(...foundEmails);
        foundEmails.forEach(e => allFoundEmails.add(e));
      }
    }
  }

  // Method 6: Comprehensive deep search - extract from ALL elements in compose dialog
  // This catches any emails that might be in hidden elements or unusual structures
  ['to', 'cc', 'bcc'].forEach(field => {
    // Only do deep search if we haven't found recipients for this field
    if (recipients[field].length === 0) {
      // Find the field label/header first
      const fieldLabels = {
        'to': ['To', 'Recipients'],
        'cc': ['Cc', 'CC'],
        'bcc': ['Bcc', 'BCC']
      };
      const labels = fieldLabels[field.toLowerCase()] || [];
      
      // Find all elements that might be related to this field
      labels.forEach(label => {
        // Find elements containing the label
        const labelElements = Array.from(composeRoot.querySelectorAll('*')).filter(el => {
          const text = el.textContent?.trim() || '';
          const ariaLabel = el.getAttribute('aria-label') || '';
          return (text === label || ariaLabel.toLowerCase().includes(label.toLowerCase())) &&
                 (ariaLabel.toLowerCase().includes(field.toLowerCase()));
        });

        labelElements.forEach(labelEl => {
          // Get the parent container
          const container = labelEl.closest('div[role="textbox"], div[contenteditable="true"], div') || 
                           labelEl.parentElement;
          
          if (container) {
            // Search all descendants for emails
            const allElements = container.querySelectorAll('*');
            allElements.forEach(el => {
              // Check text content
              const text = el.textContent || el.innerText || '';
              const emails = extractEmailsFromText(text);
              emails.forEach(e => {
                if (isValidEmail(e) && !allFoundEmails.has(e)) {
                  recipients[field].push(e);
                  allFoundEmails.add(e);
                }
              });

              // Check all attributes
              Array.from(el.attributes).forEach(attr => {
                if (attr.value && attr.value.includes('@')) {
                  const attrEmails = extractEmailsFromText(attr.value);
                  attrEmails.forEach(e => {
                    if (isValidEmail(e) && !allFoundEmails.has(e)) {
                      recipients[field].push(e);
                      allFoundEmails.add(e);
                    }
                  });
                }
              });
            });
          }
        });
      });
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
        const splitEmails = splitConcatenatedEmails(cleanEmail);
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
