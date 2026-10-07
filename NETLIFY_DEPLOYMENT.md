# Netlify Deployment Guide

Deploy your LA_BOT app to Netlify with **full LLM and chat functionality**. This guide covers both frontends and the backend API.

> **TL;DR**: Netlify hosts the Next.js frontends (~2 min), Render/Railway host the Python FastAPI backend (~5 min), Supabase/Railway host the database.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ NETLIFY (Frontend)                                              │
├─────────────────────────────────────────────────────────────────┤
│ ✅ apps/web (Next.js)          → https://app.netlify.app        │
│ ✅ apps/advocate-portal (Next.js) → https://advocates.netlify.app│
└────────────────────┬────────────────────────────────────────────┘
                     │ API calls
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│ RENDER/RAILWAY (Backend - Python)                               │
├─────────────────────────────────────────────────────────────────┤
│ ✅ apps/api (FastAPI)          → https://api.render.com/api/v1  │
│   - Runs on: Render Free Tier | Railway Free Tier               │
│   - Port: 8000                                                  │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│ MANAGED SERVICES                                                │
├─────────────────────────────────────────────────────────────────┤
│ 📊 Database: Supabase PostgreSQL | Railway PostgreSQL           │
│ 💾 Cache: Upstash Redis | Railway Redis                         │
│ 🔑 LLM API Keys: Google Gemini (FREE) | Groq (FREE) | Anthropic │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Prepare the Repository

### 1.1 Push to GitHub
```bash
cd /home/user/LA_BOT
git add .
git commit -m "Prepare for Netlify + Render deployment"
git push origin claude/friendly-cerf-ddz7tw
```

### 1.2 Check Build Configuration
The repo already has:
- ✅ `netlify.json` — Netlify build config
- ✅ `pnpm-workspace.yaml` — Monorepo setup
- ✅ Next.js apps configured for production builds

---

## Step 2: Deploy the Backend (Render or Railway)

### Option A: Deploy on Render (Free Tier ⭐ Recommended)

