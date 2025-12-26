// MailTracker AI Content Script
// Injected into Gmail to append tracking pixels, rewrite links, and notify backend

const MAILTRACKER_BACKEND_BASE = 'https://mailtracker-ai.onrender.com';
let trackingEnabled = true; // default, will sync with storage
let userId = 'default';

/**
 * Generate RFC4122 version 4 UUID using crypto.getRandomValues
 */
const generateUUID = () => {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (
    c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4
  ).toString(16));
};

/**
 * Fetch current tracking preferences from storage and keep them in sync
 */
const generateToken = () => {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
};

const initStorageSync = () => {
  chrome.storage.sync.get({ trackingEnabled: true, userId: 'default' }, ({ trackingEnabled: storedTracking, userId: storedUserId }) => {
    trackingEnabled = storedTracking;
    userId = storedUserId || 'default';
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.trackingEnabled) {
      trackingEnabled = changes.trackingEnabled.newValue;
      // Update all visible toggles
      document.querySelectorAll('.mt-ai-toggle-input').forEach(input => {
        input.checked = trackingEnabled;
      });
    }
    if (changes.userId) {
      userId = changes.userId.newValue || 'default';
    }
  });
};

/**
 * Inject the tracking toggle into the Gmail Compose toolbar
 */
const injectComposeUI = (composeRoot) => {
  if (!composeRoot) return;

  // Find the toolbar area (usually where the "A" formatting and attachment icons are)
  const toolbar = composeRoot.querySelector('.btC'); // Gmail's bottom toolbar container
  if (!toolbar || toolbar.querySelector('.mt-ai-toolbar-integrated')) return;

  const integrationWrapper = document.createElement('div');
  integrationWrapper.className = 'mt-ai-toolbar-integrated';
  integrationWrapper.style.cssText = 'display: inline-flex; align-items: center; margin-left: 12px; padding-left: 12px; border-left: 1px solid #dadce0; height: 36px;';

  const toggleLabel = document.createElement('label');
  toggleLabel.style.cssText = 'display: flex; align-items: center; cursor: pointer; user-select: none; gap: 8px;';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'mt-ai-toggle-input';
  checkbox.checked = trackingEnabled;
  checkbox.style.cssText = 'cursor: pointer; width: 14px; height: 14px; margin: 0;';

  checkbox.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.sync.set({ trackingEnabled: isEnabled });
  });

  const span = document.createElement('span');
  span.textContent = 'Track Email';
  span.style.cssText = 'font-size: 13px; color: #5f6368; font-weight: 500;';

  toggleLabel.appendChild(checkbox);
  toggleLabel.appendChild(span);
  integrationWrapper.appendChild(toggleLabel);

  // Insert before the formatting options or attachments
  const firstChild = toolbar.firstChild;
  if (firstChild) {
    toolbar.insertBefore(integrationWrapper, firstChild);
  } else {
    toolbar.appendChild(integrationWrapper);
  }
};

/**
 * Universal Gmail Recipient Extractor v4.0
 * Aggressive multi-strategy approach that works with all Gmail variations
 * Extracts from multiple sources simultaneously for maximum reliability
 */
class GmailRecipientExtractor {
  constructor() {
    // RFC 5322 compliant email regex
    this.emailRegex = /^[a-zA-Z0-9][a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    // Aggressive email finder regex (finds emails in any text)
    this.emailFinderRegex = /\b[a-zA-Z0-9][a-zA-Z0-9._+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}\b/g;
  }

  /**
   * Validate email address using RFC 5322 simplified rules
   */
  isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const normalized = email.trim().toLowerCase();

    // Length check
    if (normalized.length < 3 || normalized.length > 254) return false;

    // Basic format check
    if (!this.emailRegex.test(normalized)) return false;

    // Split and validate parts
    const [local, domain] = normalized.split('@');

    // Local part validation (before @)
    if (!local || local.length < 1 || local.length > 64) return false;
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;

    // Domain validation (after @)
    if (!domain || domain.length < 3 || domain.length > 255) return false;
    if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;

    // Must have at least one dot in domain
    if (!domain.includes('.')) return false;

    // TLD must be at least 2 characters
    const tld = domain.split('.').pop();
    if (!tld || tld.length < 2) return false;

    return true;
  }

  /**
   * Extract email from "Name <email@domain.com>" format
   */
  extractEmailFromText(text) {
    if (!text) return null;

    // Handle "Name <email>" format
    const bracketMatch = text.match(/<([^>]+)>/);
    if (bracketMatch && bracketMatch[1]) {
      const email = bracketMatch[1].trim().toLowerCase();
      return this.isValidEmail(email) ? email : null;
    }

    // Handle plain email
    const plainEmail = text.trim().toLowerCase();
    return this.isValidEmail(plainEmail) ? plainEmail : null;
  }

  /**
   * Strategy 1: Extract from Gmail's email chips (most reliable)
   * Gmail stores recipient info in special chip elements with data attributes
   */
  extractFromChips(container) {
    const emails = new Set();

    if (!container) {
      console.log('[MailTracker AI] No container provided for chip extraction');
      return [];
    }

    // Gmail chip selectors (priority order - most specific first)
    const chipSelectors = [
      '[data-hovercard-id*="@"]',        // Primary: Gmail's hovercard system (contains email)
      'span[email]',                      // Email attribute
      'span[data-email]',                 // Data-email attribute
      'div[email]',                       // Div with email attribute
      'div[data-email]',                  // Div with data-email
      '[data-hovercard-id]',             // Generic hovercard (need to extract email)
      'span[role="option"]',              // Role-based selection
      'div[role="option"]',               // Div role option
      'span.vR',                          // Gmail chip class (older versions)
      '[class*="chip"]',                  // Any element with "chip" in class
      '[class*="Chip"]',                  // Any element with "Chip" in class
      'div[data-hovercard-id]'           // Div-based chips
    ];

    console.log(`[MailTracker AI] Extracting chips from container...`);

    for (const selector of chipSelectors) {
      try {
        const chips = container.querySelectorAll(selector);
        console.log(`[MailTracker AI] Found ${chips.length} elements with selector: ${selector}`);

        if (chips.length === 0) continue;

        chips.forEach((chip, index) => {
          // Try various data attributes (priority order)
          const possibleEmails = [
            chip.getAttribute('data-hovercard-id'),
            chip.getAttribute('email'),
            chip.getAttribute('data-email'),
            chip.getAttribute('data-value'),
            chip.getAttribute('data-address'),
            chip.getAttribute('data-name'),
            chip.title,
            chip.getAttribute('aria-label'),
            chip.getAttribute('data-object-id')
          ].filter(Boolean);

          let foundEmail = false;
          for (const value of possibleEmails) {
            if (value && value.includes('@')) {
              const email = this.extractEmailFromText(value);
              if (email) {
                emails.add(email);
                foundEmail = true;
                console.log(`[MailTracker AI]   Chip ${index + 1}: Found email "${email}" from attribute`);
                break; // Found valid email for this chip, move to next
              }
            }
          }

          // If no email found in attributes, try text content
          if (!foundEmail) {
            const chipText = (chip.textContent || chip.innerText || '').trim();
            if (chipText && chipText.includes('@')) {
              const email = this.extractEmailFromText(chipText);
              if (email) {
                emails.add(email);
                console.log(`[MailTracker AI]   Chip ${index + 1}: Found email "${email}" from text content`);
              }
            }
          }
        });

        // If we found emails with this selector, log and continue (don't break, might find more)
        if (emails.size > 0) {
          console.log(`[MailTracker AI] Found ${emails.size} unique email(s) using selector: ${selector}`);
        }
      } catch (e) {
        console.warn(`[MailTracker AI] Error with selector ${selector}:`, e);
      }
    }

    const result = Array.from(emails);
    console.log(`[MailTracker AI] Total unique emails extracted from chips: ${result.length}`);
    return result;
  }

