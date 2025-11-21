# 🔍 DEBUG: Specific Email Not Showing as Read

## 📧 Email Details from Image:

```
From: divyarajsinh.jadeja@bytestechnolab.com
To:   jadejadivyaraj7@gmail.com
Date: Nov 21, 2025, 3:42 PM
Subject: Test
```

**Good:** Different sender/recipient emails! ✅

---

## 🎯 **CRITICAL CHECKS**

### **CHECK 1: Is pixel in the email?**

1. **Open the test email** at jadejadivyaraj7@gmail.com
2. **Click** ⋮ (three dots)
3. **Click "Show original"**
4. **Press Ctrl+F** (Find)
5. **Search for:** `mailtracker-ai`

**Expected to find:**
```html
<img src="https://mailtracker-ai.onrender.com/pixel?uid=...&token=..." 
     width="1" height="1" style="display:none">
```

### **Result:**
- [ ] ✅ Found pixel URL
- [ ] ❌ Pixel NOT found - Extension didn't inject it!

---

### **CHECK 2: Did extension register the message?**

**When you sent this email, did you see in browser console:**

```
[MailTracker AI] Message registered successfully
[MailTracker AI] Added tracking pixels for 1 recipients
```

- [ ] ✅ YES - Extension worked
- [ ] ❌ NO - Extension didn't run

---

### **CHECK 3: What userId was used?**

**Critical:** Extension userId MUST match dashboard login!

**Check extension userId:**
1. Click extension icon
2. What does "User ID" field show?

**Possibilities:**
- `divyarajsinh.jadeja@bytestechnolab.com`
- `jadejadivyaraj7@gmail.com`
- `default`
- Something else?

**Dashboard login:**
- What userId did you login with?

**These MUST match!** ✅

---

### **CHECK 4: Backend logs**

1. **Go to:** https://dashboard.render.com/
2. **Click** backend service (mailtracker-ai)
3. **View Logs**
4. **Look for logs around 3:42 PM**

**Search for:**
```
[MailTracker AI] Pixel loaded
[MailTracker AI] Recipient identified via token: jadejadivyaraj7@gmail.com
[MailTracker AI] OpenEvent created
```

**Also check for:**
```
[MailTracker AI] Excluding sender open
```

- [ ] ✅ Pixel loaded, OpenEvent created
- [ ] ❌ No pixel logs - Email not opened OR images blocked

---

### **CHECK 5: Did recipient open the email?**

**Important:** Just receiving email ≠ opening it!

- [ ] ✅ Opened email at jadejadivyaraj7@gmail.com
- [ ] ✅ Clicked "Display images below" (if Gmail showed this)
- [ ] ❌ Only opened in bytestechnolab.com email (sender email)

**You must open it in the RECIPIENT account (jadejadivyaraj7@gmail.com)!**

---

### **CHECK 6: Time buffer**

**Email sent:** 3:42 PM
**Email opened:** ?

If you opened it within 30 seconds of sending = time buffer blocks it!

- [ ] Opened more than 30 seconds after sending
- [ ] Opened within 30 seconds (won't count)

---

## 🧪 **DIAGNOSTIC TEST**

### **Test the pixel directly:**

1. **Get pixel URL from email source** (CHECK 1)
2. **Copy the full URL:**
   ```
   https://mailtracker-ai.onrender.com/pixel?uid=...&token=...
   ```
3. **Open in new browser tab**
4. **Check Render backend logs**
5. **Should see:** "OpenEvent created"

---

## 📊 **TEST BACKEND API**

### **Check if message exists in database:**

**Open in browser:**
```
https://mailtracker-ai.onrender.com/stats/user/YOUR_USER_ID
```

**Replace YOUR_USER_ID with:**
- If extension userId is `divyarajsinh.jadeja@bytestechnolab.com`:
  ```
  https://mailtracker-ai.onrender.com/stats/user/divyarajsinh.jadeja%40bytestechnolab.com
  ```
- If extension userId is `jadejadivyaraj7@gmail.com`:
  ```
  https://mailtracker-ai.onrender.com/stats/user/jadejadivyaraj7%40gmail.com
  ```

**Expected response:**
```json
{
  "userId": "...",
  "totalMessages": 1,
  "messages": [
    {
      "subject": "Test",
      "recipients": {
        "to": ["jadejadivyaraj7@gmail.com"]
      },
      "recipientStatus": [
        {
          "email": "jadejadivyaraj7@gmail.com",
          "read": false  ← Shows read status
        }
      ]
    }
  ]
}
```

---

## 🎯 **MOST LIKELY ISSUES:**

### **Issue 1: UserId Mismatch (70%)**
```
Extension userId: "divyarajsinh.jadeja@bytestechnolab.com"
Dashboard login: "jadejadivyaraj7@gmail.com"
Result: ❌ Dashboard shows "No messages"
```

**Fix:** Set BOTH to same value (use sender email usually)

---

### **Issue 2: Email Not Actually Opened (20%)**
```
Sent to: jadejadivyaraj7@gmail.com
But opened in: divyarajsinh.jadeja@bytestechnolab.com (sent folder)
Result: ❌ Pixel never loaded
```

**Fix:** Open email in jadejadivyaraj7@gmail.com inbox!

---

### **Issue 3: Time Buffer (5%)**
```
Sent: 3:42:00 PM
Opened: 3:42:10 PM (10 seconds later)
Result: ❌ Too soon, blocked by 30s buffer
```

**Fix:** Wait 30+ seconds before opening

---

### **Issue 4: Images Blocked (3%)**
```
Gmail showing: "Images are not displayed. Display images below"
Result: ❌ Pixel not loaded
```

**Fix:** Click "Display images below"

---

### **Issue 5: Backend Not Deployed (2%)**
```
Latest code changes not on Render
Result: ❌ Old code running
```

**Fix:**
```bash
cd server
git add .
git commit -m "Latest changes"
git push
```

---

## ✅ **ACTION ITEMS FOR YOU:**

Please check and reply with:

1. **Email Source Check:**
   - [ ] Pixel found in email source? (Show original)
   - Share pixel URL if found

2. **Extension UserId:**
   - What does extension show? ________

3. **Dashboard Login:**
   - What userId did you login with? ________

4. **Email Opening:**
   - [ ] Did you open email at jadejadivyaraj7@gmail.com?
   - [ ] Did you click "Display images"?
   - [ ] How long after sending did you open it? ______ seconds

5. **Backend Logs:**
   - Share logs from Render around 3:42 PM
   - Any "Pixel loaded" or "OpenEvent created"?

6. **Backend API Test:**
   - Share response from /stats/user/YOUR_USER_ID

---

## 🚨 **QUICK FIX: Temporary Disable All Checks**

If you want to test WITHOUT any restrictions:

**Edit `server/routes/track.js`:**

```javascript
// Line ~267 and ~393 - Comment out time buffer:
// const BUFFER_SECONDS = 30;
const BUFFER_SECONDS = 0; // No buffer

// Line ~277 and ~401 - Comment out sender check:
// if (normalizedSenderEmail && normalizedOpenEmail === normalizedSenderEmail) {
//   return false;
// }
```

**Deploy:**
```bash
cd server
git add .
git commit -m "Temp: disable all checks for testing"
git push
```

**Test:**
1. Send new email
2. Open immediately
3. Refresh dashboard
4. Should show as read

**IMPORTANT:** Re-enable these checks after testing!

---

**Please share the results of the checks above and I'll help you further!** 🔍
