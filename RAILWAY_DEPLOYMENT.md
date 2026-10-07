# Railway Deployment Guide — Complete Setup

**LA_BOT is now production-ready for Railway deployment.**

This guide walks through deploying the **FastAPI backend** to Railway with full LLM and database support.

---

## ✅ What Was Fixed

The code repository has been updated to be Railway-compatible:

1. ✅ **pnpm lockfile regenerated** (pnpm v10.28.0) — fixes Corepack issue
2. ✅ **railway.json updated** — correct Python backend startup command
3. ✅ **Build command fixed** — proper Node.js + Python build
4. ✅ **Port configuration** — uses Railway's `$PORT` environment variable
5. ✅ **Health endpoint** — `/health` for monitoring
6. ✅ **Database migrations** — run automatically on startup

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│ RAILWAY                                             │
├─────────────────────────────────────────────────────┤
│ Python/FastAPI Backend                              │
│ ├─ apps/api/                                        │
│ ├─ Port: $PORT (Railway-provided)                  │
│ ├─ Host: 0.0.0.0 (accessible)                      │
│ └─ Start: uv run uvicorn app.main:app ...          │
│                                                     │
│ PostgreSQL Database (Plugin)                        │
│ ├─ Auto-created by Railway                         │
│ ├─ Connected via DATABASE_URL                      │
│ └─ Auto-migrated on startup                        │
│                                                     │
│ Redis Cache (Plugin)                                │
│ ├─ Auto-created by Railway                         │
│ └─ Connected via REDIS_URL                         │
└─────────────────────────────────────────────────────┘
         ↑
         │ API calls
         │ (from Netlify frontend)
         │
┌─────────────────────────────────────────────────────┐
│ NETLIFY                                             │
├─────────────────────────────────────────────────────┤
│ Next.js Frontends                                   │
│ ├─ apps/web                                         │
│ ├─ apps/advocate-portal                            │
│ └─ NEXT_PUBLIC_API_BASE_URL = Railway API URL      │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 Step 1: Deploy Backend to Railway

### 1.1 Go to Railway Dashboard

**URL**: https://railway.app

- Login with GitHub
- Create new project
- Select "Deploy from GitHub repo"

### 1.2 Connect Your Repository

- Find: `santhosh-r1124/LA_BOT`
- Select branch: `claude/friendly-cerf-ddz7tw` (or `main` if merged)
- Click "Deploy"

Railway will:
- Detect Nixpacks build
- Build pnpm dependencies
- Build Python dependencies
- Provision PostgreSQL + Redis
- Start the FastAPI backend

**Expected time: 10-15 minutes**

### 1.3 Monitor Build

1. Go to your Railway project
2. Click "Deployments" tab
3. Watch for `Build Successful` + `Deploy Successful`

**Example success output:**
```
✓ Cloned repo
✓ Built with Nixpacks
✓ Detected: Node.js 24, pnpm 10.28.0, Python 3.13
✓ PostgreSQL provisioned
✓ Redis provisioned
✓ Database migrations ran
✓ Server listening on port 12345
✓ Health check passing
```

### 1.4 Get Your API URL

Once deployed:

1. Click on your project
2. Go to "Services" tab
3. Click on the `API` service (or your service name)
4. Copy the "Public URL" (e.g., `https://la-bot-api-production.up.railway.app`)

**Save this URL** — you need it in the next steps.

---

## 🔑 Step 2: Add Environment Variables

**IMPORTANT**: Before testing, add your API keys to Railway.

### 2.1 Go to Service Settings

1. Railway dashboard → Your project
2. Click on the API service
3. Click **"Variables"** tab

### 2.2 Add Required Variables

Click **"Add Variable"** for each of these:

#### LLM API Key (Required for Chat)

```
Variable Name: GEMINI_API_KEY
Value: [Your Google AI Studio key]
```

**Get a free key**: https://aistudio.google.com/apikey

#### LLM Provider

```
Variable Name: LLM_PROVIDER
Value: gemini
```

#### Environment

```
Variable Name: APP_ENV
Value: production
```

#### CORS Configuration (Required for Netlify)