  /**
   * Strategy 2: Extract from contenteditable/textarea elements
   * Fallback for when chips aren't fully loaded
   */
  extractFromInputs(container) {
    const emails = new Set();

    // Find all input-like elements
    const inputs = container.querySelectorAll('textarea, input[type="text"], input:not([type])');

    inputs.forEach(input => {
      const value = input.value?.trim();
      if (!value) return;

      // Split by common delimiters
      const parts = value.split(/[,;]/);

      parts.forEach(part => {
        const email = this.extractEmailFromText(part.trim());
        if (email) emails.add(email);
      });
    });
    return Array.from(emails);
  }

  /**
   * Strategy 3: Parse from aria-label (Gmail often puts full recipient list here)
   */
  extractFromAriaLabel(container) {
    const emails = new Set();
    const ariaLabel = container.getAttribute('aria-label');

    if (!ariaLabel) return [];

    // Gmail format: "To: john@example.com, jane@example.com"
    // or "Recipients: john@example.com"

    // Remove prefixes
    const cleanLabel = ariaLabel.replace(/^(To|Cc|Bcc|Recipients):\s*/i, '');

    // Split by commas or semicolons
    const parts = cleanLabel.split(/[,;]/);

    parts.forEach(part => {
      const email = this.extractEmailFromText(part.trim());
      if (email) emails.add(email);
    });
    return Array.from(emails);
  }

