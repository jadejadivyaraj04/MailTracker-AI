# 📸 Tracking Pixel - Complete Example & Code Flow

## 🎯 What is a Tracking Pixel?

A **tracking pixel** is a **1×1 pixel transparent image** embedded in an email. When the email is opened, the recipient's email client loads the image, which sends an HTTP request to your server - this tells you the email was opened!

---

## 📧 COMPLETE EXAMPLE: Send & Track an Email

Let's walk through a **real example** of sending an email and tracking when it's opened.

---

## 🔹 STEP 1: User Sends Email in Gmail

**User Action:**
```
From: john@example.com
To: jane@example.com
Subject: Project Update
Body: Hi Jane, here's the update...
```

---

## 🔹 STEP 2: Extension Intercepts Send Button

**File:** `extension/content_script.js` (Line 1367-1456)

```javascript
// When user clicks Send button in Gmail
const handleSendClick = async (event) => {
  // 1. Generate unique ID for this email
  const uid = generateUUID();
  // Result: "a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d"
  
  // 2. Extract recipients
  const recipients = await extractRecipientsWithRetry(composeRoot);
  // Result: { to: ["jane@example.com"] }
  
  // 3. Extract subject
  const subject = subjectInput.value;
  // Result: "Project Update"
  
  // 4. Extract sender (NEW!)
  const senderEmail = recipientExtractor.extractSender(composeRoot);
  // Result: "john@example.com"
  
  // 5. Register with backend
  const recipientTokens = await registerMessage({ 
    uid, 
    recipients, 
    subject, 
    senderEmail 
  });
  // Result: { "jane@example.com": "abc123def456..." }
  
  // 6. Inject tracking pixel
  appendTrackingPixel(bodyEl, uid, recipientTokens);
};
```

---

## 🔹 STEP 3: Register Message with Backend

**Extension → Backend API Call**

**Request:**
```javascript
POST https://mailtracker-ai.onrender.com/register
Content-Type: application/json

{
  "uid": "a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d",
  "recipients": {
    "to": ["jane@example.com"],
    "cc": [],
    "bcc": []
  },
  "subject": "Project Update",
  "senderEmail": "john@example.com",
  "timestamp": "2025-11-21T09:00:00.000Z",
  "userId": "john@example.com"
}
```

**Backend Code:** `server/routes/track.js` (Line 23-80)

```javascript
router.post('/register', async (req, res) => {
  const { uid, recipients, subject, senderEmail } = req.body;
  
  // Generate unique token for each recipient
  const recipientTokens = {};
  const allRecipients = [
    ...recipients.to,   // ["jane@example.com"]
    ...recipients.cc,   // []
    ...recipients.bcc   // []
  ];
  
  // For each recipient, create a unique token
  allRecipients.forEach(email => {
    const token = crypto.randomBytes(16).toString('hex');
    recipientTokens[email] = token;
    // jane@example.com → "abc123def456789..."
  });
  
  // Save to database
  await Message.create({
    uid: "a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d",
    userId: "john@example.com",
    senderEmail: "john@example.com",
    subject: "Project Update",
    recipients: {
      to: ["jane@example.com"],
      cc: [],
      bcc: []
    },
    recipientTokens: {
      "jane@example.com": "abc123def456789..."
    },
    sentAt: new Date("2025-11-21T09:00:00.000Z")
  });
  
  // Return tokens to extension
  return res.json({ 
    ok: true, 
    recipientTokens: {
      "jane@example.com": "abc123def456789..."
    }
  });
});
```

**Response:**
```json
{
  "ok": true,
  "recipientTokens": {
    "jane@example.com": "abc123def456789..."
  }
}
```

---

## 🔹 STEP 4: Inject Tracking Pixel into Email Body

**Extension Code:** `extension/content_script.js` (Line 1182-1225)

