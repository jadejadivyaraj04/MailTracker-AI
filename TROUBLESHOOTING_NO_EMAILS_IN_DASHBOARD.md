# 🔍 DEBUGGING: Email Not Showing in Dashboard

## 🔴 PROBLEM: Sent email to jadejadivyaraj7@gmail.com but nothing appears in dashboard

Let's debug this step by step!

---

## ✅ **STEP 1: Check Extension is Loaded**

### **Test in Browser Console:**

1. **Open Gmail**
2. **Press F12** (DevTools)
3. **Console tab**
4. **Type this command:**
```javascript
typeof recipientExtractor
```

**Expected:** `"object"`
**If you see:** `"undefined"` → Extension not loaded!

### **Fix if Extension Not Loaded:**

1. Go to `chrome://extensions`
2. Find "MailTracker AI"
3. Make sure it's **enabled** ✅
4. Click **Reload** button 🔄
5. **Refresh Gmail**

---

## ✅ **STEP 2: Check Browser Console Logs When Sending**

### **Test:**

1. **Compose new email** in Gmail
2. **Open DevTools** (F12) → Console
3. **Add recipient:** jadejadivyaraj7@gmail.com
4. **Add subject:** "Test tracking"
5. **Click Send**

### **Expected Console Output:**

```
[MailTracker AI] Send button clicked - Starting extraction
[MailTracker AI] ✅ Found compose root
[MailTracker AI] Generated UID: a3f5e6d2-8c9b-4a1e-9f2d-7b3c8e4f6a5d
[MailTracker AI] Sender email: your@email.com
[MailTracker AI] Extraction Summary:
  Sender: your@email.com
  To: 1 [ 'jadejadivyaraj7@gmail.com' ]
  Total: 1
[MailTracker AI] Registering message: { ... }
[MailTracker AI] Message registered successfully: {
  ok: true,
  recipientTokens: { 'jadejadivyaraj7@gmail.com': '...' }
}
[MailTracker AI] Added tracking pixels for 1 recipients
```

### **If You See ERRORS:**

#### **Error: "Failed to fetch" or "net::ERR_CONNECTION_REFUSED"**
```
❌ Backend is DOWN or URL is WRONG
```

**Fix:**
1. Check backend URL in `extension/content_script.js` line 4
2. Should be: `https://mailtracker-ai.onrender.com`
3. Verify backend is running on Render

#### **Error: "CORS policy"**
```
❌ Backend CORS not configured
```

**Fix:**
1. Check `server/server.js` has:
```javascript
app.use(cors({ origin: "*" }))
```

#### **Error: "Register error"**
```
❌ Backend registration endpoint failing
```

**Copy the full error message and share with me!**

---

## ✅ **STEP 3: Check Backend is Running**

### **Test Backend Health:**

**Open in browser:**
```
https://mailtracker-ai.onrender.com/health
```

**Expected Response:**
```json
{"status":"ok","uptime":123}
```

**If you see:**
- ❌ "This site can't be reached" → Backend is DOWN
- ❌ "Not Found" → Backend URL is wrong
- ✅ {"status":"ok"} → Backend is UP

### **Check Render Dashboard:**

1. Go to https://dashboard.render.com/
2. Find your backend service
3. Check status: Should be **"Live"** 🟢
4. Click on it → View **Logs**
5. Look for: `[MailTracker AI] Server listening on port 5000`

---

## ✅ **STEP 4: Check Extension Configuration**

### **Check UserId:**

1. **Click extension icon** in Chrome toolbar
2. **Check "User ID" field**
3. **What does it say?**

**Common Issue:** UserId in extension ≠ UserId in dashboard

**Example:**
```
Extension UserId: "default"
Dashboard Login: "your@email.com"
Result: No messages shown (mismatch!)
```

**Fix:**
1. Extension popup → Set UserId to: **your@email.com**
2. Dashboard → Login with: **your@email.com**
3. **MUST BE IDENTICAL!**

---

## ✅ **STEP 5: Verify Message was Registered**

### **Test Registration Manually:**

**Open Terminal and run:**

```bash
curl -X POST https://mailtracker-ai.onrender.com/register \
  -H "Content-Type: application/json" \
  -d '{
    "uid": "test-123",
    "recipients": {
      "to": ["jadejadivyaraj7@gmail.com"]
    },
    "subject": "Test",
    "senderEmail": "your@email.com",
    "userId": "YOUR_USER_ID_HERE"
  }'
```

**Replace:** `YOUR_USER_ID_HERE` with your actual userId

**Expected Response:**
```json
{
  "ok": true,
  "recipientTokens": {
    "jadejadivyaraj7@gmail.com": "abc123..."
  }
}
```

**If you get error:**
```json
{
  "error": "Failed to save message metadata",
  "details": "..."
}
```

**Share the "details" with me!**

---

## ✅ **STEP 6: Check MongoDB Database**

### **MongoDB Atlas:**

1. Go to https://cloud.mongodb.com/
2. **Browse Collections**
3. **Check `messages` collection**

**Expected:** Should have at least one document

**If empty:** Messages not being saved to database!

**Check:**
- Is MongoDB connection string correct in Render?
- Environment variable `MONGO_URI` set?
- Database user has write permissions?

---

## ✅ **STEP 7: Check Dashboard API**

### **Test Dashboard API:**

**Open in browser:**
```
https://mailtracker-ai.onrender.com/stats/user/YOUR_USER_ID
```

**Replace** `YOUR_USER_ID` with your actual userId (e.g., `your@email.com`)

**If userId has special characters, URL encode it:**
```
your@email.com → your%40email.com

Example:
https://mailtracker-ai.onrender.com/stats/user/your%40email.com
```