  /**
   * Find the specific recipient field container (To, Cc, or Bcc)
   */
  findFieldContainer(composeRoot, fieldType) {
    const fieldLower = fieldType.toLowerCase();
    console.log(`[MailTracker AI] Searching for ${fieldType} container...`);

    // Strategy 1: Find by explicit aria-label (most reliable)
    const ariaSelectors = [
      `[aria-label*="${fieldType}" i][role="textbox"]`,
      `[aria-label*="${fieldType}" i][contenteditable="true"]`,
      `[aria-label*="${fieldType}" i][contenteditable]`,
      `textarea[name="${fieldLower}"]`,
      `input[name="${fieldLower}"]`,
      `[aria-label^="${fieldType}" i]`,
      `[data-field="${fieldLower}"]`,
      // Gmail-specific selectors
      `div[aria-label*="${fieldType}" i]`,
      `div[aria-label*="${fieldType}" i] div[role="textbox"]`,
      `div[aria-label*="${fieldType}" i] div[contenteditable="true"]`
    ];

    for (const selector of ariaSelectors) {
      try {
        const element = composeRoot.querySelector(selector);
        if (element) {
          console.log(`[MailTracker AI] ✅ Found ${fieldType} container using: ${selector}`);
          return element;
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }

    // Strategy 2: Find all textboxes and check their aria-labels
    const allTextboxes = composeRoot.querySelectorAll('[role="textbox"], [contenteditable="true"]');
    console.log(`[MailTracker AI] Found ${allTextboxes.length} textbox elements, checking aria-labels...`);

    for (const textbox of allTextboxes) {
      const ariaLabel = (textbox.getAttribute('aria-label') || '').toLowerCase();
      const textContent = (textbox.textContent || '').toLowerCase().trim();

      // Skip message body
      if (ariaLabel.includes('message body') || ariaLabel.includes('compose')) {
        continue;
      }

      // Check if this textbox matches our field
      let matches = false;
      if (fieldLower === 'to') {
        matches = ariaLabel.includes('to') && !ariaLabel.includes('cc') && !ariaLabel.includes('bcc');
      } else if (fieldLower === 'cc') {
        matches = ariaLabel.includes('cc') && !ariaLabel.includes('bcc');
      } else if (fieldLower === 'bcc') {
        matches = ariaLabel.includes('bcc');
      }

      if (matches) {
        console.log(`[MailTracker AI] ✅ Found ${fieldType} container via aria-label: "${ariaLabel}"`);
        return textbox;
      }
    }

    // Strategy 3: Find by label text + associated container
    const allElements = composeRoot.querySelectorAll('*');
    console.log(`[MailTracker AI] Searching ${allElements.length} elements for ${fieldType} label...`);

    for (const element of allElements) {
      const text = element.textContent?.trim().toLowerCase();
      const ariaLabel = element.getAttribute('aria-label')?.toLowerCase();

      // Check if this element is a field label
      let isFieldLabel = false;

      if (fieldLower === 'to') {
        isFieldLabel = (text === 'to' || text === 'to:' || ariaLabel === 'to' || ariaLabel?.includes('to ')) &&
          !text.includes('cc') && !ariaLabel?.includes('cc');
      } else if (fieldLower === 'cc') {
        isFieldLabel = (text === 'cc' || text === 'cc:' || ariaLabel === 'cc' || ariaLabel?.includes('cc ')) &&
          !text.includes('bcc') && !ariaLabel?.includes('bcc');
      } else if (fieldLower === 'bcc') {
        isFieldLabel = text === 'bcc' || text === 'bcc:' || ariaLabel === 'bcc' || ariaLabel?.includes('bcc ');
      }

      if (isFieldLabel) {
        console.log(`[MailTracker AI] Found ${fieldType} label element, searching for container...`);

        // Check next sibling
        let container = element.nextElementSibling;
        if (container?.matches('[role="textbox"], [contenteditable="true"]')) {
          console.log(`[MailTracker AI] ✅ Found ${fieldType} container via label sibling`);
          return container;
        }

        // Check parent's next sibling
        container = element.parentElement?.nextElementSibling;
        if (container?.matches('[role="textbox"], [contenteditable="true"]')) {
          console.log(`[MailTracker AI] ✅ Found ${fieldType} container via parent sibling`);
          return container;
        }

        // Check within parent
        container = element.parentElement?.querySelector('[role="textbox"], [contenteditable="true"]');
        if (container) {
          console.log(`[MailTracker AI] ✅ Found ${fieldType} container within parent`);
          return container;
        }

        // Check siblings more broadly
        let current = element;
        for (let i = 0; i < 5; i++) {
          current = current?.nextElementSibling;
          if (current?.matches('[role="textbox"], [contenteditable="true"]')) {
            console.log(`[MailTracker AI] ✅ Found ${fieldType} container via sibling search`);
            return current;
          }
        }
      }
    }

    // Strategy 4: Positional fallback (TO is typically first, CC second, BCC third)
    if (fieldLower === 'to') {
      const textboxes = Array.from(composeRoot.querySelectorAll('[role="textbox"], [contenteditable="true"]'));
      const firstTextbox = textboxes.find(tb => {
        const ariaLabel = (tb.getAttribute('aria-label') || '').toLowerCase();
        return !ariaLabel.includes('message body') &&
          !ariaLabel.includes('cc') &&
          !ariaLabel.includes('bcc') &&
          !ariaLabel.includes('compose');
      });

      if (firstTextbox) {
        console.log(`[MailTracker AI] ✅ Using first textbox as TO (fallback)`);
        return firstTextbox;
      }
    } else if (fieldLower === 'cc') {
      // CC is usually the second textbox
      const textboxes = Array.from(composeRoot.querySelectorAll('[role="textbox"], [contenteditable="true"]'));
      const ccTextbox = textboxes.find(tb => {
        const ariaLabel = (tb.getAttribute('aria-label') || '').toLowerCase();
        return !ariaLabel.includes('message body') &&
          !ariaLabel.includes('bcc') &&
          !ariaLabel.includes('compose') &&
          (ariaLabel.includes('cc') || textboxes.indexOf(tb) === 1);
      });

      if (ccTextbox) {
        console.log(`[MailTracker AI] ✅ Using second textbox as CC (fallback)`);
        return ccTextbox;
      }
    }

    console.warn(`[MailTracker AI] ❌ No container found for ${fieldType}`);
    return null;
  }

  /**
   * Extract recipients from a specific field with multiple strategies
   */
  extractFromField(composeRoot, fieldType) {
    const container = this.findFieldContainer(composeRoot, fieldType);

    if (!container) {
      console.log(`[MailTracker AI] No container found for ${fieldType}`);
      return [];
    }
    console.log(`[MailTracker AI] Extracting ${fieldType} recipients...`);
    // Try all extraction strategies and combine results
    const allEmails = new Set();
    // Strategy 1: Chips (most reliable)
    const chipEmails = this.extractFromChips(container);
    chipEmails.forEach(email => allEmails.add(email));
    console.log(`[MailTracker AI] ${fieldType} from chips: ${chipEmails.length}`);
    // Strategy 2: Aria labels (often complete)
    const ariaEmails = this.extractFromAriaLabel(container);
    ariaEmails.forEach(email => allEmails.add(email));
    console.log(`[MailTracker AI] ${fieldType} from aria-label: ${ariaEmails.length}`);
    // Strategy 3: Inputs (fallback)
    if (allEmails.size === 0) {
      const inputEmails = this.extractFromInputs(container);
      inputEmails.forEach(email => allEmails.add(email));
      console.log(`[MailTracker AI] ${fieldType} from inputs: ${inputEmails.length}`);
    }
    const result = Array.from(allEmails).sort();
    console.log(`[MailTracker AI] ${fieldType} total: ${result.length}`, result);

    return result;
  }

  /**
   * Clean and validate an extracted email
   * Removes common prefixes/suffixes that get mixed in with emails
   * Based on actual issues seen: "cc", "bcc", "engineer", "developer", "gmail.com" concatenation
   */
  cleanEmail(email) {
    if (!email || typeof email !== 'string') return null;

    let cleaned = email.toLowerCase().trim();

    // Step 1: Try to extract the actual email pattern from concatenated strings
    // Examples: "gmail.combccjdivyaraj6@gmail.comadd" -> "jdivyaraj6@gmail.com"
    if (cleaned.includes('@')) {
      // Find all potential email matches
      const matches = cleaned.match(this.emailFinderRegex);
      if (matches && matches.length > 0) {
        // Use the last match (most likely to be the real email)
        // But also check if any match is valid
        for (let i = matches.length - 1; i >= 0; i--) {
          const match = matches[i];
          const testEmail = this.extractEmailFromText(match);
          if (testEmail && this.isValidEmail(testEmail)) {
            cleaned = testEmail;
            break;
          }
        }
        // If no valid match found, use the last one anyway
        if (!this.isValidEmail(cleaned)) {
          cleaned = matches[matches.length - 1];
        }
      }
    }

    // Step 2: Handle multiple @ signs
    if (cleaned.includes('@')) {
      const atCount = (cleaned.match(/@/g) || []).length;
      if (atCount > 1) {
        // Split by @ and try to reconstruct from last two parts
        const parts = cleaned.split('@');
        if (parts.length >= 2) {
          // Take the last two parts
          cleaned = parts[parts.length - 2] + '@' + parts[parts.length - 1];
        }
      }
    }

    // Step 3: Remove domain parts that appear before @ (like "gmail.com" in local part)
    if (cleaned.includes('@')) {
      const parts = cleaned.split('@');
      if (parts.length === 2) {
        // Remove any .com, .net, etc. from the local part (common TLDs)
        parts[0] = parts[0].replace(/\.(com|net|org|edu|gov|mil|co|io|ai|uk|ca|au|de|fr|jp|in|cn|br|ru|es|it|nl|se|no|dk|fi|pl|cz|gr|pt|ie|be|at|ch|nz|za|mx|ar|cl|co|pe|ve|ec|uy|py|bo|cr|pa|do|gt|hn|ni|sv|bz|jm|tt|bb|gd|lc|vc|ag|dm|kn|mu|sc|tz|ke|ug|et|gh|ng|sn|ci|cm|ga|cg|cd|ao|mz|zw|bw|na|sz|ls|mg|rw|bi|td|ne|ml|bf|mr|gm|gw|gn|sl|lr|tg|bj|dj|km|so|er|sd|ly|tn|dz|ma|eh|ss|ye|iq|sy|jo|lb|ps|il|sa|ae|om|qa|bh|kw|ir|af|pk|bd|lk|mv|np|bt|mm|th|la|kh|vn|ph|my|sg|bn|id|tl|pg|fj|nc|pf|ws|to|vu|sb|ki|nr|pw|fm|mh|as|gu|mp|vi|pr|do|ht|cu|jm|bs|ky|tc|vg|ai|ms|bl|mf|pm|wf|tf|re|yt|mo|hk|tw|kr|jp|cn|mn|kz|uz|tj|kg|tm|az|ge|am|by|ua|md|ro|bg|rs|me|ba|hr|si|sk|hu|ee|lv|lt|is|fo|gl|ax|sj|sx|bq|cw|aw)$/i, '');

        // Remove common prefixes from local part (based on actual data we see)
        // Only the ones that actually appear: cc, bcc, to, engineer, developer
        // Also handle cases like "ccbcc" or "bccjdivyaraj6"
        parts[0] = parts[0].replace(/^(cc|bcc|to|from|ccbcc|bcc|cc)/i, '');

        // Remove any remaining domain-like strings from local part
        parts[0] = parts[0].replace(/gmail\.com|yahoo\.com|hotmail\.com|outlook\.com/i, '');

        cleaned = parts.join('@');
      }
    }

    // Step 4: Remove common prefixes (only the ones we actually see in the data)
    cleaned = cleaned.replace(/^(cc|bcc|to|from|ccbcc|bcc|cc)/i, '');

    // Step 5: Remove suffixes (add, cc, bcc, etc.)
    // Handle cases like "jdivyaraj6@gmail.comccbcc" or "jdivyaraj6@gmail.comadd"
    // Also handle cases where text is concatenated after the domain
    if (cleaned.includes('@')) {
      const parts = cleaned.split('@');
      if (parts.length === 2) {
        // Remove text that comes after a valid TLD pattern (like "gmail.comccbcc" -> "gmail.com")
        // Match domain pattern: word.word (e.g., "gmail.com", "bytestechnolab.com")
        // Then remove anything after that doesn't look like part of the domain
        parts[1] = parts[1].replace(/^([a-z0-9.-]+\.(com|net|org|edu|gov|mil|co|io|ai|uk|ca|au|de|fr|jp|in|cn|br|ru|es|it|nl|se|no|dk|fi|pl|cz|gr|pt|ie|be|at|ch|nz|za|mx|ar|cl|co|pe|ve|ec|uy|py|bo|cr|pa|do|gt|hn|ni|sv|bz|jm|tt|bb|gd|lc|vc|ag|dm|kn|mu|sc|tz|ke|ug|et|gh|ng|sn|ci|cm|ga|cg|cd|ao|mz|zw|bw|na|sz|ls|mg|rw|bi|td|ne|ml|bf|mr|gm|gw|gn|sl|lr|tg|bj|dj|km|so|er|sd|ly|tn|dz|ma|eh|ss|ye|iq|sy|jo|lb|ps|il|sa|ae|om|qa|bh|kw|ir|af|pk|bd|lk|mv|np|bt|mm|th|la|kh|vn|ph|my|sg|bn|id|tl|pg|fj|nc|pf|ws|to|vu|sb|ki|nr|pw|fm|mh|as|gu|mp|vi|pr|do|ht|cu|jm|bs|ky|tc|vg|ai|ms|bl|mf|pm|wf|tf|re|yt|mo|hk|tw|kr|jp|cn|mn|kz|uz|tj|kg|tm|az|ge|am|by|ua|md|ro|bg|rs|me|ba|hr|si|sk|hu|ee|lv|lt|is|fo|gl|ax|sj|sx|bq|cw|aw))[^a-z0-9.]*/i, '$1');
        cleaned = parts.join('@');
      }
    }
    // Also remove suffixes from the whole string as fallback
    cleaned = cleaned.replace(/(cc|bcc|to|add|remove|ccbcc)$/i, '');

    // Step 6: Remove any remaining non-email characters at start/end
    // But be careful not to remove valid email characters
    // Only remove if there are actual non-alphanumeric characters
    if (cleaned.includes('@')) {
      const parts = cleaned.split('@');
      if (parts.length === 2) {
        // Only remove non-alphanumeric from local part if they exist
        parts[0] = parts[0].replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9.]+$/, '');
        // Domain should only have alphanumeric, dots, and hyphens
        parts[1] = parts[1].replace(/^[^a-z0-9.]+/, '').replace(/[^a-z0-9.]+$/gi, '');
        cleaned = parts.join('@');
      }
    } else {
      // Fallback if no @ sign (shouldn't happen at this point)
      cleaned = cleaned.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
    }

    // Step 7: Final checks - reject if still has issues
    if (!cleaned.includes('@')) return null;

    const parts = cleaned.split('@');
    if (parts.length !== 2) return null;

    const [local, domain] = parts;

    // Reject if local part is too short (likely a partial extraction)
    // Valid email local parts should be at least 1 character, but we'll be more strict
    if (!local || local.length < 1) return null;

    // Reject if local part looks like it's missing characters (e.g., "divyaraj" when it should be "jdivyaraj6")
    // This is a heuristic - if the original email had numbers/characters that are now missing, reject
    // But we can't know the original, so we'll just ensure it's a valid email format

    // Reject if local part still has prefixes
    if (/^(cc|bcc|to|from|ccbcc|bcc|cc)/i.test(local)) {
      return null;
    }

    // Reject if local part has domain-like strings
    if (local.includes('.com') || local.includes('.net') || local.includes('.org')) {
      return null;
    }

    // Reject if domain doesn't end with valid TLD
    if (!/\.(com|net|org|edu|gov|mil|co|io|ai|uk|ca|au|de|fr|jp|in|cn|br|ru|es|it|nl|se|no|dk|fi|pl|cz|gr|pt|ie|be|at|ch|nz|za|mx|ar|cl|co|pe|ve|ec|uy|py|bo|cr|pa|do|gt|hn|ni|sv|bz|jm|tt|bb|gd|lc|vc|ag|dm|kn|mu|sc|tz|ke|ug|et|gh|ng|sn|ci|cm|ga|cg|cd|ao|mz|zw|bw|na|sz|ls|mg|rw|bi|td|ne|ml|bf|mr|gm|gw|gn|sl|lr|tg|bj|dj|km|so|er|sd|ly|tn|dz|ma|eh|ss|ye|iq|sy|jo|lb|ps|il|sa|ae|om|qa|bh|kw|ir|af|pk|bd|lk|mv|np|bt|mm|th|la|kh|vn|ph|my|sg|bn|id|tl|pg|fj|nc|pf|ws|to|vu|sb|ki|nr|pw|fm|mh|as|gu|mp|vi|pr|do|ht|cu|jm|bs|ky|tc|vg|ai|ms|bl|mf|pm|wf|tf|re|yt|mo|hk|tw|kr|jp|cn|mn|kz|uz|tj|kg|tm|az|ge|am|by|ua|md|ro|bg|rs|me|ba|hr|si|sk|hu|ee|lv|lt|is|fo|gl|ax|sj|sx|bq|cw|aw)$/i.test(domain)) {
      return null;
    }

    // Check if domain has text after TLD
    const tldMatch = domain.match(/\.(com|net|org|edu|gov|mil|co|io|ai|uk|ca|au|de|fr|jp|in|cn|br|ru|es|it|nl|se|no|dk|fi|pl|cz|gr|pt|ie|be|at|ch|nz|za|mx|ar|cl|co|pe|ve|ec|uy|py|bo|cr|pa|do|gt|hn|ni|sv|bz|jm|tt|bb|gd|lc|vc|ag|dm|kn|mu|sc|tz|ke|ug|et|gh|ng|sn|ci|cm|ga|cg|cd|ao|mz|zw|bw|na|sz|ls|mg|rw|bi|td|ne|ml|bf|mr|gm|gw|gn|sl|lr|tg|bj|dj|km|so|er|sd|ly|tn|dz|ma|eh|ss|ye|iq|sy|jo|lb|ps|il|sa|ae|om|qa|bh|kw|ir|af|pk|bd|lk|mv|np|bt|mm|th|la|kh|vn|ph|my|sg|bn|id|tl|pg|fj|nc|pf|ws|to|vu|sb|ki|nr|pw|fm|mh|as|gu|mp|vi|pr|do|ht|cu|jm|bs|ky|tc|vg|ai|ms|bl|mf|pm|wf|tf|re|yt|mo|hk|tw|kr|jp|cn|mn|kz|uz|tj|kg|tm|az|ge|am|by|ua|md|ro|bg|rs|me|ba|hr|si|sk|hu|ee|lv|lt|is|fo|gl|ax|sj|sx|bq|cw|aw)$/i);
    if (tldMatch && tldMatch.index !== undefined) {
      const tldEnd = tldMatch.index + tldMatch[0].length;
      if (domain.length > tldEnd) {
        return null; // Text after TLD
      }
    }

    // Step 8: Final validation
    if (this.isValidEmail(cleaned)) {
      return cleaned;
    }

    return null;
  }