```javascript
const appendTrackingPixel = (bodyEl, uid, recipientTokens) => {
  // recipientTokens = { "jane@example.com": "abc123def456789..." }
  
  Object.entries(recipientTokens).forEach(([email, token]) => {
    // email = "jane@example.com"
    // token = "abc123def456789..."
    
    // Create pixel URL with uid AND token
    const pixelUrl = 
      `https://mailtracker-ai.onrender.com/pixel?uid=${uid}&token=${token}`;
    // Result: 
    // https://mailtracker-ai.onrender.com/pixel?
    //   uid=a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d&
    //   token=abc123def456789...
    
    // Create invisible 1x1 image
    const pixelImg = document.createElement('img');
    pixelImg.src = pixelUrl;
    pixelImg.width = 1;
    pixelImg.height = 1;
    pixelImg.style.display = 'none';
    pixelImg.alt = '';
    pixelImg.setAttribute('data-recipient', email);
    
    // Add to email body
    bodyEl.appendChild(pixelImg);
  });
  
  console.log('Added tracking pixels for', Object.keys(recipientTokens).length, 'recipients');
};
```

**Resulting Email HTML:**
```html
<div class="email-body">
  <p>Hi Jane, here's the update...</p>
  
  <!-- Original content above -->
  
  <!-- Tracking pixel added by extension -->
  <img src="https://mailtracker-ai.onrender.com/pixel?uid=a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d&token=abc123def456789..." 
       width="1" 
       height="1" 
       style="display:none" 
       alt="" 
       data-recipient="jane@example.com">
</div>
```

**Email is now sent with the invisible pixel!** 🚀

---

## 🔹 STEP 5: Recipient Opens Email

**Jane opens the email in her email client (Gmail, Outlook, etc.)**

**What happens:**
1. Email client renders the HTML
2. Finds the `<img>` tag
3. Makes HTTP GET request to load the image
4. **This is when tracking happens!**

**Browser Request:**
```
GET https://mailtracker-ai.onrender.com/pixel?uid=a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d&token=abc123def456789...

Headers:
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)...
  Referer: https://mail.google.com/...
  X-Forwarded-For: 203.0.113.45
```

---

## 🔹 STEP 6: Backend Receives Pixel Request

**Backend Code:** `server/routes/track.js` (Line 96-172)

```javascript
router.get('/pixel', async (req, res) => {
  // Extract parameters from URL
  const { uid, token } = req.query;
  // uid = "a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d"
  // token = "abc123def456789..."
  
  // Get client info
  const ip = getClientIp(req);
  // ip = "203.0.113.45"
  
  const userAgent = req.headers['user-agent'];
  // userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)..."
  
  // Find the message in database
  const message = await Message.findOne({ uid });
  // message = {
  //   uid: "a3f5e6d2...",
  //   senderEmail: "john@example.com",
  //   recipients: { to: ["jane@example.com"] },
  //   recipientTokens: { "jane@example.com": "abc123def456789..." },
  //   sentAt: "2025-11-21T09:00:00.000Z"
  // }
  
  let recipientEmail = null;
  
  // Validate token to identify WHO opened
  if (message && message.recipientTokens && token) {
    const tokens = message.recipientTokens;
    
    // Find which recipient this token belongs to
    const matchingEntry = Object.entries(tokens).find(
      ([email, storedToken]) => storedToken === token
    );
    
    if (matchingEntry) {
      recipientEmail = matchingEntry[0];
      // recipientEmail = "jane@example.com"
      console.log('Recipient identified:', recipientEmail);
    }
  }
  
  // Create OpenEvent in database
  await OpenEvent.create({
    messageUid: uid,
    recipientEmail: recipientEmail,  // "jane@example.com"
    ipHash: hashIp(ip, userAgent),   // Hashed for privacy
    userAgent: userAgent,
    createdAt: new Date("2025-11-21T09:15:30.000Z")
  });
  
  console.log('OpenEvent created for:', recipientEmail);
  
  // Return 1x1 transparent GIF image
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.end(PIXEL_BUFFER);
  // PIXEL_BUFFER = tiny transparent GIF (43 bytes)
});
```

**Database Record Created:**

**Collection: `openevents`**
```json
{
  "_id": "674f1e2a3b4c5d6e7f8a9b0c",
  "messageUid": "a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d",
  "recipientEmail": "jane@example.com",
  "ipHash": "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d...",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
  "createdAt": "2025-11-21T09:15:30.000Z"
}
```

**Email is now marked as OPENED!** ✅

---

## 🔹 STEP 7: Dashboard Shows "Read" Status

**User (John) opens dashboard:**

**Request:**
```
GET https://mailtracker-ai.onrender.com/stats/user/john@example.com
```

**Backend Code:** `server/routes/track.js` (Line 309-439)

```javascript
router.get('/stats/user/:userId', async (req, res) => {
  const userId = req.params.userId; // "john@example.com"
  
  // Get all messages sent by this user
  const messages = await Message.find({ userId });
  
  // Get all open events for these messages
  const detailedOpens = await OpenEvent.find({ 
    messageUid: { $in: messages.map(m => m.uid) } 
  });
  
  // For each message, calculate recipient status
  messages.forEach(message => {
    const recipients = message.recipients.to || [];
    
    recipients.forEach(recipientEmail => {
      // Find opens for this specific recipient
      const opens = detailedOpens.filter(open => 
        open.messageUid === message.uid &&
        open.recipientEmail === recipientEmail
      );
      
      // Check if any valid opens exist
      const sentAtTime = new Date(message.sentAt).getTime();
      const BUFFER_SECONDS = 30;
      const senderEmail = message.senderEmail;
      
      const validOpen = opens.find(open => {
        // Exclude if recipient is sender
        if (senderEmail && open.recipientEmail === senderEmail) {
          return false; // Sender viewing own email
        }
        
        // Exclude if opened too soon (< 30s after send)
        const openTime = new Date(open.createdAt).getTime();
        const timeDiff = (openTime - sentAtTime) / 1000;
        
        if (timeDiff < BUFFER_SECONDS) {
          return false; // Too soon, likely sender preview
        }
        
        return true; // Valid recipient open!
      });
      
      // Set read status
      if (validOpen) {
        return {
          email: recipientEmail,
          read: true,           // ✅ MARKED AS READ
          readAt: validOpen.createdAt
        };
      } else {
        return {
          email: recipientEmail,
          read: false,          // ❌ NOT READ YET
          readAt: null
        };
      }
    });
  });
  
  return res.json({ messages: summary });
});
```

**Response:**
```json
{
  "userId": "john@example.com",
  "totalMessages": 1,
  "totalOpens": 1,
  "messages": [
    {
      "uid": "a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d",
      "subject": "Project Update",
      "sentAt": "2025-11-21T09:00:00.000Z",
      "recipients": {
        "to": ["jane@example.com"]
      },
      "openCount": 1,
      "lastOpenedAt": "2025-11-21T09:15:30.000Z",
      "recipientStatus": [
        {
          "email": "jane@example.com",
          "read": true,
          "readAt": "2025-11-21T09:15:30.000Z"
        }
      ]
    }
  ]
}
```

**Dashboard displays:**
```
✅ Project Update
   To: jane@example.com
   Opened: 15 minutes ago (9:15 AM)
   Status: READ