```
Variable Name: CORS_ORIGINS
Value: http://localhost:3000,http://localhost:3001
```

**Note**: After deploying frontends to Netlify, update this to:
```
https://your-web-app.netlify.app,https://your-advocates-app.netlify.app
```

### 2.3 Other Optional Variables

**Frontend Base URL** (for email links):
```
Variable Name: FRONTEND_BASE_URL
Value: http://localhost:3000
```

Update to your Netlify URL after frontend deployment.

**Additional LLM Providers** (optional fallbacks):
```
# Groq (free alternative)
Variable Name: GROQ_API_KEY
Value: [your key from https://console.groq.com/keys]

Variable Name: GROQ_MODEL
Value: mixtral-8x7b-32768
```

---

## ✅ Step 3: Verify Backend Health

Once variables are added, Railway auto-redeploys.

### 3.1 Check Health Endpoint

Replace `YOUR_API_URL` with your actual Railway API URL:

```bash
curl https://YOUR_API_URL/health
```

**Expected response**:
```json
{"status":"ok"}
```

If you see a connection error or 404, the backend isn't running. Check the deployment logs.

### 3.2 Check Readiness

```bash
curl https://YOUR_API_URL/health/ready
```

**Expected response**:
```json
{"status":"ok","db":"ok","redis":"ok"}
```

If `db` or `redis` are not OK, check:
- PostgreSQL plugin is running
- Redis plugin is running
- DATABASE_URL is set correctly

### 3.3 Test API Endpoint

Try a real endpoint:

```bash
curl -X POST https://YOUR_API_URL/api/v1/chat/messages \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is Indian law?",
    "conversation_id": null
  }'
```

**Expected**: Chat response from Gemini API (or error if `GEMINI_API_KEY` not set)

---

## 🌐 Step 4: Deploy Frontends to Netlify

The **frontends (Next.js apps) must be deployed separately on Netlify**, not Railway.

### 4.1 Deploy Web App

1. Go to https://netlify.com
2. New site → "Deploy from GitHub repo"
3. Select: `santhosh-r1124/LA_BOT`
4. Build command: `pnpm build --filter @legal-platform/web`
5. Publish directory: `apps/web/.next`
6. Environment Variables:
   ```
   NEXT_PUBLIC_API_BASE_URL = https://YOUR_RAILWAY_API_URL
   NEXT_PUBLIC_APP_ENV = production
   ```
7. Deploy

### 4.2 Deploy Advocate Portal

Repeat step 4.1, but:
- Build command: `pnpm build --filter @legal-platform/advocate-portal`
- Publish directory: `apps/advocate-portal/.next`
- Same environment variables

---

## 🔒 Step 5: Update CORS for Production

After Netlify URLs are live:

### 5.1 Get Your Frontend URLs

- Web app: `https://your-web-site.netlify.app`
- Advocates: `https://your-advocates-site.netlify.app`

### 5.2 Update CORS in Railway

1. Railway → Your API service → Variables
2. Edit `CORS_ORIGINS`:
   ```
   https://your-web-site.netlify.app,https://your-advocates-site.netlify.app
   ```
3. Railway auto-redeploys

### 5.3 Update Frontend Base URL

1. Edit `FRONTEND_BASE_URL`:
   ```
   https://your-web-site.netlify.app
   ```

---

## 🧪 Step 6: Test Frontend → Backend Connection

1. **Open your web app**: `https://your-web-site.netlify.app`
2. **Try the chat feature** → Should get AI responses
3. **Check browser network** (F12 → Network tab):
   - Requests to `https://YOUR_RAILWAY_API_URL/api/v1/...`
   - NOT `http://localhost:8000` (development)
4. **Test user registration** → Should work
5. **Browse advocates** → Should load data

---

## 📊 Monitoring

### View Logs

Railway → Your API service → **Logs** tab

Watch for:
- ✅ `Application startup complete`
- ✅ `Uvicorn running on 0.0.0.0:PORT`
- ✅ `Database migrations completed`
- ❌ Any error traces

### Common Issues & Fixes