#### 2A.1 Create Render Account
1. Go to [render.com](https://render.com)
2. Click "Get Started" and sign up with GitHub
3. Authorize Render to access your repositories

#### 2A.2 Create a PostgreSQL Database
1. In Render dashboard → "New +" → "PostgreSQL"
   - Name: `la-bot-db`
   - Database: `legal_platform`
   - User: `legal`
   - Region: Choose closest to you
   - Free tier is fine (auto-suspend after 7 days without use)
2. Note the **Internal Database URL** (you'll need this for the API service)

#### 2A.3 Create Redis Cache
1. Click "New +" → "Redis"
   - Name: `la-bot-redis`
   - Region: Same as database
   - Free tier (0.5 GB)
2. Note the **Redis URL**

#### 2A.4 Deploy FastAPI Backend
1. Click "New +" → "Web Service"
   - Connect GitHub repo
   - Name: `la-bot-api`
   - Environment: `Python 3.12`
   - Build command: `cd apps/api && pip install uv && uv sync && uv run alembic upgrade head`
   - Start command: `cd apps/api && uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Region: Same as database

2. Set **Environment Variables** in Render:
   ```
   APP_ENV=production
   LOG_LEVEL=INFO
   LOG_FORMAT=json
   API_SECRET_KEY=<use: python -c "import secrets; print(secrets.token_urlsafe(48))">
   JWT_SECRET=<use: python -c "import secrets; print(secrets.token_urlsafe(48))">
   DATABASE_URL=<paste Internal PostgreSQL URL from step 2A.2>
   DATABASE_URL_SYNC=<same as DATABASE_URL, replace +asyncpg with +psycopg>
   REDIS_URL=<paste Redis URL from step 2A.3>
   GEMINI_API_KEY=<get from https://aistudio.google.com/apikey>
   LLM_PROVIDER=gemini
   CORS_ORIGINS=https://your-web.netlify.app,https://your-advocates.netlify.app
   FRONTEND_BASE_URL=https://your-web.netlify.app
   ```

3. Click "Create Web Service" and wait ~5 minutes for deployment
4. Note the **API URL** (e.g., `https://la-bot-api.onrender.com`)

### Option B: Deploy on Railway (Also Free)

1. Go to [railway.app](https://railway.app)
2. New Project → "Deploy from GitHub repo"
3. Select your repository → Railway auto-detects `railway.json`
4. This deploys all services in one go (web, api, db, redis)
5. Set environment variables in Railway dashboard
6. Note the **API domain** after deployment

---

## Step 3: Deploy Frontends to Netlify

### 3.1 Connect to Netlify

1. Go to [netlify.com](https://netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Connect GitHub account
4. Select your repository

### 3.2 Configure Netlify Build Settings

**For the main web app:**
- Build command: `pnpm build --filter @legal-platform/web`
- Publish directory: `apps/web/.next`
- Node version: 22 (via `.node-version`)

**Environment Variables:**
```
NEXT_PUBLIC_API_BASE_URL=https://la-bot-api.onrender.com
NEXT_PUBLIC_APP_ENV=production
```

### 3.3 Deploy

Click "Deploy site" and wait ~3 minutes.

After deployment:
- Note the **Netlify URL** (e.g., `https://la-bot-web.netlify.app`)
- Go to **Site settings** → **Build & deploy** → **Environment** and verify variables

### 3.4 Deploy Advocate Portal (Same Steps)

1. New Netlify site
2. Same GitHub repo, but:
   - Build command: `pnpm build --filter @legal-platform/advocate-portal`
   - Publish directory: `apps/advocate-portal/.next`
3. Same environment variables
4. Deploy

---

## Step 4: Update Backend CORS & Frontend URLs

After all services are deployed:

### 4.1 Update Render Backend Environment Variables

Set these to the actual Netlify URLs:
```
CORS_ORIGINS=https://actual-web-name.netlify.app,https://actual-advocates-name.netlify.app
FRONTEND_BASE_URL=https://actual-web-name.netlify.app
```

### 4.2 Trigger Redeploy

Go to Render dashboard → `la-bot-api` service → "Manual deploy" to pick up the new variables.

---

## Step 5: Test the Full Stack

### 5.1 Check API Health
```bash
curl https://la-bot-api.onrender.com/health
# Should return: {"status": "ok"}
```

### 5.2 Check API Readiness
```bash
curl https://la-bot-api.onrender.com/health/ready
# Should return: {"status": "ok", "db": "ok", "redis": "ok"}
```

### 5.3 Test in Browser

1. Open `https://your-web.netlify.app/`
2. Try the chat feature
3. Create an account
4. Check the advocate directory
5. Test document generation

---

## Troubleshooting

### "API Connection Failed"
- Check `NEXT_PUBLIC_API_BASE_URL` in Netlify environment variables
- Verify the Render backend is running: `curl https://la-bot-api.onrender.com/health`
- Check CORS settings in Render backend match your Netlify URL

### "Database Connection Failed"
- Verify `DATABASE_URL` in Render environment variables
- Check PostgreSQL service is running in Render dashboard
- Verify network access (Render services can access each other by default)

### "LLM Not Configured"
- Add `GEMINI_API_KEY` to Render environment variables
- Verify the key is valid at [aistudio.google.com](https://aistudio.google.com/apikey)
- Trigger a manual redeploy in Render

### "Slow First Request"
- Normal on free tiers (cold start ~3-5s)
- Subsequent requests are faster (<1s)
- Upgrade for faster instances if needed

### Build Fails on Netlify
- Check build logs in Netlify dashboard
- Verify `pnpm install` works locally: `pnpm install && pnpm build`
- Check for missing environment variables
- Ensure `.node-version` matches your local Node version

---

## Cost Breakdown

| Service | Tier | Cost |
|---------|------|------|
| Netlify (Frontend) | Free | $0/month |
| Render (API) | Free | $0/month (auto-suspend) |
| Render (PostgreSQL) | Free | $0/month (auto-suspend) |
| Render (Redis) | Free | $0/month (auto-suspend) |
| Gemini API | Free | $0/month (free tier) |
| **TOTAL** | **Free** | **$0/month** |

> 💡 **Tip**: Upgrade to paid tiers only if you hit rate limits or need persistent uptime.

---

## Production Hardening

Before going to production, consider:

### Security
- [ ] Rotate `API_SECRET_KEY` and `JWT_SECRET` in Render
- [ ] Set up HTTPS (automatic on Netlify/Render)
- [ ] Enable database backups in Render
- [ ] Use a custom domain (Netlify: $12/year)

### Monitoring
- [ ] Set up error tracking (Sentry, Datadog)
- [ ] Monitor API logs in Render dashboard
- [ ] Set up uptime monitoring (Pingdom, Uptime Robot)

### Performance
- [ ] Upgrade Render to paid tier for persistent uptime
- [ ] Use a CDN for static assets (Cloudflare, Akamai)
- [ ] Set up Redis for caching (already included)

---

## Custom Domain (Optional)

### On Netlify
1. Netlify dashboard → "Domain settings"
2. Add custom domain (e.g., `app.example.com`)
3. Follow DNS instructions (Netlify auto-configures if you use their nameservers)

### On Render
1. Render dashboard → API service → "Settings"
2. Add custom domain
3. Update CORS_ORIGINS to use your domain

---

## Environment Variables Cheat Sheet

### Required for LLM

**Option 1: Google Gemini (FREE ⭐)**
```
LLM_PROVIDER=gemini
GEMINI_API_KEY=<get from https://aistudio.google.com/apikey>
```

**Option 2: Groq (FREE)**
```
LLM_PROVIDER=groq
GROQ_API_KEY=<get from https://console.groq.com/keys>
```

**Option 3: Anthropic Claude (PAID)**
```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=<get from https://console.anthropic.com>
```

### All Variables for Render Backend

```bash
# App
APP_ENV=production
LOG_LEVEL=INFO
LOG_FORMAT=json

# Secrets (generate unique values)
API_SECRET_KEY=<generate>
JWT_SECRET=<generate>

# Database (from Render PostgreSQL service)
DATABASE_URL=postgresql+asyncpg://legal:password@pg-xxx.onrender.com:5432/legal_platform
DATABASE_URL_SYNC=postgresql+psycopg://legal:password@pg-xxx.onrender.com:5432/legal_platform

# Cache (from Render Redis service)
REDIS_URL=redis://:password@redis-xxx.onrender.com:6379/0

# CORS (from Netlify URLs)
CORS_ORIGINS=https://web.netlify.app,https://advocates.netlify.app
FRONTEND_BASE_URL=https://web.netlify.app

# LLM (choose one)
LLM_PROVIDER=gemini
GEMINI_API_KEY=<your key>
```

### All Variables for Netlify Frontends

```bash
# App
NEXT_PUBLIC_API_BASE_URL=https://la-bot-api.onrender.com
NEXT_PUBLIC_APP_ENV=production
```

---

## Success Checklist

- [ ] GitHub repository pushed
- [ ] PostgreSQL database created on Render
- [ ] Redis cache created on Render
- [ ] FastAPI backend deployed on Render
- [ ] Main web app deployed on Netlify
- [ ] Advocate portal deployed on Netlify
- [ ] All environment variables set
- [ ] Health check passes: `curl https://api-url/health`
- [ ] Chat works in browser
- [ ] User registration works
- [ ] Advocate directory loads
- [ ] Document generation works

---

## Next Steps

1. **Monitor logs**: Check Render dashboard for API logs
2. **Set up alerts**: Get notified if service goes down
3. **Enable database backups**: Render dashboard → PostgreSQL service → Backups
4. **Upgrade to paid**: For persistent uptime (when free tier gets auto-suspended)
5. **Add custom domain**: Point your own domain to Netlify/Render

---

## References

- [Netlify Docs](https://docs.netlify.com)
- [Render Docs](https://render.com/docs)
- [Railway Docs](https://docs.railway.app)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [FastAPI Deployment](https://fastapi.tiangolo.com/deployment/)

---

**Questions?** Check the logs:
- Netlify: Dashboard → "Deployments" → Deploy logs
- Render: Dashboard → Service → "Logs" tab
