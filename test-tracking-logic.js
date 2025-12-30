#!/usr/bin/env node

// Test the tracking validation logic without needing the full server

const normalizeEmail = (email) => (email || '').toLowerCase().trim();

const validateMessageStats = (message, opens = [], clicks = []) => {
  const sentAtTime = message.sentAt ? new Date(message.sentAt).getTime() : 0;
  const BUFFER_SECONDS = 10; // Reduced buffer - 10 seconds should catch sender previews
  const normalizedSenderEmail = message.senderEmail ? normalizeEmail(message.senderEmail) : null;
  const tokenMap = message.recipientTokens || {};
  const tokens = tokenMap instanceof Map ? Object.fromEntries(tokenMap) : tokenMap;

  console.log(`[Test] Validating stats for message ${message.uid}:`);
  console.log(`[Test]   Sender: ${normalizedSenderEmail}`);
  console.log(`[Test]   Total opens: ${opens.length}`);
  console.log(`[Test]   Sent at: ${message.sentAt}`);

  // 1. Filter opens to get "Valid Human Recipient Opens"
  const validOpens = opens.filter(open => {
    // Determine the email for this open (stored or via token)
    let openEmail = normalizeEmail(open.recipientEmail);

    // Lazy Identification: If no email stored, try matching via token
    if (!openEmail && open.token) {
      const matchingEntry = Object.entries(tokens).find(([_, storedToken]) => storedToken === open.token);
      if (matchingEntry) {
        openEmail = normalizeEmail(matchingEntry[0]);
      }
    }

    const openTime = open.createdAt ? new Date(open.createdAt).getTime() : 0;
    const timeDiffSeconds = (openTime - sentAtTime) / 1000;

    console.log(`[Test]   Checking open: email=${openEmail}, time=${timeDiffSeconds}s after send`);

    // Must have an identified recipient email at this point
    if (!openEmail) {
      console.log(`[Test]     ❌ Rejected: No recipient email identified`);
      return false;
    }

    // Exclude opens where recipient is the sender (viewing own sent email)
    const isSender = normalizedSenderEmail && openEmail === normalizedSenderEmail;
    
    if (isSender) {
      console.log(`[Test]     ❌ Rejected: Sender viewing own email (${openEmail})`);
      return false;
    }

    // Check if this is a proxy/bot open
    if (open.isProxy) {
      console.log(`[Test]     ❌ Rejected: Email proxy/bot open`);
      return false;
    }

    // Only apply time buffer if we suspect it might be a sender preview
    // If the open has a valid recipient email that's different from sender, 
    // and it's not a proxy, then it's likely legitimate even if quick
    const isLikelySenderPreview = timeDiffSeconds < BUFFER_SECONDS && 
                                  (!openEmail || openEmail === normalizedSenderEmail);
    
    if (isLikelySenderPreview) {
      console.log(`[Test]     ❌ Rejected: Likely sender preview (${timeDiffSeconds}s < ${BUFFER_SECONDS}s)`);
      return false;
    }

    // If we have a different recipient email and it's not a proxy, accept it
    // even if it's quick (recipient might open email immediately)
    console.log(`[Test]     ✅ Valid open: ${openEmail} at ${timeDiffSeconds}s`);
    return true;
  });

  console.log(`[Test]   Result: ${validOpens.length} valid opens out of ${opens.length} total`);
  return { openCount: validOpens.length };
};

// Test scenarios
console.log('🧪 Testing MailTracker AI Validation Logic');
console.log('==========================================\n');

const baseTime = new Date('2025-01-01T12:00:00Z');

// Scenario 1: Sender viewing own email immediately (should be filtered)
console.log('📧 Test 1: Sender viewing own email immediately');
const test1 = validateMessageStats(
  {
    uid: 'test1',
    senderEmail: 'sender@example.com',
    sentAt: baseTime,
    recipients: { to: ['recipient@example.com'] }
  },
  [
    {
      recipientEmail: 'sender@example.com', // Sender viewing own email
      createdAt: new Date(baseTime.getTime() + 2000), // 2 seconds later
      isProxy: false
    }
  ]
);
console.log(`Expected: 0 opens, Got: ${test1.openCount}\n`);

// Scenario 2: Legitimate recipient opening email (should NOT be filtered)
console.log('📧 Test 2: Legitimate recipient opening email');
const test2 = validateMessageStats(
  {
    uid: 'test2',
    senderEmail: 'sender@example.com',
    sentAt: baseTime,
    recipients: { to: ['recipient@example.com'] }
  },
  [
    {
      recipientEmail: 'recipient@example.com', // Different from sender
      createdAt: new Date(baseTime.getTime() + 60000), // 1 minute later
      isProxy: false
    }
  ]
);
console.log(`Expected: 1 opens, Got: ${test2.openCount}\n`);

// Scenario 3: Recipient opening email quickly (should NOT be filtered)
console.log('📧 Test 3: Recipient opening email quickly');
const test3 = validateMessageStats(
  {
    uid: 'test3',
    senderEmail: 'sender@example.com',
    sentAt: baseTime,
    recipients: { to: ['recipient@example.com'] }
  },
  [
    {
      recipientEmail: 'recipient@example.com', // Different from sender
      createdAt: new Date(baseTime.getTime() + 5000), // 5 seconds later
      isProxy: false
    }
  ]
);
console.log(`Expected: 1 opens, Got: ${test3.openCount}\n`);

// Scenario 4: Unknown email opening quickly (should be filtered)
console.log('📧 Test 4: Unknown email opening quickly');
const test4 = validateMessageStats(
  {
    uid: 'test4',
    senderEmail: 'sender@example.com',
    sentAt: baseTime,
    recipients: { to: ['recipient@example.com'] }
  },
  [
    {
      recipientEmail: null, // No email identified
      createdAt: new Date(baseTime.getTime() + 5000), // 5 seconds later
      isProxy: false
    }
  ]
);
console.log(`Expected: 0 opens, Got: ${test4.openCount}\n`);

// Scenario 5: Proxy/bot open (should be filtered)
console.log('📧 Test 5: Email proxy/bot open');
const test5 = validateMessageStats(
  {
    uid: 'test5',
    senderEmail: 'sender@example.com',
    sentAt: baseTime,
    recipients: { to: ['recipient@example.com'] }
  },
  [
    {
      recipientEmail: 'recipient@example.com',
      createdAt: new Date(baseTime.getTime() + 60000), // 1 minute later
      isProxy: true // Email proxy
    }
  ]
);
console.log(`Expected: 0 opens, Got: ${test5.openCount}\n`);

console.log('🏁 Test completed!');
console.log('If all tests show expected results, the logic should work correctly.');