# Netlify Deployment - Quick Start (10 minutes)

**Goal**: Deploy LA_BOT to production with working LLM features.

---

## What You'll Get

✅ Web app at `https://la-bot-web.netlify.app`  
✅ Advocate portal at `https://la-bot-advocates.netlify.app`  
✅ Working chat with AI responses  
✅ Full user authentication  
✅ Advocate directory search  
✅ Document generation  
✅ **ZERO cost** (free tier)  

---

## Prerequisites (2 minutes)

1. **GitHub account** with your LA_BOT repo pushed
2. **Google AI Studio key** (free): https://aistudio.google.com/apikey
3. **Render account** (free): https://render.com (for the backend)
4. **Netlify account** (free): https://netlify.com

---

## The 5-Step Deployment

### Step 1: Deploy Backend to Render (3 minutes)

**Why Netlify can't run the backend**: Netlify hosts frontends only. The Python FastAPI backend needs a service that supports Python.

1. Go to [render.com](https://render.com)
2. Login with GitHub
3. Click "New +" button
4. Select "Web Service"
5. Choose your `santhosh-r1124/la_bot` repository

**Configure the service:**
```
Name: la-bot-api
Runtime: Python 3.12
Build Command:
  cd apps/api && pip install uv && uv sync && uv run alembic upgrade head

Start Command:
  cd apps/api && uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT

Region: Closest to you
```

6. Click "Create Web Service"
7. Wait for build to complete (~5 minutes)
8. **Copy your API URL** (looks like `https://la-bot-api.onrender.com`)

**Add Environment Variables** in Render:

Go to Service Settings → Environment, then add:

```bash
APP_ENV=production
LOG_LEVEL=INFO
LOG_FORMAT=json
API_SECRET_KEY=<run: python -c "import secrets; print(secrets.token_urlsafe(48))">
JWT_SECRET=<run: python -c "import secrets; print(secrets.token_urlsafe(48))">
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/legal_platform
DATABASE_URL_SYNC=postgresql+psycopg://postgres:postgres@localhost:5432/legal_platform
REDIS_URL=redis://redis:6379/0
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
FRONTEND_BASE_URL=http://localhost:3000
LLM_PROVIDER=gemini
GEMINI_API_KEY=<your API key from https://aistudio.google.com/apikey>
```

> ℹ️ **Note**: Render provides a free PostgreSQL and Redis instance with the free tier.

### Step 2: Deploy Web App to Netlify (2 minutes)

1. Go to [netlify.com](https://netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Connect your GitHub account
4. Select your repository (`santhosh-r1124/la_bot`)

**Configure build settings:**
- Build command: `pnpm build --filter @legal-platform/web`
- Publish directory: `apps/web/.next`
- Node version: 22 (from `.node-version`)

**Add Environment Variables:**

Go to Site Settings → Build & deploy → Environment

```bash
NEXT_PUBLIC_API_BASE_URL=https://la-bot-api.onrender.com
NEXT_PUBLIC_APP_ENV=production
```

5. Click "Deploy"
6. Wait ~2 minutes
7. **Copy your Netlify URL** (looks like `https://la-bot-web.netlify.app`)

### Step 3: Deploy Advocate Portal to Netlify (2 minutes)

Repeat Step 2, but:
- Build command: `pnpm build --filter @legal-platform/advocate-portal`
- Publish directory: `apps/advocate-portal/.next`
- Same environment variables

---

## Step 4: Update Backend CORS (1 minute)

Now that you have your Netlify URLs, update the backend:

1. Go to Render dashboard
2. Select `la-bot-api` service
3. Go to Settings → Environment
4. Update `CORS_ORIGINS`:
   ```
   https://la-bot-web.netlify.app,https://la-bot-advocates.netlify.app
   ```
5. Update `FRONTEND_BASE_URL`:
   ```
   https://la-bot-web.netlify.app
   ```
6. Scroll down and click "Save" → "Manual Deploy"

---

## Step 5: Test! 🎉

1. Open your web app: `https://la-bot-web.netlify.app`
2. Try the chat (should get responses from Google Gemini)
3. Create an account
4. Browse advocates
5. Generate a document

---

## If Something Breaks

### "Cannot connect to API"
```bash
# Check if backend is running
curl https://la-bot-api.onrender.com/health
```

If it returns `{"status":"ok"}`, your backend is fine.

**Solution**: Check `NEXT_PUBLIC_API_BASE_URL` in Netlify settings is correct.

### "LLM Not Configured"
**Solution**: 
1. Add `GEMINI_API_KEY` to Render environment
2. Get a key: https://aistudio.google.com/apikey
3. Trigger manual deploy on Render

### "Database Connection Failed"
Render's free PostgreSQL auto-suspends. 

**Solution**:
1. Upgrade to paid or use Supabase PostgreSQL (free tier)
2. Update `DATABASE_URL` in Render to your Supabase URL

---

## One-Liner Status Check

```bash
# Check everything is deployed
echo "Web app: https://la-bot-web.netlify.app"
echo "Advocates: https://la-bot-advocates.netlify.app"
echo "API: https://la-bot-api.onrender.com/health"
curl -s https://la-bot-api.onrender.com/health | jq .
```

---

## Monthly Cost

| Service | Free Tier | Cost |
|---------|-----------|------|
| Netlify | ✅ Yes | $0 |
| Render | ✅ Yes (auto-suspend) | $0 |
| Gemini API | ✅ Yes (free tier) | $0 |
| **Total** | | **$0** |

> **Note**: Render's free tier auto-suspends after 15 minutes of inactivity. Each request wakes it up (~30s). Upgrade to $7/month for always-on.

---

## Next Steps

1. **Use a custom domain** (Netlify: Settings → Domain)
2. **Monitor logs** (Render: Service → Logs)
3. **Set up analytics** (Netlify: Analytics)
4. **Upgrade for persistence** (Render: Switch to paid when ready)

---

## Reference Docs

- Full deployment guide: [`NETLIFY_DEPLOYMENT.md`](./NETLIFY_DEPLOYMENT.md)
- Architecture diagram: [See NETLIFY_DEPLOYMENT.md](./NETLIFY_DEPLOYMENT.md#architecture-overview)
- Troubleshooting: [See NETLIFY_DEPLOYMENT.md](./NETLIFY_DEPLOYMENT.md#troubleshooting)

---

**Done!** Your LA_BOT is now live. 🚀

Have questions? Check the full guide in [`NETLIFY_DEPLOYMENT.md`](./NETLIFY_DEPLOYMENT.md).