```

---

## 📊 COMPLETE CODE FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER SENDS EMAIL IN GMAIL                               │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. EXTENSION INTERCEPTS SEND                                │
│    - Generates UID: a3f5e6d2...                             │
│    - Extracts recipients: jane@example.com                  │
│    - Extracts sender: john@example.com                      │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. EXTENSION → BACKEND: /register                           │
│    POST { uid, recipients, subject, senderEmail }           │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. BACKEND GENERATES TOKENS                                 │
│    jane@example.com → abc123def456...                       │
│    Saves to MongoDB messages collection                     │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. BACKEND → EXTENSION: Response                            │
│    { ok: true, recipientTokens: {...} }                     │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. EXTENSION INJECTS PIXEL INTO EMAIL                       │
│    <img src="...pixel?uid=...&token=..." 1x1 hidden>        │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. EMAIL SENT WITH PIXEL                                    │
│    Gmail sends email to jane@example.com                    │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. RECIPIENT OPENS EMAIL                                    │
│    Jane opens email in her Gmail                            │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. EMAIL CLIENT LOADS PIXEL IMAGE                           │
│    GET .../pixel?uid=a3f5e6d2...&token=abc123...            │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. BACKEND RECEIVES PIXEL REQUEST                          │
│     - Validates token                                       │
│     - Identifies recipient: jane@example.com                │
│     - Checks not sender (john ≠ jane) ✅                    │
│     - Checks time > 30s after send ✅                       │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 11. BACKEND CREATES OPENEVENT                               │
│     MongoDB openevents collection:                          │
│     { messageUid, recipientEmail, createdAt }               │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 12. BACKEND RETURNS PIXEL IMAGE                             │
│     1x1 transparent GIF (43 bytes)                          │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 13. USER CHECKS DASHBOARD                                   │
│     GET /stats/user/john@example.com                        │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 14. DASHBOARD SHOWS "READ" STATUS                           │
│     ✅ jane@example.com - Opened 15 min ago                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 PIXEL IMAGE FORMAT

**What exactly is the pixel?**

```javascript
// Base64 encoded 1x1 transparent GIF
const PIXEL_BUFFER = Buffer.from(
  'R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 
  'base64'
);
```

**Decoded, this is:**
- **43 bytes** in size
- **1×1 pixel** GIF image
- **Fully transparent** (invisible)
- **Valid image** format

When rendered in browser:
```
Width: 1px
Height: 1px
Color: Transparent
Visible: NO (display: none)
```

**You literally cannot see it!** 👻

---

## 💾 DATABASE STRUCTURE

### **messages Collection:**
```javascript
{
  _id: ObjectId("674f1e2a3b4c5d6e7f8a9b0c"),
  uid: "a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d",
  userId: "john@example.com",
  senderEmail: "john@example.com",
  subject: "Project Update",
  recipients: {
    to: ["jane@example.com"],
    cc: [],
    bcc: []
  },
  recipientTokens: {
    "jane@example.com": "abc123def456789..."
  },
  sentAt: ISODate("2025-11-21T09:00:00.000Z"),
  createdAt: ISODate("2025-11-21T09:00:00.000Z"),
  updatedAt: ISODate("2025-11-21T09:00:00.000Z")
}
```

### **openevents Collection:**
```javascript
{
  _id: ObjectId("674f1f3a4b5c6d7e8f9a0b1c"),
  messageUid: "a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d",
  recipientEmail: "jane@example.com",
  ipHash: "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...",
  createdAt: ISODate("2025-11-21T09:15:30.000Z")
}
```

---

## 🎯 KEY FEATURES

### **1. Token-Based Recipient Identification** 🔐
```javascript
// Each recipient gets unique token
recipientTokens: {
  "jane@example.com": "abc123",
  "bob@example.com": "def456",
  "alice@example.com": "ghi789"
}

