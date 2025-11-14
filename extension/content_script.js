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
  // More strict regex to avoid splitting valid emails incorrectly
  const extractEmailsFromText = (text) => {
    if (!text || typeof text !== 'string') return [];
    // Improved regex: requires word boundary before @ or start of string, and proper domain structure
    // This prevents matching partial emails like "6@gmail.com" from "jdivyaraj6@gmail.com"
    const emailRegex = /\b([a-zA-Z0-9][a-zA-Z0-9._+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,})\b/g;
    const matches = text.match(emailRegex) || [];
    return matches.map(email => email.toLowerCase().trim()).filter(email => {
      // Additional validation: ensure it's a proper email structure
      const parts = email.split('@');
      if (parts.length !== 2) return false;
      const [local, domain] = parts;
      // Local part should be at least 1 char, domain should have at least one dot and proper TLD
      return local.length >= 1 && 
             domain.includes('.') && 
             domain.split('.').pop().length >= 2 &&
             !domain.startsWith('.') &&
             !domain.endsWith('.');
    });
  };

  // Helper function to validate email - more strict
  const isValidEmail = (email) => {
    if (!email || typeof email !== 'string') return false;
    const normalized = email.trim().toLowerCase();
    
    // Basic format check
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(normalized)) {
      return false;
    }
    
    // Split and validate parts
    const parts = normalized.split('@');
    if (parts.length !== 2) return false;
    
    const [local, domain] = parts;
    
    // Local part validation
    if (local.length < 1 || local.length > 64) return false;
    if (local.startsWith('.') || local.endsWith('.')) return false;
    if (local.includes('..')) return false; // No consecutive dots
    
    // Domain validation
    if (domain.length < 4 || domain.length > 255) return false; // min: a.co, max: 255
    if (domain.startsWith('.') || domain.endsWith('.')) return false;
    if (domain.includes('..')) return false; // No consecutive dots
    
    // Domain must have at least one dot and valid TLD
    const domainParts = domain.split('.');
    if (domainParts.length < 2) return false;
    const tld = domainParts[domainParts.length - 1];
    if (tld.length < 2) return false; // TLD must be at least 2 chars
    
    // Reject obviously invalid emails (like single digit before @)
    if (/^[0-9]+@/.test(normalized)) return false; // Reject "6@gmail.com" type patterns
    
    return true;
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
      'cc': ['Cc', 'CC', 'cc', 'Cc:', 'CC:'],
      'bcc': ['Bcc', 'BCC', 'bcc', 'Bcc:', 'BCC:']
    };
    const labels = fieldLabels[fieldName.toLowerCase()] || [fieldName];

    // Find all possible containers for this field
    const containers = [];
    
    // Method 3a: Find by aria-label containing field name (case-insensitive)
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
    // For TO, use simpler logic that was working before
    // For CC, use more aggressive matching
    const allDivs = composeRoot.querySelectorAll('div, span');
    allDivs.forEach(el => {
      const text = el.textContent?.trim() || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      
      labels.forEach(label => {
        const labelLower = label.toLowerCase();
        const textLower = text.toLowerCase();
        const ariaLower = ariaLabel.toLowerCase();
        const titleLower = title.toLowerCase();
        
        let matchesLabel = false;
        
        // For TO field, use simpler matching (what was working before)
        if (fieldName.toLowerCase() === 'to') {
          matchesLabel = textLower === labelLower || 
                        textLower === 'to' ||
                        textLower === 'recipients' ||
                        ariaLower.includes('to') ||
                        ariaLower.includes('recipients');
        }
        // For CC, use more aggressive matching
        else if (fieldName.toLowerCase() === 'cc') {
          matchesLabel = textLower === labelLower || 
                        textLower === 'cc' ||
                        textLower === 'cc:' ||
                        textLower.startsWith('cc ') ||
                        textLower.startsWith('cc:') ||
                        ariaLower.includes('cc') ||
                        titleLower.includes('cc');
        }
        // For BCC
        else {
          matchesLabel = textLower === labelLower || 
                        ariaLower.includes(labelLower) ||
                        titleLower.includes(labelLower);
        }
        
        if (matchesLabel) {
          // Find the container that holds the recipient chips
          let container = el.closest('div[role="textbox"], div[contenteditable="true"]');
          
          // If not found, look for sibling containers (especially for CC)
          if (!container && fieldName.toLowerCase() === 'cc') {
            let sibling = el.nextElementSibling;
            let attempts = 0;
            while (sibling && attempts < 5) {
              if (sibling.matches('div[role="textbox"], div[contenteditable="true"]')) {
                container = sibling;
                break;
              }
              sibling = sibling.nextElementSibling;
              attempts++;
            }
          }
          
          // Last resort: use parent element
          if (!container) {
            container = el.parentElement;
          }
          
          if (container && !containers.includes(container)) {
            containers.push(container);
          }
        }
      });
    });

    // Extract from all found containers
    // CRITICAL: Only extract from chip elements, NOT from container text (to avoid malformed emails)
    containers.forEach(container => {
      // Priority 1: Extract from chip elements with data attributes (most reliable)
      const chipSelectors = [
        '[data-email]',
        '[email]',
        '[data-value]',
        '[data-address]',
        'span[data-email]',
        'div[data-email]',
        'span[email]',
        'div[email]'
      ];

      chipSelectors.forEach(selector => {
        try {
          const chips = container.querySelectorAll(selector);
          chips.forEach(chip => {
            // Priority: data attributes are most reliable
            const emailAttrs = [
              chip.getAttribute('data-email'),
              chip.getAttribute('email'),
              chip.getAttribute('data-value'),
              chip.getAttribute('data-address'),
              chip.getAttribute('data-address-value')
            ].filter(Boolean);

            emailAttrs.forEach(attr => {
              // Only extract if it's a clean email (not mixed with other text)
              const extracted = extractEmailFromFormat(attr) || attr.toLowerCase().trim();
              // Only accept if it's a valid email AND doesn't contain extra text
              if (isValidEmail(extracted) && extracted === attr.toLowerCase().trim()) {
                emails.add(extracted);
              }
            });

            // Only extract from aria-label if it looks like a clean email
            const ariaLabel = chip.getAttribute('aria-label');
            if (ariaLabel) {
              const extracted = extractEmailFromFormat(ariaLabel) || ariaLabel.toLowerCase().trim();
              if (isValidEmail(extracted) && extracted === ariaLabel.toLowerCase().trim()) {
                emails.add(extracted);
              }
            }
          });
        } catch (e) {
          // Ignore selector errors
        }
      });

      // Priority 2: Extract from chip-like elements (role="option", etc.)
      // But ONLY if they contain a single, clean email
      const chipLikeSelectors = [
        '[role="option"]',
        '[role="listbox"] > *',
        '.chip',
        '[class*="chip"]',
        '[class*="Chip"]',
        '[class*="token"]',
        '[class*="Token"]'
      ];

      chipLikeSelectors.forEach(selector => {
        try {
          const chips = container.querySelectorAll(selector);
          chips.forEach(chip => {
            // First check data attributes
            const dataEmail = chip.getAttribute('data-email') || chip.getAttribute('email');
            if (dataEmail && isValidEmail(dataEmail.toLowerCase().trim())) {
              emails.add(dataEmail.toLowerCase().trim());
              return; // Skip text extraction if we found data attribute
            }

            // Only extract from text if it's a single, clean email (not mixed text)
            const text = (chip.textContent || chip.innerText || '').trim();
            // Check if text is ONLY an email (no extra text before/after)
            if (text && isValidEmail(text.toLowerCase()) && text === text.trim()) {
              // Additional check: text should match email pattern exactly
              const emailMatch = text.match(/^[a-zA-Z0-9][a-zA-Z0-9._+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/i);
              if (emailMatch && emailMatch[0] === text) {
                emails.add(text.toLowerCase());
              }
            }
          });
        } catch (e) {
          // Ignore selector errors
        }
      });

      // DO NOT extract from container's text content or innerHTML
      // This causes malformed emails like "gmail.comjdivyaraj6@gmail.com"
      // Only extract from individual chip elements above
    });

    return Array.from(emails);
  };

  // Extract from chips for each field
  // Always try extraction - don't skip if field already has emails (might find more)
  ['to', 'cc', 'bcc'].forEach(field => {
    const chipEmails = extractFromChips(field);
    if (chipEmails.length) {
      // Only add emails that aren't already in the list
      chipEmails.forEach(email => {
        if (!allFoundEmails.has(email)) {
          recipients[field].push(email);
          allFoundEmails.add(email);
        }
      });
      if (chipEmails.length > 0) {
        console.log(`[MailTracker AI] Extracted ${chipEmails.length} ${field} recipient(s) from chips:`, chipEmails);
      }
    }
  });

  // Special method for CC: Search more aggressively since CC might be in different locations
  if (recipients.cc.length === 0) {
    console.log('[MailTracker AI] CC not found yet, trying special CC extraction methods...');
    
    // Method CC-1: Find all elements that contain "cc" in their text or attributes
    const ccElements = Array.from(composeRoot.querySelectorAll('*')).filter(el => {
      const text = (el.textContent || '').toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      const className = String(el.className || '').toLowerCase();
      
      return (text === 'cc' || text === 'cc:' || 
              text.startsWith('cc ') || text.startsWith('cc:') ||
              ariaLabel.includes('cc') ||
              title.includes('cc') ||
              className.includes('cc')) &&
             !text.includes('bcc') && // Exclude BCC
             !ariaLabel.includes('bcc');
    });

    console.log(`[MailTracker AI] Found ${ccElements.length} potential CC label elements`);

    ccElements.forEach(ccLabel => {
      // Find the associated input/container for this CC label
      let ccContainer = null;
      
      // Try to find a sibling textbox
      let current = ccLabel.nextElementSibling;
      let attempts = 0;
      while (current && attempts < 5) {
        if (current.matches('div[role="textbox"], div[contenteditable="true"], div[aria-label*="cc" i]')) {
          ccContainer = current;
          break;
        }
        current = current.nextElementSibling;
        attempts++;
      }
      
      // If not found, try parent's next sibling
      if (!ccContainer && ccLabel.parentElement) {
        const parent = ccLabel.parentElement;
        const parentNext = parent.nextElementSibling;
        if (parentNext && parentNext.matches('div[role="textbox"], div[contenteditable="true"]')) {
          ccContainer = parentNext;
        }
      }
      
      // If still not found, search within parent
      if (!ccContainer) {
        ccContainer = ccLabel.closest('div[role="textbox"], div[contenteditable="true"]') ||
                     ccLabel.parentElement?.querySelector('div[role="textbox"], div[contenteditable="true"]');
      }
      
      if (ccContainer) {
        console.log('[MailTracker AI] Found CC container:', ccContainer);
        
        // ONLY extract from chip elements with data attributes, NOT from raw text
        const ccEmails = new Set();
        
        // Priority: data attributes from chips
        const chips = ccContainer.querySelectorAll('[data-email], [email], [data-value], [data-address]');
        chips.forEach(chip => {
          const dataEmail = chip.getAttribute('data-email') || 
                           chip.getAttribute('email') || 
                           chip.getAttribute('data-value') || 
                           chip.getAttribute('data-address');
          if (dataEmail && isValidEmail(dataEmail.toLowerCase().trim())) {
            ccEmails.add(dataEmail.toLowerCase().trim());
          }
        });
        
        // Add unique CC emails
        Array.from(ccEmails).forEach(email => {
          if (!allFoundEmails.has(email)) {
            recipients.cc.push(email);
            allFoundEmails.add(email);
          }
        });
        
        if (ccEmails.size > 0) {
          console.log(`[MailTracker AI] Extracted ${ccEmails.size} CC recipient(s) from special method:`, Array.from(ccEmails));
        }
      }
    });
  }

  // Method 4: Extract from all contenteditable/role="textbox" elements with field-specific aria-labels
  // CRITICAL: Only extract from chip elements within these containers, NOT from raw text
  ['to', 'cc', 'bcc'].forEach(field => {
    // For CC, use more aggressive selectors
    const selectors = field.toLowerCase() === 'cc' ? [
      `div[aria-label*="${field}" i][role="textbox"]`,
      `div[aria-label*="${field}" i][contenteditable="true"]`,
      `div[contenteditable="true"][aria-label*="${field}" i]`,
      `div[aria-label*="Cc" i][role="textbox"]`,
      `div[aria-label*="Cc" i][contenteditable="true"]`,
      `div[aria-label*="CC" i][role="textbox"]`,
      `div[aria-label*="CC" i][contenteditable="true"]`,
      // Also try finding by position (CC is usually after TO)
      `div[role="textbox"]:nth-of-type(2)`,
      `div[contenteditable="true"]:nth-of-type(2)`
    ] : [
      `div[aria-label*="${field}" i][role="textbox"],
       div[aria-label*="${field}" i][contenteditable="true"],
       div[contenteditable="true"][aria-label*="${field}" i]`
    ];
    
    const fieldInputs = composeRoot.querySelectorAll(selectors.join(', '));
    
    const fieldEmails = new Set();
    fieldInputs.forEach((input, index) => {
      const ariaLabel = input.getAttribute('aria-label') || '';
      
      // For CC, verify this is actually a CC field (not TO or BCC)
      if (field.toLowerCase() === 'cc') {
        const ariaLower = ariaLabel.toLowerCase();
        // Skip if this is clearly TO or BCC
        if (ariaLower.includes('to') && !ariaLower.includes('cc') && !ariaLower.includes('bcc')) {
          return; // This is TO, skip
        }
        if (ariaLower.includes('bcc') && !ariaLower.includes('cc')) {
          return; // This is BCC, skip
        }
      }
      
      // ONLY extract from chip elements with data attributes, NOT from raw text
      const chips = input.querySelectorAll('[data-email], [email], [data-value], [data-address]');
      chips.forEach(chip => {
        const dataEmail = chip.getAttribute('data-email') || 
                         chip.getAttribute('email') || 
                         chip.getAttribute('data-value') || 
                         chip.getAttribute('data-address');
        if (dataEmail && isValidEmail(dataEmail.toLowerCase().trim())) {
          const normalized = dataEmail.toLowerCase().trim();
          if (!allFoundEmails.has(normalized)) {
            fieldEmails.add(normalized);
          }
        }
      });
    });
    
    if (fieldEmails.size > 0) {
      fieldEmails.forEach(e => {
        recipients[field].push(e);
        allFoundEmails.add(e);
      });
      console.log(`[MailTracker AI] Method 4: Extracted ${fieldEmails.size} ${field} recipient(s)`);
    }
  });

  // Method 5: Extract from compose header - ONLY from chip elements, NOT from raw text
  // Only use as last resort for CC if still missing
  if (recipients.cc.length === 0) {
    console.log('[MailTracker AI] Method 5: Trying to find CC in compose header (chips only)...');
    const composeHeader = composeRoot.querySelector('[role="dialog"] > div, .aHl, [class*="compose"]');
    if (composeHeader) {
      // Find CC-related sections
      const ccSections = Array.from(composeHeader.querySelectorAll('div, tr, td')).filter(section => {
        const sectionText = (section.textContent || '').toLowerCase();
        const sectionAria = (section.getAttribute('aria-label') || '').toLowerCase();
        return (sectionText.includes('cc') || sectionAria.includes('cc')) && 
               !sectionText.includes('bcc') && !sectionAria.includes('bcc');
      });
      
      // ONLY extract from chip data attributes in these sections
      ccSections.forEach(section => {
        const chips = section.querySelectorAll('[data-email], [email], [data-value], [data-address]');
        chips.forEach(chip => {
          const dataEmail = chip.getAttribute('data-email') || 
                           chip.getAttribute('email') || 
                           chip.getAttribute('data-value') || 
                           chip.getAttribute('data-address');
          if (dataEmail && isValidEmail(dataEmail.toLowerCase().trim())) {
            const normalized = dataEmail.toLowerCase().trim();
            if (!allFoundEmails.has(normalized)) {
              recipients.cc.push(normalized);
              allFoundEmails.add(normalized);
              console.log(`[MailTracker AI] Method 5: Found CC email in chip: ${normalized}`);
            }
          }
        });
      });
    }
  }

  // Method 6: REMOVED - was causing malformed emails by extracting from raw text
  // We now only extract from chip data attributes which is more reliable

  /**
   * Split concatenated emails by detecting boundaries
   * Only split if we're confident emails are actually concatenated
   * Example: "email1@example.comemail2@example.com" -> ["email1@example.com", "email2@example.com"]
   */
  const splitConcatenatedEmails = (text) => {
    if (!text || typeof text !== 'string') return [];
    
    // First, try to find all valid emails using strict regex
    const emailRegex = /\b([a-zA-Z0-9][a-zA-Z0-9._+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,})\b/g;
    const foundEmails = [];
    let match;
    
    while ((match = emailRegex.exec(text)) !== null) {
      const email = match[0].toLowerCase().trim();
      // Validate each found email
      if (isValidEmail(email)) {
        foundEmails.push(email);
      }
    }
    
    // If we found valid emails, return them (don't try to split further)
    if (foundEmails.length > 0) {
      return foundEmails;
    }
    
    // Only try complex splitting if no emails were found and text looks like it might contain concatenated emails
    // This is a last resort - be very conservative
    if (text.includes('@') && (text.match(/@/g) || []).length > 1) {
      // Multiple @ signs might indicate concatenated emails
      // Try splitting on common TLD boundaries followed by lowercase letter (start of next email)
      const splitPattern = /(\.(com|net|org|edu|gov|mil|co|io|ai|uk|ca|au|de|fr|jp|in|cn|br|ru|es|it|nl|se|no|dk|fi|pl|cz|gr|pt|ie|be|at|ch|nz|za|mx|ar|cl|co|pe|ve|ec|uy|py|bo|cr|pa|do|gt|hn|ni|sv|bz|jm|tt|bb|gd|lc|vc|ag|dm|kn|mu|sc|tz|ke|ug|et|gh|ng|sn|ci|cm|ga|cg|cd|ao|mz|zw|bw|na|sz|ls|mg|rw|bi|td|ne|ml|bf|mr|gm|gw|gn|sl|lr|tg|bj|dj|km|so|er|sd|ly|tn|dz|ma|eh|ss|ye|iq|sy|jo|lb|ps|il|sa|ae|om|qa|bh|kw|ir|af|pk|bd|lk|mv|np|bt|mm|th|la|kh|vn|ph|my|sg|bn|id|tl|pg|fj|nc|pf|ws|to|vu|sb|ki|nr|pw|fm|mh|as|gu|mp|vi|pr|do|ht|cu|jm|bs|ky|tc|vg|ai|ms|bl|mf|pm|wf|tf|re|yt|mo|hk|tw|kr|jp|cn|mn|kz|uz|tj|kg|tm|az|ge|am|by|ua|md|ro|bg|rs|me|ba|hr|si|sk|hu|ee|lv|lt|is|fo|gl|ax|sj|sx|bq|cw|aw))(?=[a-z])/gi;
      const parts = text.split(splitPattern);
      const potentialEmails = [];
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part && isValidEmail(part)) {
          potentialEmails.push(part.toLowerCase());
        }
      }
      
      if (potentialEmails.length > 0) {
        return potentialEmails;
      }
    }
    
    // Last resort: if text itself is a valid email, return it
    if (isValidEmail(text)) {
      return [text.toLowerCase().trim()];
    }
    
    return [];
  };

  // Clean up, normalize, and deduplicate emails
  Object.keys(recipients).forEach(key => {
    if (!recipients[key] || !Array.isArray(recipients[key]) || !recipients[key].length) {
      delete recipients[key];
    } else {
      // Normalize and validate all emails - be strict
      const normalizedEmails = new Set();
      
      recipients[key].forEach(email => {
        if (!email || typeof email !== 'string') return;
        
        // Extract email from "Name <email>" format if present
        const cleanEmail = extractEmailFromFormat(email) || email.trim().toLowerCase();
        
        // First, try to extract all valid emails from the text (handles concatenated emails)
        const extractedEmails = extractEmailsFromText(cleanEmail);
        
        if (extractedEmails.length > 0) {
          // We found emails using regex - use those
          extractedEmails.forEach(e => {
            const normalized = e.trim().toLowerCase();
            if (isValidEmail(normalized)) {
              normalizedEmails.add(normalized);
            }
          });
        } else {
          // No emails found via regex, try splitConcatenatedEmails as fallback
          const splitEmails = splitConcatenatedEmails(cleanEmail);
          if (splitEmails.length > 0) {
            splitEmails.forEach(e => {
              const normalized = e.trim().toLowerCase();
              if (isValidEmail(normalized)) {
                normalizedEmails.add(normalized);
              }
            });
          } else {
            // Last resort: check if the whole string is a valid email
            const normalized = cleanEmail.trim().toLowerCase();
            if (isValidEmail(normalized)) {
              normalizedEmails.add(normalized);
            }
          }
        }
      });
      
      // Convert Set back to array and sort for consistency
      recipients[key] = Array.from(normalizedEmails).sort();
      
      // Final filter: Remove any suspicious/malformed emails
      recipients[key] = recipients[key].filter(email => {
        // Reject emails that contain multiple domain parts (like "gmail.comjdivyaraj6@gmail.com")
        if (email.split('@').length !== 2) return false;
        
        const [local, domain] = email.split('@');
        
        // Reject if domain contains "com" multiple times in suspicious ways
        const comCount = (domain.match(/\.com/g) || []).length;
        if (comCount > 1) return false;
        
        // Reject if email contains domain parts that shouldn't be there
        // (like "gmail.com" appearing before the @)
        if (local.includes('.com') || local.includes('.net') || local.includes('.org')) return false;
        
        // Reject if email looks like concatenated text (contains common domain parts in wrong places)
        if (email.includes('gmail.com') && email.indexOf('gmail.com') < email.indexOf('@')) return false;
        
        // Reject if domain has suspicious patterns (like "com" followed by more text)
        if (domain.match(/\.com[a-z]/i)) return false;
        
        return true;
      });
      
      // Delete if empty after filtering
      if (recipients[key].length === 0) {
        delete recipients[key];
      } else {
        console.log(`[MailTracker AI] Extracted ${recipients[key].length} ${key} recipient(s):`, recipients[key]);
      }
    }
  });

  // Final validation: Remove BCC if it seems like false positives
  // BCC field is often hidden, so if we found BCC but no clear BCC field indicators, be suspicious
  if (recipients.bcc && recipients.bcc.length > 0) {
    // Check if BCC field is actually visible/used in the compose dialog
    const bccFieldVisible = composeRoot.querySelector('div[aria-label*="bcc" i][role="textbox"], div[aria-label*="Bcc" i][role="textbox"], div[aria-label*="BCC" i][role="textbox"]') ||
                           composeRoot.querySelector('div[aria-label*="bcc" i][contenteditable="true"], div[aria-label*="Bcc" i][contenteditable="true"], div[aria-label*="BCC" i][contenteditable="true"]') ||
                           Array.from(composeRoot.querySelectorAll('*')).some(el => {
                             const text = (el.textContent || '').toLowerCase().trim();
                             const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                             return (text === 'bcc' || text === 'bcc:') && 
                                    (ariaLabel.includes('bcc') || ariaLabel.includes('blind'));
                           });
    
    // If BCC field not clearly visible, remove BCC recipients
    // Also check if BCC emails look suspicious (malformed)
    const hasMalformedBCC = recipients.bcc.some(email => {
      // Check for suspicious patterns like emails containing other domain parts
      return email.includes('gmail.com') && email.split('@').length > 2 ||
             email.includes('com') && email.split('com').length > 2;
    });
    
    if (!bccFieldVisible || hasMalformedBCC) {
      console.log('[MailTracker AI] BCC field not clearly visible or contains malformed emails, removing BCC recipients');
      delete recipients.bcc;
    }
  }

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