**Expected Response:**
```json
{
  "userId": "your@email.com",
  "totalMessages": 1,
  "totalOpens": 0,
  "totalClicks": 0,
  "messages": [
    {
      "uid": "...",
      "subject": "Test tracking",
      "recipients": {
        "to": ["jadejadivyaraj7@gmail.com"]
      },
      "openCount": 0
    }
  ]
}
```

**If you see:**
```json
{
  "userId": "your@email.com",
  "totalMessages": 0,
  "messages": []
}
```

**This means:** Messages are saved but with DIFFERENT userId!

---

## 🔧 **QUICK DIAGNOSTIC CHECKLIST**

Run through this checklist:

```
□ Extension loaded? (chrome://extensions)
□ Extension enabled? (toggle is ON)
□ Backend running? (https://mailtracker-ai.onrender.com/health)
□ Backend deployed? (Check Render dashboard)
□ MongoDB connected? (Check Render logs)
□ UserId matches? (Extension popup vs Dashboard login)
□ Console shows "Message registered successfully"?
□ No errors in browser console?
□ No errors in backend logs?
```

---

## 🎯 **MOST COMMON ISSUES**

### **Issue #1: UserId Mismatch** (90% of cases!)

**Problem:**
```
Extension: userId = "default"
Dashboard: Login = "jadejadivyaraj04@gmail.com"
Result: Dashboard shows "No messages" ❌
```

**Fix:**
```
1. Click extension icon
2. Set User ID to: jadejadivyaraj04@gmail.com
3. Dashboard login: jadejadivyaraj04@gmail.com
4. Send test email
5. Refresh dashboard ✅
```

### **Issue #2: Backend Not Deployed**

**Problem:**
```
You made code changes but didn't deploy
```

**Fix:**
```bash
cd server
git add .
git commit -m "Deploy latest changes"
git push
# Wait 2 minutes for Render to deploy
```

### **Issue #3: Extension Not Reloaded**

**Problem:**
```
Changed extension code but Chrome still uses old version
```

**Fix:**
```
1. chrome://extensions
2. Find MailTracker AI
3. Click reload button 🔄
4. Refresh Gmail
5. Try again
```

---

## 📋 **DEBUGGING SCRIPT**

**Copy-paste this in browser console to check everything:**

```javascript
// Debugging Script
console.log("=== MailTracker AI Debug Info ===");

// Check extension loaded
console.log("1. Extension loaded:", typeof recipientExtractor !== 'undefined' ? "✅ YES" : "❌ NO");

// Check backend base URL
console.log("2. Backend URL:", MAILTRACKER_BACKEND_BASE);

// Check userId
chrome.storage.sync.get(['userId', 'trackingEnabled'], (result) => {
  console.log("3. Extension UserId:", result.userId || 'default');
  console.log("4. Tracking enabled:", result.trackingEnabled ? "✅ YES" : "❌ NO");
  
  // Test backend health
  fetch(`${MAILTRACKER_BACKEND_BASE}/health`)
    .then(r => r.json())
    .then(data => {
      console.log("5. Backend status:", "✅ ONLINE", data);
    })
    .catch(err => {
      console.log("5. Backend status:", "❌ OFFLINE", err.message);
    });
  
  // Test stats endpoint
  const userId = result.userId || 'default';
  fetch(`${MAILTRACKER_BACKEND_BASE}/stats/user/${encodeURIComponent(userId)}`)
    .then(r => r.json())
    .then(data => {
      console.log("6. Messages in database:", data.totalMessages || 0);
      console.log("7. Full response:", data);
    })
    .catch(err => {
      console.log("6. Stats API error:", err.message);
    });
});

console.log("=== Check results above ===");
```

**Paste this in console and share the output with me!**

---

## 🆘 **EMERGENCY FIX: Reset Everything**

If nothing works, try this:

### **1. Reset Extension:**
```
1. chrome://extensions
2. Remove "MailTracker AI"
3. Load unpacked again from extension folder
4. Set userId: jadejadivyaraj04@gmail.com
5. Enable tracking
```

### **2. Redeploy Backend:**
```bash
cd server
git add .
git commit -m "Redeploy" --allow-empty
git push
```

### **3. Clear Browser Data:**
```
1. Open Gmail
2. F12 → Console
3. Type: localStorage.clear()
4. Refresh page
```

### **4. Send Test Email:**
```
1. Open DevTools BEFORE sending
2. Watch console for errors
3. Send email
4. Check if "Message registered successfully" appears
```

---

## 📞 **SHARE THIS INFO WITH ME**

To help you faster, please share:

**1. Browser Console Output:**
```
(Copy everything from console when you send email)
```

**2. Backend URL Test:**
```
Result of: https://mailtracker-ai.onrender.com/health
```

**3. Stats API Test:**
```
Result of: https://mailtracker-ai.onrender.com/stats/user/YOUR_USER_ID
```

**4. Extension Settings:**
```
User ID: ?
Tracking Enabled: ?
```

**5. Render Backend Logs:**
```
(Last 20 lines from Render dashboard)
```

**6. MongoDB Collections:**
```
Number of documents in 'messages' collection: ?
```

I'll help you fix it! 🚀

---

## ✅ **EXPECTED WORKING STATE**

When everything is working correctly:

**1. Send Email:**
```
Console: "Message registered successfully"
Console: "Added tracking pixels for 1 recipients"
```

**2. Backend Logs:**
```
[MailTracker AI] Registering message: { uid, subject, ... }
```

**3. MongoDB:**
```
messages collection has new document
```

**4. Dashboard:**
```
Shows email with subject and recipient
Status: "Not Read" (until recipient opens)
```

Let me know what you find! 🔍