  /**
   * Extract all emails from a container using ALL possible methods
   * Prioritizes clean sources (data attributes) over text content
   */
  extractAllEmailsFromContainer(container) {
    const emails = new Set();
    if (!container) return [];

    // Priority 1: Extract from data attributes (most reliable - these are clean)
    const dataAttributes = [
      'data-hovercard-id',  // Gmail's primary email storage
      'email',              // Direct email attribute
      'data-email',         // Data email attribute
      'data-value',         // Sometimes contains email
      'data-address',       // Address attribute
      'data-address-value'  // Address value
    ];

    // Get all elements in container
    const allElements = container.querySelectorAll('*');

    // First pass: Extract from data attributes (cleanest source)
    allElements.forEach(el => {
      dataAttributes.forEach(attr => {
        const value = el.getAttribute(attr);
        if (value && value.includes('@')) {
          const email = this.extractEmailFromText(value);
          if (email) {
            const cleaned = this.cleanEmail(email);
            if (cleaned) {
              emails.add(cleaned);
            }
          }
        }
      });
    });

    // Also check container's own attributes
    dataAttributes.forEach(attr => {
      const value = container.getAttribute(attr);
      if (value && value.includes('@')) {
        const email = this.extractEmailFromText(value);
        if (email) {
          const cleaned = this.cleanEmail(email);
          if (cleaned) {
            emails.add(cleaned);
          }
        }
      }
    });

    // Priority 2: Extract from chip elements (Gmail's recipient chips)
    // These usually have clean email data
    const chipSelectors = [
      '[data-hovercard-id*="@"]',
      'span[email]',
      'span[data-email]',
      'div[email]',
      'div[data-email]',
      '[role="option"]'
    ];

    chipSelectors.forEach(selector => {
      try {
        const chips = container.querySelectorAll(selector);
        chips.forEach(chip => {
          // Check data attributes first
          dataAttributes.forEach(attr => {
            const value = chip.getAttribute(attr);
            if (value && value.includes('@')) {
              const email = this.extractEmailFromText(value);
              if (email) {
                const cleaned = this.cleanEmail(email);
                if (cleaned) {
                  emails.add(cleaned);
                }
              }
            }
          });
        });
      } catch (e) {
        // Skip invalid selectors
      }
    });

    // Priority 3: Extract from text content (be more careful here)
    // Only extract if the text looks like it contains clean emails
    // Use this as a fallback, but be very strict about what we accept
    allElements.forEach(el => {
      const text = (el.textContent || el.innerText || '').trim();

      // Skip if text is too long (likely not just an email)
      if (text.length > 100) return;

      // Skip if text contains common non-email words
      if (/\b(cc|bcc|to|from|add|remove|click|here|more|less|show|hide|expand|collapse|open|close|save|cancel|ok|yes|no|true|false|submit|send|delete|edit|update|create|new|old|first|last|next|previous|back|forward|up|down|left|right|top|bottom|start|end|begin|finish|complete|done|ready|loading|wait|please|thank|thanks|sorry|excuse|hello|hi|hey|greetings|regards|sincerely|best|warm|kind|yours|truly|faithfully|cordially|respectfully|gratefully|appreciatively|humbly|proudly|honestly|frankly|personally|professionally|officially|unofficially|formally|informally|casually|seriously|jokingly|sarcastically|ironically|paradoxically|contradictorily|illogically|irrationally|unreasonably|unfairly|unjustly|unlawfully|illegally|criminally|immorally|unethically|dishonestly|fraudulently|deceitfully|deceptively|misleadingly|falsely|incorrectly|wrongly|mistakenly|erroneously|inaccurately|imprecisely|vaguely|ambiguously|unclearly|confusingly|puzzlingly|perplexingly|bewilderingly|bafflingly|mystifyingly|enigmaticly|cryptically|secretly|privately|confidentially|discretely|quietly|silently|loudly|noisily|audibly|inaudibly|visibly|invisibly|clearly|obviously|evidently|apparently|seemingly|ostensibly|supposedly|allegedly|reportedly|purportedly|presumably|probably|possibly|perhaps|maybe|might|could|would|should|must|shall|will|can|may|might|could|would|should|must|shall|will|can|may)\b/i.test(text)) {
        return;
      }

      if (text && text.includes('@')) {
        // Use regex to find emails, but be strict
        const matches = text.match(this.emailFinderRegex);
        if (matches) {
          matches.forEach(match => {
            // Only accept if the match is the entire text or very close to it
            const trimmedMatch = match.trim();
            const textWithoutMatch = text.replace(match, '').trim();

            // If there's a lot of extra text, skip it
            if (textWithoutMatch.length > 20) return;

            // Ensure the match looks like a complete email (has @ and domain)
            if (!trimmedMatch.includes('@') || trimmedMatch.split('@').length !== 2) return;

            const [local, domain] = trimmedMatch.split('@');
            // Reject if local part is suspiciously short or looks incomplete
            if (!local || local.length < 2) return;
            // Reject if domain doesn't look valid
            if (!domain || domain.length < 4 || !domain.includes('.')) return;

            const email = this.extractEmailFromText(trimmedMatch);
            if (email && this.isValidEmail(email)) {
              // Clean the email to remove any prefixes/suffixes
              const cleaned = this.cleanEmail(email);
              if (cleaned) {
                emails.add(cleaned);
              }
            }
          });
        }
      }
    });

    // Priority 4: Extract from input/textarea values (usually clean)
    const inputs = container.querySelectorAll('input, textarea');
    inputs.forEach(input => {
      const value = (input.value || '').trim();
      if (value && value.includes('@')) {
        // Split by common delimiters
        const parts = value.split(/[,;]/);
        parts.forEach(part => {
          const email = this.extractEmailFromText(part.trim());
          if (email) {
            const cleaned = this.cleanEmail(email);
            if (cleaned) {
              emails.add(cleaned);
            }
          }
        });
      }
    });

    // Final cleanup: Clean all emails and filter out malformed ones
    const cleanedEmails = Array.from(emails)
      .map(email => this.cleanEmail(email))
      .filter(email => {
        if (!email) return false;

        // Reject emails that still have multiple @ signs
        if (email.split('@').length !== 2) return false;

        const [local, domain] = email.split('@');

        // Reject emails that contain domain parts in wrong places (like "gmail.com" before @)
        if (local.includes('.com') || local.includes('.net') || local.includes('.org') ||
          local.includes('.edu') || local.includes('.gov') || local.includes('.mil')) {
          return false;
        }

        // Reject emails that still have common prefixes (should have been cleaned)
        if (/^(cc|bcc|to|from|add|remove|ccbcc|bcc|cc)/i.test(email) ||
          /^(cc|bcc|to|from|add|remove|ccbcc|bcc|cc)/i.test(local)) {
          return false;
        }

        // Reject emails where domain doesn't end with a valid TLD pattern
        // This will catch cases like "gmail.comccbcc" or "gmail.comadd"
        if (domain && !/\.(com|net|org|edu|gov|mil|co|io|ai|uk|ca|au|de|fr|jp|in|cn|br|ru|es|it|nl|se|no|dk|fi|pl|cz|gr|pt|ie|be|at|ch|nz|za|mx|ar|cl|co|pe|ve|ec|uy|py|bo|cr|pa|do|gt|hn|ni|sv|bz|jm|tt|bb|gd|lc|vc|ag|dm|kn|mu|sc|tz|ke|ug|et|gh|ng|sn|ci|cm|ga|cg|cd|ao|mz|zw|bw|na|sz|ls|mg|rw|bi|td|ne|ml|bf|mr|gm|gw|gn|sl|lr|tg|bj|dj|km|so|er|sd|ly|tn|dz|ma|eh|ss|ye|iq|sy|jo|lb|ps|il|sa|ae|om|qa|bh|kw|ir|af|pk|bd|lk|mv|np|bt|mm|th|la|kh|vn|ph|my|sg|bn|id|tl|pg|fj|nc|pf|ws|to|vu|sb|ki|nr|pw|fm|mh|as|gu|mp|vi|pr|do|ht|cu|jm|bs|ky|tc|vg|ai|ms|bl|mf|pm|wf|tf|re|yt|mo|hk|tw|kr|jp|cn|mn|kz|uz|tj|kg|tm|az|ge|am|by|ua|md|ro|bg|rs|me|ba|hr|si|sk|hu|ee|lv|lt|is|fo|gl|ax|sj|sx|bq|cw|aw)$/i.test(domain)) {
          return false;
        }

        // Reject emails that have text after a valid TLD (like "gmail.comccbcc" or "gmail.comadd")
        // Extract the TLD and check if there's anything after it
        const tldMatch = domain.match(/\.(com|net|org|edu|gov|mil|co|io|ai|uk|ca|au|de|fr|jp|in|cn|br|ru|es|it|nl|se|no|dk|fi|pl|cz|gr|pt|ie|be|at|ch|nz|za|mx|ar|cl|co|pe|ve|ec|uy|py|bo|cr|pa|do|gt|hn|ni|sv|bz|jm|tt|bb|gd|lc|vc|ag|dm|kn|mu|sc|tz|ke|ug|et|gh|ng|sn|ci|cm|ga|cg|cd|ao|mz|zw|bw|na|sz|ls|mg|rw|bi|td|ne|ml|bf|mr|gm|gw|gn|sl|lr|tg|bj|dj|km|so|er|sd|ly|tn|dz|ma|eh|ss|ye|iq|sy|jo|lb|ps|il|sa|ae|om|qa|bh|kw|ir|af|pk|bd|lk|mv|np|bt|mm|th|la|kh|vn|ph|my|sg|bn|id|tl|pg|fj|nc|pf|ws|to|vu|sb|ki|nr|pw|fm|mh|as|gu|mp|vi|pr|do|ht|cu|jm|bs|ky|tc|vg|ai|ms|bl|mf|pm|wf|tf|re|yt|mo|hk|tw|kr|jp|cn|mn|kz|uz|tj|kg|tm|az|ge|am|by|ua|md|ro|bg|rs|me|ba|hr|si|sk|hu|ee|lv|lt|is|fo|gl|ax|sj|sx|bq|cw|aw)$/i);
        if (tldMatch && tldMatch.index !== undefined) {
          const tldEnd = tldMatch.index + tldMatch[0].length;
          if (domain.length > tldEnd) {
            // There's text after the TLD - reject it
            return false;
          }
        }

        // Final validation
        return this.isValidEmail(email);
      });

    return cleanedEmails;
  }