| Issue | Solution |
|-------|----------|
| `GEMINI_API_KEY not configured` | Add key to Variables, redeploy |
| `Database connection failed` | Verify DATABASE_URL, check PostgreSQL plugin |
| `CORS error in browser` | Update CORS_ORIGINS with correct Netlify URL |
| `502 Bad Gateway` | Check logs for startup errors, verify PORT is set |
| `API timeout` | May be cold start; first request can be slow |

---

## 🎯 Environment Variables Summary

### Required

| Name | Example | Where |
|------|---------|-------|
| `GEMINI_API_KEY` | `AIza...` | Railway Variables |
| `LLM_PROVIDER` | `gemini` | Railway Variables |

### Automatically Set by Railway

These are auto-populated by Railway plugins:
- `DATABASE_URL` — PostgreSQL connection
- `REDIS_URL` — Redis connection
- `PORT` — Railway-assigned port

### Recommended

| Name | Example |
|------|---------|
| `APP_ENV` | `production` |
| `LOG_LEVEL` | `INFO` |
| `CORS_ORIGINS` | `https://app.netlify.app` |
| `FRONTEND_BASE_URL` | `https://app.netlify.app` |

---

## 🔐 Security Notes

### ✅ Do

- [x] Store API keys in Railway Variables (secret)
- [x] Use HTTPS (automatic)
- [x] Set `CORS_ORIGINS` to specific Netlify domains
- [x] Rotate JWT secrets in production
- [x] Enable database backups (Railway Pro)

### ❌ Don't

- [ ] Commit `.env` files with secrets
- [ ] Use `localhost` in production
- [ ] Set `CORS_ORIGINS = *` with authentication
- [ ] Expose GEMINI_API_KEY in frontend code
- [ ] Use development settings (`--reload`, `DEBUG=true`)

---

## 📈 Scaling & Upgrades

### Current Setup (Free Tier)

| Component | Free | Limits |
|-----------|------|--------|
| API Server | Yes | 512 MB RAM, auto-suspend |
| PostgreSQL | Yes | 1 GB, auto-suspend |
| Redis | Yes | 512 MB, auto-suspend |

### Upgrade to Production (Paid)

```bash
# Estimated cost per month
API Server:    $7    (always-on)
PostgreSQL:    $15   (persistent, backups)
Redis:         $7    (persistent)
Total:         ~$29/month
```

**Upgrade in Railway dashboard** → "Billing" → Choose paid tier.

---

## 🚨 Troubleshooting

### Build Fails

**Log**: `ERROR: Cannot find module pnpm`

**Fix**: Commit should already fix this. If not:
```bash
git log --oneline -1
# Should show: "fix: Prepare LA_BOT for Railway production deployment"
```

### Backend Won't Start

**Log**: `Connection refused` or `Port already in use`

**Fix**:
- Check `PORT` environment variable is set
- Verify PostgreSQL + Redis plugins exist
- Check `DATABASE_URL` and `REDIS_URL` formats

### Frontend Can't Reach API

**Error in browser**: `Failed to fetch from http://localhost:8000`

**Fix**:
- Verify `NEXT_PUBLIC_API_BASE_URL` is set to Railway API URL
- Redeploy Netlify after changing variable
- Check CORS_ORIGINS on Railway

### Chat Returns "LLM Not Configured"

**Fix**:
- Add `GEMINI_API_KEY` to Railway Variables
- Verify API key is valid
- Trigger manual redeploy

---

## ✨ Success Checklist

- [ ] Railway backend deployed
- [ ] Health check passing (`/health`)
- [ ] API endpoint working (`/api/v1/...`)
- [ ] GEMINI_API_KEY set
- [ ] Netlify frontends deployed
- [ ] NEXT_PUBLIC_API_BASE_URL correct
- [ ] CORS configured for Netlify domains
- [ ] Chat works end-to-end
- [ ] User registration works
- [ ] Advocate search works

---

## 📞 Support

- **Railway Docs**: https://docs.railway.app
- **FastAPI Docs**: https://fastapi.tiangolo.com
- **Netlify Docs**: https://docs.netlify.com
- **Next.js Docs**: https://nextjs.org/docs

---

**Your LA_BOT is now production-ready! 🚀**
