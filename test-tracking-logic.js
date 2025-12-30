#!/usr/bin/env node

// Test the tracking validation logic without needing the full server

const normalizeEmail = (email) => (email || '').toLowerCase().trim();

const validateMessageStats = (message, opens = [], clicks = []) => {
  const sentAtTime = message.sentAt ? new Date(message.sentAt).getTime() : 0;
  const BUFFER_SECONDS = 15; // Increased buffer - opens within 15s are likely sender previews
  const normalizedSenderEmail = message.senderEmail ? normalizeEmail(message.senderEmail) : null;
  const tokenMap = message.recipientTokens || {};
  const tokens = tokenMap instanceof Map ? Object.fromEntries(tokenMap) : tokenMap;

  console.log(`[Test] Validating stats for message ${message.uid}:`);
  console.log(`[Test]   Sender: ${normalizedSenderEmail}`);
  console.log(`[Test]   Total opens: ${opens.length}`);

  // Group opens by recipient for better analysis
  const opensByRecipient = {};
  
  opens.forEach(open => {
    let openEmail = normalizeEmail(open.recipientEmail);

    // Lazy Identification: If no email stored, try matching via token
    if (!openEmail && open.token) {
      const matchingEntry = Object.entries(tokens).find(([_, storedToken]) => storedToken === open.token);
      if (matchingEntry) {
        openEmail = normalizeEmail(matchingEntry[0]);
      }
    }

    if (openEmail) {
      if (!opensByRecipient[openEmail]) {
        opensByRecipient[openEmail] = [];
      }
      opensByRecipient[openEmail].push(open);
    }
  });

  // Filter opens
  const validOpens = opens.filter(open => {
    let openEmail = normalizeEmail(open.recipientEmail);

    if (!openEmail && open.token) {
      const matchingEntry = Object.entries(tokens).find(([_, storedToken]) => storedToken === open.token);
      if (matchingEntry) {
        openEmail = normalizeEmail(matchingEntry[0]);
      }
    }

    const openTime = open.createdAt ? new Date(open.createdAt).getTime() : 0;
    const timeDiffSeconds = (openTime - sentAtTime) / 1000;

    console.log(`[Test]   Checking open: email=${openEmail}, time=${timeDiffSeconds}s, proxy=${open.isProxy}, token=${open.token ? 'YES' : 'NO'}`);

    if (!openEmail) {
      console.log(`[Test]     ❌ Rejected: No recipient email identified`);
      return false;
    }

    const isSender = normalizedSenderEmail && openEmail === normalizedSenderEmail;
    
    if (isSender) {
      console.log(`[Test]     ❌ Rejected: Sender viewing own email`);
      return false;
    }

    // STRICT TIME FILTERING: Any open within 15 seconds is suspicious
    if (timeDiffSeconds < BUFFER_SECONDS) {
      console.log(`[Test]     ❌ Rejected: Too soon after send (${timeDiffSeconds}s < ${BUFFER_SECONDS}s)`);
      return false;
    }

    // Additional check: Opens without tokens are more suspicious
    if (!open.token && timeDiffSeconds < 30) {
      console.log(`[Test]     ❌ Rejected: No token and quick open (${timeDiffSeconds}s)`);
      return false;
    }

    // Handle proxy opens more intelligently
    if (open.isProxy) {
      const recipientOpens = opensByRecipient[openEmail] || [];
      const nonProxyOpens = recipientOpens.filter(o => !o.isProxy);
      
      if (nonProxyOpens.length === 0 && timeDiffSeconds > 60) {
        console.log(`[Test]     ⚠️  Accepting proxy open: Only open for ${openEmail} after ${timeDiffSeconds}s`);
        return true;
      } else {
        console.log(`[Test]     ❌ Rejected: Email proxy/bot open`);
        return false;
      }
    }

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

// Test with your actual data
console.log('📧 Test 6: Your actual email scenario');
const test6 = validateMessageStats(
  {
    uid: '4e6462cf-b81d-471d-8cee-47e8dfe1a9e4',
    senderEmail: 'divyarajsinh.jadeja@bytestechnolab.com',
    sentAt: new Date('2025-12-30T07:25:48.455Z'),
    recipients: { 
      to: ['darshan.vachhani+105@bytestechnolab.com'],
      cc: [],
      bcc: ['divyarajsinh.jadeja@bytestechnolab.com']
    },
    recipientTokens: {
      'darshan.vachhani+105@bytestechnolab.com': '1b821e0190d5e11f147b40021ef13944',
      'divyarajsinh.jadeja@bytestechnolab.com': '0e2314896a57ef4cd926f92de0f5257e'
    }
  },
  [
    {
      recipientEmail: null, // First open - no email identified
      createdAt: new Date('2025-12-30T07:25:48.759Z'), // 0.3s after send
      isProxy: false,
      token: null
    },
    {
      recipientEmail: 'darshan.vachhani+105@bytestechnolab.com', // Second open - recipient
      createdAt: new Date('2025-12-30T07:27:05.690Z'), // 77s after send
      isProxy: true, // Gmail proxy
      token: null
    }
  ]
);
console.log(`Expected: 1 opens (proxy should be accepted), Got: ${test6.openCount}\n`);

// Test with your actual problematic data
console.log('📧 Test 7: Your problematic email (should now be filtered)');
const test7 = validateMessageStats(
  {
    uid: '751e5d16-0149-40a2-9c29-70745c483eff',
    senderEmail: 'divyarajsinh.jadeja@bytestechnolab.com',
    sentAt: new Date('2025-12-30T07:44:04.670Z'),
    recipients: { 
      to: ['darshan.vachhani+105@bytestechnolab.com'],
      cc: [],
      bcc: ['divyarajsinh.jadeja@bytestechnolab.com']
    },
    recipientTokens: {
      'darshan.vachhani+105@bytestechnolab.com': '9e818cabe7555b228c4d34e635767add',
      'divyarajsinh.jadeja@bytestechnolab.com': 'ba64fa69d8a71f2aa0c1e79781d5a94a'
    }
  },
  [
    {
      recipientEmail: 'darshan.vachhani+105@bytestechnolab.com',
      createdAt: new Date('2025-12-30T07:44:05.603Z'), // 0.933s after send
      isProxy: false,
      token: null // No token!
    }
  ]
);
console.log(`Expected: 0 opens (should be filtered), Got: ${test7.openCount}\n`);

console.log('🏁 Test completed!');
console.log('The problematic email should now be filtered out with stricter rules.');