  /**
   * Determine field type (To, CC, BCC) from a textbox element
   */
  determineFieldType(textbox, index, allTextboxes) {
    const ariaLabel = (textbox.getAttribute('aria-label') || '').toLowerCase();
    const textContent = (textbox.textContent || '').toLowerCase();

    // Check aria-label first (most reliable)
    if (ariaLabel.includes('bcc')) return 'bcc';
    if (ariaLabel.includes('cc') && !ariaLabel.includes('bcc')) return 'cc';
    if (ariaLabel.includes('to') && !ariaLabel.includes('cc') && !ariaLabel.includes('bcc')) return 'to';

    // Check if it's message body
    if (ariaLabel.includes('message body') || ariaLabel.includes('compose')) return null;

    // Positional fallback
    if (index === 0) return 'to';
    if (index === 1) return 'cc';
    if (index === 2) return 'bcc';

    return null;
  }

  /**
   * Extract the sender's email from the 'From' field
   * Used to exclude the sender from the recipient list
   */
  extractSender(composeRoot) {
    console.log('[MailTracker AI] Attempting to identify sender...');

    // Strategy 1: Look for "From" field
    const fromSelectors = [
      'input[name="from"]',
      '[aria-label*="From" i]',
      '[aria-label*="Sender" i]',
      '.gU.Up' // Gmail specific class for sender wrapper
    ];

    for (const selector of fromSelectors) {
      const elements = composeRoot.querySelectorAll(selector);
      for (const el of elements) {
        // Extract email from this element
        const value = el.value || el.textContent || el.getAttribute('aria-label') || '';
        if (value.includes('@')) {
          const email = this.extractEmailFromText(value);
          if (email && this.isValidEmail(email)) {
            console.log(`[MailTracker AI] Identified sender: ${email}`);
            return email;
          }
        }

        // Check children
        const emails = this.extractAllEmailsFromContainer(el);
        if (emails.length > 0) {
          console.log(`[MailTracker AI] Identified sender from children: ${emails[0]}`);
          return emails[0];
        }
      }
    }

    return null;
  }

