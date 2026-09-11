# G-Spirit Admin Authentication Setup Guide

## 🎯 Quick Summary

Your admin login was failing because **3 required environment variables were missing** on your Cloudflare Worker. I've generated them for you.

---

## 📋 What You Need to Do

### Step 1: Add Environment Variables to Cloudflare

1. Open **Cloudflare Dashboard** → **Workers & Pages**
2. Click **gspiritloans** (your worker)
3. Go to **Settings** → **Environment Variables**
4. Add these 3 variables (all in **Production** environment):

| Key | Value |
|-----|-------|
| `ADMIN_PASSWORD_SALT` | `/xniGIpPEBxAFX8zjq/r/2XdxO/FwqSw` |
| `ADMIN_PASSWORD_HASH` | `890f6e34f3cd67a9e90101a69b7fe9bbb6120d1e761cd719b66076e91c61472f` |
| `ADMIN_JWT_SECRET` | `9e548d40007a68b088ff5a02d6fee8f2859c5440d579254e54ae5980eeadb2da` |

5. Click **"Encrypt & Save"**
6. Your worker will auto-deploy (or manually deploy if needed)

### Step 2: Test Login

Go to your admin page and login with:
```
Password: 1994
```

---

## 🔐 How It Works (Technical Details)

### Old System (Backup)
- Simple token comparison: `token === env.ADMIN_TOKEN`
- Less secure, single static token

### New System (Current - worker.js)
1. User sends **plain password** to `/api/admin/login`
2. Worker **hashes** the password using:
   - Algorithm: PBKDF2 (standard encryption)
   - Iterations: 100,000 (slow = secure)
   - Hash: SHA-256
   - Salt: `/xniGIpPEBxAFX8zjq/r/2XdxO/FwqSw`
3. Compares hash with `env.ADMIN_PASSWORD_HASH`
4. If match → generates JWT token (valid 7 days)
5. Admin uses JWT token for all dashboard operations

### Why This Is Better
✓ Password never stored in plaintext  
✓ Each session gets unique JWT token  
✓ 7-day expiration (auto re-login)  
✓ Industry-standard security  

---

## 🔄 What Changed in Your Code

The worker.js now has:

1. **PBKDF2 Password Hashing** (lines 49-57)
   ```javascript
   async function hashPassword(password, salt) {
     // 100,000 iterations of SHA-256
     // Makes brute-force attacks expensive
   }
   ```

2. **JWT Token Generation** (lines 59-73)
   ```javascript
   async function createJWT(payload, secret) {
     // Creates secure token with expiration
   }
   ```

3. **JWT Verification** (lines 75-99)
   ```javascript
   async function verifyJWT(token, secret) {
     // Validates token signature & expiration
   }
   ```

4. **Backward Compatibility** (line 155)
   ```javascript
   // Still supports old ADMIN_TOKEN for legacy systems
   if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) return true;
   ```

---

## ⚠️ Security Checklist

- [ ] Added all 3 environment variables to Cloudflare
- [ ] Verified they're in **Production** environment
- [ ] Deployed worker (or auto-deployed)
- [ ] Tested login with password: `1994`
- [ ] Keep ADMIN_CREDENTIALS.txt file secure (don't commit to git)
- [ ] Communicate new admin password to your team

---

## 🆘 Troubleshooting

### "Admin authentication is not configured"
→ Environment variables not added or not in Production environment

### "Invalid password"
→ You entered wrong password (should be: `1994`)  
→ Or environment variables weren't deployed yet

### "Unauthorized" (after login)
→ JWT token expired (re-login)  
→ Or ADMIN_JWT_SECRET changed

### Still Not Working?
1. Check Worker logs: Dashboard → gspiritloans → Logs
2. Try logging in and check browser console (F12)
3. Verify API_BASE in admin.html matches worker URL
4. Clear browser cache and session storage

---

## 🔑 Generating New Credentials

If you ever need to change the admin password:

```bash
node generate-admin-credentials.js "your-new-password"
```

Then update the 3 environment variables again in Cloudflare.

---

## 📂 Files in Your Project

- **worker.js** - Main backend (uses JWT + PBKDF2)
- **admin.html** - Admin dashboard UI
- **generate-admin-credentials.js** - Credential generator script
- **ADMIN_CREDENTIALS.txt** - Your generated credentials (keep secure!)

---

## ✅ Expected Behavior After Setup

1. Visit admin page → see login form
2. Enter password: `1994` → login successful
3. See dashboard with Loan/Partnership/Capital apps tabs
4. Can view, search, update status, delete applications
5. WhatsApp notifications send on status update (if configured)

---

## 📞 Next Steps

1. **Add environment variables to Cloudflare** (most important!)
2. **Test login** with password: `1994`
3. **Verify dashboard works**
4. **Update your team** on new admin password
5. **Store credentials securely** (ADMIN_CREDENTIALS.txt)