// Pixel URLs are unique per recipient
jane's pixel: ...pixel?uid=xxx&token=abc123
bob's pixel:  ...pixel?uid=xxx&token=def456
alice's pixel: ...pixel?uid=xxx&token=ghi789

// When pixel loads, we know EXACTLY who opened!
```

### **2. Sender Exclusion** 🚫
```javascript
// Prevent false positives
if (open.recipientEmail === message.senderEmail) {
  // Sender viewing own sent email - DON'T COUNT
  return false;
}
```

### **3. Time Buffer** ⏱️
```javascript
// Ignore opens within 30s of sending
const timeDiff = (openTime - sentTime) / 1000;
if (timeDiff < 30) {
  // Too soon, likely sender preview - DON'T COUNT
  return false;
}
```

### **4. Privacy Protection** 🔒
```javascript
// IP addresses are hashed, not stored raw
const hashIp = (ip, userAgent) => {
  return crypto
    .createHash('sha256')
    .update(`${ip}|${userAgent}`)
    .digest('hex');
};
```

---

## 🧪 TEST IT YOURSELF

### **Step 1: Send Test Email**
1. Open Gmail
2. Compose email to yourself
3. Send
4. Check console for:
```
[MailTracker AI] Generated UID: a3f5e6d2...
[MailTracker AI] Message registered successfully
[MailTracker AI] Added tracking pixels for 1 recipients
```

### **Step 2: View Email Source**
1. Open sent email
2. Click "Show original"
3. Search for "mailtracker-ai"
4. You should find:
```html
<img src="https://mailtracker-ai.onrender.com/pixel?uid=...&token=..." 
     width="1" height="1" style="display:none">
```

### **Step 3: Test Pixel Loading**
1. Copy the pixel URL
2. Paste in browser address bar
3. You'll see blank page (pixel loaded!)
4. Check backend logs for:
```
[MailTracker AI] Pixel loaded - Recipient identified via token
[MailTracker AI] OpenEvent created
```

### **Step 4: Check Database**
1. MongoDB Atlas → Browse Collections
2. Check `messages` → Should have your email
3. Check `openevents` → Should have open record

### **Step 5: View Dashboard**
1. Open dashboard
2. Login with your email
3. Should see your email with "Read" status

---

## 📋 SUMMARY

**The pixel is:**
- ✅ A **1×1 transparent GIF image** (43 bytes)
- ✅ Embedded in **email HTML** via `<img>` tag
- ✅ **Invisible** to recipient (`display: none`)
- ✅ Loaded automatically when email is opened
- ✅ Contains **unique token** to identify recipient
- ✅ Sends **HTTP request** to backend
- ✅ Backend **logs open event** to database
- ✅ Dashboard **displays read status**

**The system prevents false positives by:**
- ❌ Excluding opens from **sender**
- ❌ Excluding opens within **30 seconds** of sending
- ❌ Hashing **IP addresses** for privacy

**This is the same technology used by:**
- Mailchimp, SendGrid, HubSpot (email marketing)
- Superhuman, Mailtrack, Yesware (email tracking)
- Amazon, eBay (order confirmations)

You now have a professional-grade email tracking system! 🎉