  /**
   * Main extraction method - NEW AGGRESSIVE APPROACH
   * Finds all textboxes, categorizes them, and extracts from ALL sources
   */
  async extractRecipients(composeRoot, options = {}) {
    const { maxRetries = 5, retryDelay = 250 } = options;

    console.log('[MailTracker AI] === Starting Aggressive Recipient Extraction ===');

    // Identify sender to exclude
    const senderEmail = this.extractSender(composeRoot);

    let bestResult = { to: [], cc: [], bcc: [] };
    let bestTotal = 0;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        console.log(`[MailTracker AI] Retry attempt ${attempt + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }

      const result = { to: [], cc: [], bcc: [] };

      // Find ALL textboxes in compose window
      // Also look for hidden/collapsed BCC fields
      const allTextboxes = Array.from(composeRoot.querySelectorAll('[role="textbox"], [contenteditable="true"]'));

      // Also check for BCC fields that might be hidden or in a different structure
      const bccLabels = composeRoot.querySelectorAll('*');
      bccLabels.forEach(el => {
        const text = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
        if (text === 'bcc' || text === 'bcc:') {
          // Found BCC label, look for associated textbox
          let sibling = el.nextElementSibling;
          let parent = el.parentElement;
          // Check siblings and parent's children for textbox
          const nearbyTextboxes = [
            ...Array.from(parent?.querySelectorAll('[role="textbox"], [contenteditable="true"]') || []),
            ...Array.from(sibling?.querySelectorAll('[role="textbox"], [contenteditable="true"]') || [])
          ];
          nearbyTextboxes.forEach(tb => {
            if (!allTextboxes.includes(tb)) {
              allTextboxes.push(tb);
              console.log(`[MailTracker AI] Found additional textbox near BCC label`);
            }
          });
        }
      });

      console.log(`[MailTracker AI] Found ${allTextboxes.length} textbox elements`);

      // Process each textbox
      allTextboxes.forEach((textbox, index) => {
        const ariaLabel = textbox.getAttribute('aria-label') || '';
        console.log(`[MailTracker AI] Textbox ${index + 1}: aria-label="${ariaLabel}"`);

        // Determine field type
        const fieldType = this.determineFieldType(textbox, index, allTextboxes);

        if (!fieldType) {
          console.log(`[MailTracker AI]   Skipping (likely message body)`);
          return;
        }

        console.log(`[MailTracker AI]   Identified as: ${fieldType.toUpperCase()}`);

        // Extract emails from this textbox using ALL methods
        const emails = this.extractAllEmailsFromContainer(textbox);
        console.log(`[MailTracker AI]   Extracted ${emails.length} email(s):`, emails);

        // Add to appropriate field
        emails.forEach(email => {
          // Exclude sender
          if (senderEmail && email.toLowerCase() === senderEmail.toLowerCase()) {
            console.log(`[MailTracker AI]   Skipping sender email: ${email}`);
            return;
          }

          if (!result[fieldType].includes(email)) {
            result[fieldType].push(email);
          }
        });
      });

      // Also try extracting from the entire compose root (fallback)
      // This is important - sometimes emails are in the DOM but not in specific textboxes
      console.log('[MailTracker AI] Also checking entire compose root for emails...');
      const rootEmails = this.extractAllEmailsFromContainer(composeRoot);
      console.log(`[MailTracker AI] Found ${rootEmails.length} email(s) in compose root`);

      // Add any emails found in root that aren't already in our results
      // Try to determine which field they belong to by finding their container
      rootEmails.forEach(email => {
        // Exclude sender
        if (senderEmail && email.toLowerCase() === senderEmail.toLowerCase()) {
          return;
        }

        // Check if email is already in any field
        const alreadyFound = result.to.includes(email) ||
          result.cc.includes(email) ||
          result.bcc.includes(email);

        if (!alreadyFound) {
          // Try to find which field this email belongs to by searching the DOM
          let assigned = false;

          // Find the element containing this email
          const emailElements = composeRoot.querySelectorAll('*');
          for (const el of emailElements) {
            const text = (el.textContent || el.getAttribute('data-hovercard-id') || el.getAttribute('email') || '').toLowerCase();
            if (text.includes(email.toLowerCase())) {
              // Found the element containing this email, now find which field it's in
              // Look for field labels nearby
              let parent = el.parentElement;
              let depth = 0;
              while (parent && depth < 10) {
                const parentText = (parent.textContent || parent.getAttribute('aria-label') || '').toLowerCase();
                const parentAriaLabel = (parent.getAttribute('aria-label') || '').toLowerCase();

                // Check for BCC first (most specific)
                if (parentAriaLabel.includes('bcc') ||
                  (parentText.includes('bcc') && !parentText.includes('cc')) ||
                  (parentText.startsWith('bcc') && parentText.length < 10)) {
                  result.bcc.push(email);
                  console.log(`[MailTracker AI] Added "${email}" to BCC (found near BCC label)`);
                  assigned = true;
                  break;
                }
                // Check for CC (but not BCC)
                if ((parentAriaLabel.includes('cc') && !parentAriaLabel.includes('bcc')) ||
                  (parentText.includes('cc') && !parentText.includes('bcc') && parentText.length < 10)) {
                  result.cc.push(email);
                  console.log(`[MailTracker AI] Added "${email}" to CC (found near CC label)`);
                  assigned = true;
                  break;
                }
                // Check for TO
                if (parentAriaLabel.includes('to') || (parentText.startsWith('to') && parentText.length < 10)) {
                  result.to.push(email);
                  console.log(`[MailTracker AI] Added "${email}" to TO (found near TO label)`);
                  assigned = true;
                  break;
                }

                parent = parent.parentElement;
                depth++;
              }

              if (assigned) break;
            }
          }

          // If we couldn't determine the field, use a smarter fallback
          if (!assigned) {
            // If we have emails in specific fields, try to match the pattern
            // Otherwise, add to the field with fewest emails (likely BCC if it's empty)
            const toCount = result.to.length;
            const ccCount = result.cc.length;
            const bccCount = result.bcc.length;

            // If BCC is empty but we have TO and CC, likely this is BCC
            if (bccCount === 0 && toCount > 0 && ccCount > 0) {
              result.bcc.push(email);
              console.log(`[MailTracker AI] Added "${email}" to BCC (fallback - BCC was empty)`);
            } else if (toCount === 0 && ccCount === 0 && bccCount === 0) {
              result.to.push(email);
              console.log(`[MailTracker AI] Added "${email}" to TO (fallback - no other emails found)`);
            } else {
              // Add to the field with fewest emails
              if (bccCount <= ccCount && bccCount <= toCount) {
                result.bcc.push(email);
                console.log(`[MailTracker AI] Added "${email}" to BCC (fallback - fewest emails)`);
              } else if (ccCount <= toCount) {
                result.cc.push(email);
                console.log(`[MailTracker AI] Added "${email}" to CC (fallback - fewest emails)`);
              } else {
                result.to.push(email);
                console.log(`[MailTracker AI] Added "${email}" to TO (fallback - fewest emails)`);
              }
            }
          }
        }
      });

      const total = result.to.length + result.cc.length + result.bcc.length;
      console.log(`[MailTracker AI] Attempt ${attempt + 1} result:`, {
        to: result.to.length,
        cc: result.cc.length,
        bcc: result.bcc.length,
        total
      });

      if (total > bestTotal) {
        bestResult = result;
        bestTotal = total;
      }

      // If we found recipients and they're stable, we're done
      if (total > 0 && attempt > 0 && total === bestTotal) {
        console.log(`[MailTracker AI] ✅ Stable result achieved after ${attempt + 1} attempts`);
        break;
      }

      // If we found recipients, we can stop early
      if (total > 0 && attempt === 0) {
        console.log(`[MailTracker AI] ✅ Found recipients on first attempt`);
        break;
      }
    }

    // Final cleanup: Remove sender from ALL recipient lists
    // This ensures the sender is never included as a recipient, especially in Bcc
    if (senderEmail) {
      const normalizedSender = senderEmail.toLowerCase().trim();

      // Remove from To
      if (bestResult.to) {
        bestResult.to = bestResult.to.filter(email =>
          email.toLowerCase().trim() !== normalizedSender
        );
      }

      // Remove from Cc
      if (bestResult.cc) {
        bestResult.cc = bestResult.cc.filter(email =>
          email.toLowerCase().trim() !== normalizedSender
        );
      }

      // Remove from Bcc
      if (bestResult.bcc) {
        bestResult.bcc = bestResult.bcc.filter(email =>
          email.toLowerCase().trim() !== normalizedSender
        );
      }

      console.log(`[MailTracker AI] ✅ Final cleanup: Removed sender (${senderEmail}) from all recipient fields`);
    }

    // Clean up empty fields
    if (bestResult.to && bestResult.to.length === 0) delete bestResult.to;
    if (bestResult.cc && bestResult.cc.length === 0) delete bestResult.cc;
    if (bestResult.bcc && bestResult.bcc.length === 0) delete bestResult.bcc;

    console.log(`[MailTracker AI] === Final Result ===`, {
      to: bestResult.to?.length || 0,
      cc: bestResult.cc?.length || 0,
      bcc: bestResult.bcc?.length || 0,
      total: bestTotal,
      details: bestResult
    });

    return bestResult;
  }

  /**
   * Find compose dialog root element
   */
  findComposeRoot(element = null) {
    if (element) {
      // Find closest compose dialog
      return element.closest('[role="dialog"]') ||
        element.closest('.M9') || // Gmail compose class
        element.closest('td.Bu'); // Alternative compose container
    }
    // Find any open compose dialog
    return document.querySelector('[role="dialog"]') ||
      document.querySelector('.M9') ||
      document.querySelector('td.Bu');
  }
}

// Create a global instance for use throughout the script
const recipientExtractor = new GmailRecipientExtractor();

/**
 * Debug helper function - can be called from console to test extraction
 * Usage: debugExtractRecipients()
 */
window.debugExtractRecipients = function () {
  console.log('[MailTracker AI] ============================================');
  console.log('[MailTracker AI] === DEBUG: Testing Recipient Extraction ===');
  console.log('[MailTracker AI] ============================================');

  const composeRoot = document.querySelector('[role="dialog"]') ||
    document.querySelector('.M9') ||
    document.querySelector('td.Bu');

  if (!composeRoot) {
    console.error('[MailTracker AI] ❌ No compose window found!');
    console.error('[MailTracker AI] Please open a compose window first.');
    return;
  }

  console.log('[MailTracker AI] ✅ Found compose root');
  console.log('[MailTracker AI] Compose root element:', composeRoot);

  // Find all textboxes
  const textboxes = Array.from(composeRoot.querySelectorAll('[role="textbox"], [contenteditable="true"]'));
  console.log(`[MailTracker AI] Found ${textboxes.length} textbox elements:`);
  textboxes.forEach((tb, i) => {
    const ariaLabel = tb.getAttribute('aria-label') || 'no aria-label';
    const fieldType = recipientExtractor.determineFieldType(tb, i, textboxes);
    console.log(`  ${i + 1}. aria-label: "${ariaLabel}" → ${fieldType || 'message body'}`);

    // Show what emails are in this textbox
    const emails = recipientExtractor.extractAllEmailsFromContainer(tb);
    if (emails.length > 0) {
      console.log(`      Emails found: ${emails.join(', ')}`);
    }
  });

  console.log('[MailTracker AI] --- Starting Full Extraction ---');

  // Try extraction
  recipientExtractor.extractRecipients(composeRoot).then(result => {
    console.log('[MailTracker AI] ============================================');
    console.log('[MailTracker AI] === EXTRACTION RESULT ===');
    console.log('[MailTracker AI] ============================================');
    console.log(result);

    const total = (result.to?.length || 0) + (result.cc?.length || 0) + (result.bcc?.length || 0);

    if (total === 0) {
      console.warn('[MailTracker AI] ⚠️ No recipients found!');
      console.warn('[MailTracker AI] This might mean:');
      console.warn('[MailTracker AI]   1. No recipients have been added yet');
      console.warn('[MailTracker AI]   2. Recipients are in a format we don\'t recognize');
      console.warn('[MailTracker AI]   3. Gmail\'s DOM structure has changed');
      console.warn('[MailTracker AI] Check the logs above for details.');
    } else {
      console.log(`[MailTracker AI] ✅ Successfully extracted ${total} recipient(s)`);
      if (result.to) console.log(`[MailTracker AI]   To: ${result.to.length} - ${result.to.join(', ')}`);
      if (result.cc) console.log(`[MailTracker AI]   CC: ${result.cc.length} - ${result.cc.join(', ')}`);
      if (result.bcc) console.log(`[MailTracker AI]   BCC: ${result.bcc.length} - ${result.bcc.join(', ')}`);
    }
    console.log('[MailTracker AI] ============================================');
  });
};

/**
 * Extract recipients (to/cc/bcc) from the compose dialog
 * Uses the new GmailRecipientExtractor class
 * Note: This is a synchronous wrapper, but the actual extraction is async
 * For async extraction, use recipientExtractor.extractRecipients() directly
 */
const extractRecipients = composeRoot => {
  // Use the new extractor synchronously (will return empty if async needed)
  // For proper async extraction, use extractRecipientsWithRetry instead
  const result = {
    to: recipientExtractor.extractFromField(composeRoot, 'To'),
    cc: recipientExtractor.extractFromField(composeRoot, 'Cc'),
    bcc: recipientExtractor.extractFromField(composeRoot, 'Bcc')
  };

  // Clean up empty fields
  if (result.to.length === 0) delete result.to;
  if (result.cc.length === 0) delete result.cc;
  if (result.bcc.length === 0) delete result.bcc;

  return result;
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
const registerMessage = async ({ uid, recipients, subject, senderEmail }) => {
  // Debug logging
  console.log('[MailTracker AI] Registering message:', {
    uid,
    subject,
    recipients,
    senderEmail,
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
        senderEmail, // Include sender email
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
      // Check if chrome.runtime exists before trying to use it
      if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        chrome.runtime.sendMessage({
          type: 'mailtracker:notify',
          payload: {
            title: 'MailTracker AI',
            message: 'Tracking enabled for your outgoing email.'
          }
        });
      } else {
        console.log('[MailTracker AI] chrome.runtime not available, skipping notification');
      }
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
 * Uses the new GmailRecipientExtractor class
 */
const extractRecipientsWithRetry = async (composeRoot, maxRetries = 3, delay = 150) => {
  // Use the new extractor's async method which has built-in retry logic
  return await recipientExtractor.extractRecipients(composeRoot, { maxRetries, retryDelay: delay });
};

/**
 * Handle click on Gmail send buttons and wire up tracking
 */
const handleSendClick = async event => {
  if (!trackingEnabled) {
    return; // user disabled tracking via popup toggle
  }

  console.log('[MailTracker AI] ============================================');
  console.log('[MailTracker AI] Send button clicked - Starting extraction');
  console.log('[MailTracker AI] ============================================');

  const button = event.currentTarget;

  // Try multiple ways to find compose root
  let composeRoot = button.closest('div[role="dialog"]') ||
    button.closest('td.Bu') ||
    button.closest('[role="dialog"]') ||
    document.querySelector('[role="dialog"]') ||
    document.querySelector('.M9') ||
    document.querySelector('td.Bu');

  if (!composeRoot) {
    console.error('[MailTracker AI] ❌ Compose root not found!');
    console.error('[MailTracker AI] Button element:', button);
    console.error('[MailTracker AI] Trying to find compose window...');

    // Last resort: find any dialog
    composeRoot = document.querySelector('[role="dialog"]');
    if (!composeRoot) {
      console.error('[MailTracker AI] ❌ No compose window found at all!');
      return;
    }
  }

  console.log('[MailTracker AI] ✅ Found compose root:', composeRoot);

  const bodyEl = composeRoot.querySelector('div[aria-label="Message Body"], div.editable, div[contenteditable="true"]');
  const subjectInput = composeRoot.querySelector('input[name="subjectbox"], input[aria-label*="Subject" i]');

  if (!bodyEl) {
    console.warn('[MailTracker AI] ⚠️ Message body not found, but continuing...');
    // Don't return - we can still track even without body
  }

  const uid = generateUUID();
  console.log('[MailTracker AI] Generated UID:', uid);

  // Extract recipients with retry mechanism to ensure we get all of them
  // Add a small delay to ensure Gmail has finished rendering
  console.log('[MailTracker AI] Waiting 100ms for DOM to settle...');
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('[MailTracker AI] Starting recipient extraction...');
  const recipients = await extractRecipientsWithRetry(composeRoot, 5, 250); // More retries, longer delay
  const subject = subjectInput ? subjectInput.value : '';

  // Extract sender email to exclude sender's own opens
  // First try to extract from DOM
  let senderEmail = recipientExtractor.extractSender(composeRoot);

  // If extraction failed, use the stored userId as sender email
  // (userId should be set to the user's email address)
  if (!senderEmail) {
    const stored = await chrome.storage.sync.get(['userId']);
    senderEmail = stored.userId || 'default';
    console.log('[MailTracker AI] Sender extraction failed, using userId:', senderEmail);
  } else {
    console.log('[MailTracker AI] Sender email extracted:', senderEmail);
  }

  // CRITICAL FIX: Remove sender from recipients list using the FINAL senderEmail
  // This handles cases where extractRecipients failed to filter it (because extractSender returned null)
  if (senderEmail && senderEmail !== 'default') {
    const normalizedSender = senderEmail.toLowerCase().trim();

    // Helper to filter array
    const filterSender = (arr) => {
      if (!arr) return [];
      return arr.filter(email => email.toLowerCase().trim() !== normalizedSender);
    };

    if (recipients.to) recipients.to = filterSender(recipients.to);
    if (recipients.cc) recipients.cc = filterSender(recipients.cc);
    if (recipients.bcc) recipients.bcc = filterSender(recipients.bcc);

    console.log(`[MailTracker AI] 🧹 Performed final cleanup of sender (${senderEmail}) from recipients`);
  }

  // Final check: Log what we extracted
  const totalRecipients = (recipients.to?.length || 0) +
    (recipients.cc?.length || 0) +
    (recipients.bcc?.length || 0);

  console.log('[MailTracker AI] ============================================');
  console.log('[MailTracker AI] Extraction Summary:');
  console.log('[MailTracker AI]   Sender:', senderEmail || 'Not detected');
  console.log('[MailTracker AI]   To:', recipients.to?.length || 0, recipients.to || []);
  console.log('[MailTracker AI]   CC:', recipients.cc?.length || 0, recipients.cc || []);
  console.log('[MailTracker AI]   BCC:', recipients.bcc?.length || 0, recipients.bcc || []);
  console.log('[MailTracker AI]   Total:', totalRecipients);
  console.log('[MailTracker AI] ============================================');

  if (totalRecipients === 0) {
    console.warn('[MailTracker AI] ⚠️ No recipients found! This might indicate an extraction issue.');
    console.warn('[MailTracker AI] Debug: Run debugExtractRecipients() in console to investigate');

    // Still continue - we'll add a tracking pixel without recipient tokens
    // This allows basic tracking to work even if extraction fails
  } else {
    console.log(`[MailTracker AI] ✅ Successfully extracted ${totalRecipients} recipient(s) before send`);
  }

  // INSTANT INJECTION (ZERO LATENCY)
  // We generate local tokens and inject the pixel BEFORE the register fetch
  // to ensure Gmail sends the email with the pixel even if registration is slow.
  const recipientTokens = {};
  const allEmails = [
    ...(recipients.to || []),
    ...(recipients.cc || []),
    ...(recipients.bcc || [])
  ];

  allEmails.forEach(email => {
    recipientTokens[email] = generateToken();
  });

  if (bodyEl) {
    appendTrackingPixel(bodyEl, uid, recipientTokens);
    rewriteLinks(bodyEl, uid);
    console.log('[MailTracker AI] 🚀 Instant pixel injection completed');
  } else {
    console.warn('[MailTracker AI] ⚠️ Cannot add tracking pixel - body element not found');
  }

  // Register in background - don't await it to block Gmail's send process
  registerMessage({
    uid,
    recipients,
    subject,
    senderEmail,
    recipientTokens // Send our locally generated tokens to the server
  }).catch(err => console.error('[MailTracker AI] Post-send registration failed:', err));

  console.log('[MailTracker AI] ============================================');
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

    // Also inject the UI if we find a compose window
    const composeRoot = recipientExtractor.findComposeRoot(root);
    if (composeRoot) {
      injectComposeUI(composeRoot);
    }
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
