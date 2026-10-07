# Railway Configuration Checklist

Copy and save this checklist. Complete each item before testing.

---

## 🔧 Pre-Deployment (Local)

- [x] Repository updated with production fixes
- [x] pnpm-lock.yaml regenerated (v10.28.0)
- [x] railway.json updated with correct start command
- [x] Code pushed to GitHub
- [x] Builds pass locally (`pnpm build`)

---

## 🚀 Railway Deployment

### Step 1: Create Project

- [ ] Go to https://railway.app
- [ ] Login with GitHub
- [ ] Click "Create a New Project"
- [ ] Select "Deploy from GitHub repo"
- [ ] Connect to `santhosh-r1124/LA_BOT`
- [ ] Select branch: `claude/friendly-cerf-ddz7tw`
- [ ] Click "Deploy"

### Step 2: Monitor Build (10-15 minutes)

- [ ] Watch "Deployments" tab
- [ ] Look for "Build Successful"
- [ ] Look for "Deploy Successful"
- [ ] Verify no build errors in logs

### Step 3: Plugins Auto-Created

Railway auto-creates these (verify they exist):

- [ ] PostgreSQL service created
- [ ] Redis service created
- [ ] Network connectivity between services

### Step 4: Add Environment Variables

Go to Railway → Your Project → API Service → Variables

Add each variable by clicking "Add Variable":

#### LLM Configuration (Required)

```bash
# Get free key: https://aistudio.google.com/apikey
Variable Name: GEMINI_API_KEY
Value: [Your actual key here]
```

- [ ] GEMINI_API_KEY added ✓

```bash
Variable Name: LLM_PROVIDER
Value: gemini
```

- [ ] LLM_PROVIDER = gemini ✓

#### Environment Configuration

```bash
Variable Name: APP_ENV
Value: production
```

- [ ] APP_ENV = production ✓

```bash
Variable Name: LOG_LEVEL
Value: INFO
```

- [ ] LOG_LEVEL = INFO ✓

#### CORS Configuration (Required for Frontend)

```bash
# Temporary: allow localhost for testing
Variable Name: CORS_ORIGINS
Value: http://localhost:3000,http://localhost:3001
```

- [ ] CORS_ORIGINS set (will update after Netlify deploy) ✓

---

## ✅ Verification (After Deploy)

### Get Your API URL

1. Railway → Your Project → Services
2. Click on API/Backend service
3. Copy "Public URL" (e.g., `https://la-bot-api-production.up.railway.app`)

**Your API URL**: `https://____________________`

### Test Health Endpoint

```bash
curl https://YOUR_API_URL/health
```

Expected response:
```json
{"status":"ok"}
```

- [ ] Health check passing ✓

### Test Readiness Endpoint

```bash
curl https://YOUR_API_URL/health/ready
```

Expected response:
```json
{"status":"ok","db":"ok","redis":"ok"}
```

- [ ] Readiness check passing ✓
- [ ] Database connected ✓
- [ ] Redis connected ✓

### Check Logs for Errors

- [ ] No startup errors
- [ ] No database connection errors
- [ ] No Redis connection errors
- [ ] See "Application startup complete"

---

## 🌐 Frontend Deployment (Netlify)

### Deploy Web App

1. Go to https://netlify.com
2. New site → "Deploy from GitHub repo"
3. Select: `santhosh-r1124/LA_BOT`
4. Build settings:
   ```
   Build command: pnpm build --filter @legal-platform/web
   Publish directory: apps/web/.next
   ```
5. Environment Variables:
   ```
   NEXT_PUBLIC_API_BASE_URL = https://YOUR_RAILWAY_API_URL
   NEXT_PUBLIC_APP_ENV = production
   ```
6. Deploy

- [ ] Web app deployed to Netlify ✓
- [ ] Web app URL: `https://____________________`

### Deploy Advocate Portal

Repeat above, but:
- Build command: `pnpm build --filter @legal-platform/advocate-portal`
- Publish directory: `apps/advocate-portal/.next`

- [ ] Advocate portal deployed to Netlify ✓
- [ ] Portal URL: `https://____________________`

---

## 🔒 Production Configuration (After Frontends Live)

### Update CORS

Now that you have real Netlify URLs, update Railway CORS:

1. Railway → Your Project → API Service → Variables
2. Edit `CORS_ORIGINS`:
   ```
   https://your-web-site.netlify.app,https://your-advocates-site.netlify.app
   ```

- [ ] CORS_ORIGINS updated with Netlify URLs ✓

### Update Frontend Base URL

1. Edit `FRONTEND_BASE_URL`:
   ```
   https://your-web-site.netlify.app
   ```

- [ ] FRONTEND_BASE_URL updated ✓

### Trigger Railway Redeploy

- [ ] Railway auto-redeployed with new variables ✓
- [ ] Check "Deployments" tab for "Deploy Successful" ✓

---

## 🧪 End-to-End Testing

### Open Frontend

- [ ] Open `https://your-web-site.netlify.app`
- [ ] Page loads without errors
- [ ] No console errors (F12)

### Test Chat Feature

- [ ] Try sending a message to chat
- [ ] Get a response from AI
- [ ] Check Network tab: request to `https://YOUR_RAILWAY_API_URL/api/v1/...`

### Test User Registration

- [ ] Click "Register"
- [ ] Fill in form
- [ ] Submit
- [ ] Should create account

### Test Advocate Search

- [ ] Navigate to advocates section
- [ ] Should see advocate profiles
- [ ] Should load from database

### Network Inspection

Open F12 Developer Tools → Network tab:

- [ ] API requests go to Railway URL (NOT localhost)
- [ ] HTTPS only (no HTTP)
- [ ] No CORS errors
- [ ] Response status 200/201

---

## 📊 Production Monitoring

### Daily Checks

- [ ] Health check passing: `curl https://YOUR_API_URL/health`
- [ ] No errors in Railway logs
- [ ] Chat still responding
- [ ] User registration still working

### Weekly Checks

- [ ] Check database size (Railway dashboard)
- [ ] Check uptime (Railway dashboard)
- [ ] Monitor error rates
- [ ] Verify backups (if on paid plan)

---

## 🎯 Your Production Deployment URLs

**Save these somewhere safe**:

```
Railway API:        https://____________________
Web App (Netlify):  https://____________________
Advocates Portal:   https://____________________
GitHub Branch:      claude/friendly-cerf-ddz7tw
```

---

## ✨ Deployment Complete

When all checkboxes are checked, your deployment is complete and production-ready! 🚀

---

## 📞 Common Issues & Quick Fixes

| Problem | Solution |
|---------|----------|
| "Cannot find pnpm" | ✓ Already fixed in commit 8792297 |
| "Health check fails" | Check GEMINI_API_KEY is set, check logs |
| "CORS error in browser" | Update CORS_ORIGINS to Netlify URL, redeploy |
| "API returns 502" | Check logs for startup errors, verify PORT set |
| "No data in database" | Normal on first run; database is empty |
| "Chat says 'LLM not configured'" | Add GEMINI_API_KEY, check it's valid |
| "Frontend shows localhost in requests" | NEXT_PUBLIC_API_BASE_URL not set in Netlify |

---

**Questions?** See RAILWAY_DEPLOYMENT.md for detailed guide.
