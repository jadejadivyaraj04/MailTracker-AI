# ✅ DEPLOYED SERVICES - Configuration Guide

## 🌐 Your Deployed URLs

### **Backend (Web Service):**
```
https://mailtracker-ai.onrender.com
Status: ✅ ONLINE (uptime: 511 seconds)
```

### **Frontend/Dashboard (Static Site):**
```
https://mailtracker-ai-1.onrender.com
Status: ✅ DEPLOYED
```

---

## ⚠️ CRITICAL: Environment Variable Configuration

Your deployed dashboard needs to know where the backend is!

### **🔧 Fix Deployed Dashboard:**

1. **Go to Render Dashboard:**
   - https://dashboard.render.com/

2. **Find your Static Site:** `mailtracker-ai-1`

3. **Click on it** → Go to **"Environment"** tab

4. **Add Environment Variable:**
   ```
   Key:   VITE_API_BASE_URL
   Value: https://mailtracker-ai.onrender.com
   ```

5. **Save Changes**

6. **Trigger Manual Deploy:**
   - Go to "Manual Deploy" section
   - Click **"Deploy latest commit"**
   - Wait ~2 minutes for build to complete

---

## 🧪 **Test Your Deployed Dashboard**

### **Step 1: Open Deployed Dashboard**

Open in browser:
```
https://mailtracker-ai-1.onrender.com
```

### **Step 2: Check Browser Console**

1. Press **F12** (DevTools)
2. **Console** tab
3. **Look for this:**

```javascript
// Should see:
"Using API Base: https://mailtracker-ai.onrender.com"

// Should NOT see:
"Using API Base: http://localhost:5000"  ← WRONG!
```

### **Step 3: Login**

**IMPORTANT:** Use the SAME userId as in your Chrome extension!

**Extension UserId:**
1. Click extension icon
2. Check "User ID" field
3. Copy exact value

**Dashboard Login:**
- Enter SAME userId
- Example: `jadejadivyaraj04@gmail.com`

---

## 📋 **Complete Setup Checklist**

### **Backend (Web Service):**
- [✅] Deployed at: https://mailtracker-ai.onrender.com
- [✅] Health check working: `/health` returns OK
- [ ] Latest code deployed (with your debugging logs)
- [ ] Environment variables set:
  - `MONGO_URI` - MongoDB connection string
  - `PORT` - 5000 (or Render's auto-assigned)

### **Dashboard (Static Site):**
- [✅] Deployed at: https://mailtracker-ai-1.onrender.com
- [ ] Environment variable `VITE_API_BASE_URL` set to backend URL
- [ ] Rebuilt after setting environment variable

### **Chrome Extension:**
- [ ] Loaded in Chrome
- [ ] User ID set (matches dashboard login)
- [ ] Tracking enabled
- [ ] Backend URL correct in code: `https://mailtracker-ai.onrender.com`

---

## 🔍 **Verify Environment Variable is Set**

### **Check what URL dashboard is using:**

1. **Open:** https://mailtracker-ai-1.onrender.com
2. **Open DevTools** (F12)
3. **Console tab**
4. **Type this:**

```javascript
// This will show you what API URL the app is using
localStorage.getItem('apiBase')
```

**Expected:** `"https://mailtracker-ai.onrender.com"`

**If you see:** `"http://localhost:5000"` or `null`
- Environment variable NOT set correctly
- Need to add it in Render and redeploy

---

## 🚀 **How to Deploy Backend Changes**

You added console.log statements to backend. Deploy them:

```bash
cd /Users/bytes-divyarajsinh/WorkSpace/extension_source/MailTracker\ AI/server
git add .
git commit -m "Add debugging logs for stats endpoint"
git push
```

Render will auto-deploy in ~2 minutes.

**Verify logs on Render:**
1. Go to backend service on Render
2. Click "Logs" tab
3. Send test email from Gmail
4. Should see your new logs:
   ```
   [MailTracker AI] Fetching stats for userId: ...
   [MailTracker AI] Found messages: ...
   ```

---

## 📊 **Expected Working Flow**

### **1. Send Email from Gmail:**
```
Chrome Console:
[MailTracker AI] Message registered successfully
[MailTracker AI] Added tracking pixels for 1 recipients
```

### **2. Backend Logs (Render):**
```
[MailTracker AI] Registering message: { uid: "...", recipients: {...} }
[MailTracker AI] Fetching stats for userId: jadejadivyaraj04@gmail.com
[MailTracker AI] Found messages: 1
```

### **3. Dashboard Shows Email:**
```
https://mailtracker-ai-1.onrender.com
(After login)

Email List:
┌────────────────────────────────────────┐
│ Test tracking                          │
│ To: jadejadivyaraj7@gmail.com         │
│ Sent: Nov 21, 3:00 PM                 │
│ Status: Not Read ❌                    │
└────────────────────────────────────────┘
```

---

## 🎯 **Quick Test - Use Deployed Dashboard**

### **Option 1: Use Deployed Dashboard (Recommended)**

1. **Set environment variable in Render** (see above)
2. **Redeploy dashboard**
3. **Open:** https://mailtracker-ai-1.onrender.com
4. **Login** with your userId
5. **Should see emails!**

### **Option 2: Use Local Dashboard (For Development)**

You already have this running:
```
http://localhost:5173/
```

This one should work because we created `.env` file locally.

---

## 🔧 **Render Environment Variable Setup (Step-by-Step)**

### **For Dashboard Static Site:**

1. **Go to:** https://dashboard.render.com/
2. **Click on:** `mailtracker-ai-1` (your static site)
3. **Sidebar:** Click **"Environment"**
4. **Click:** "Add Environment Variable" button
5. **Enter:**
   - **Key:** `VITE_API_BASE_URL`
   - **Value:** `https://mailtracker-ai.onrender.com`
6. **Click:** "Save Changes"
7. **Go to "Manual Deploy"** tab
8. **Click:** "Deploy Latest Commit"
9. **Wait** ~2 minutes for build
10. **Test:** Open https://mailtracker-ai-1.onrender.com

---

## 📞 **Troubleshooting Deployed Dashboard**

### **Issue: "Failed to fetch" on deployed dashboard**

**Cause:** Environment variable not set or dashboard not rebuilt

**Fix:**
1. Verify `VITE_API_BASE_URL` is set in Render
2. Redeploy dashboard (Manual Deploy)
3. Clear browser cache and reload

### **Issue: "No messages found" on dashboard**

**Cause:** UserId mismatch or no emails sent yet

**Fix:**
1. Check extension userId matches dashboard login
2. Send test email from Gmail
3. Check browser console for "Message registered successfully"
4. Refresh dashboard

### **Issue: CORS errors in browser console**

**Cause:** Backend CORS not allowing frontend domain

**Fix:** Backend already has `cors({ origin: "*" })` so should work

---

## 🎉 **Summary**

**Your Services:**
- ✅ Backend: https://mailtracker-ai.onrender.com (WORKING)
- ✅ Dashboard: https://mailtracker-ai-1.onrender.com (DEPLOYED)
- ✅ Local Dashboard: http://localhost:5173/ (RUNNING)

**Next Step:**
1. **Add `VITE_API_BASE_URL` environment variable** to dashboard on Render
2. **Redeploy dashboard**
3. **Open deployed dashboard and login**
4. **Send test email from Gmail**
5. **Check if email appears in dashboard**

**Use deployed dashboard for production, local for development!** 🚀
