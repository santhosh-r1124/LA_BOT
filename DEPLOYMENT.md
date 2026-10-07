# LA_BOT Deployment Guide - FREE Hosting

## 🚀 Quick Deploy (5 minutes)

### Option 1: Vercel (Recommended - Fastest)
```bash
# 1. Push to GitHub
git push origin claude/cool-wright-95j17z

# 2. Go to https://vercel.com
# 3. Import repository
# 4. Set environment variables (see below)
# 5. Deploy!
```

### Option 2: Railway (Also Free)
```bash
# Go to https://railway.app
# Connect GitHub → Deploy
```

### Option 3: Render (Free Tier)
```bash
# https://render.com
# Connect GitHub repository
# Deploy web service
```

## 🔑 Required Environment Variables

### For LLM (Choose ONE):

**Option A: Google Gemini (FREE)** ⭐ Recommended
```
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_LLM_MODEL=gemini-2.0-flash
```
Get free key: https://ai.google.dev/

**Option B: GroqCloud (FREE)**
```
LLM_PROVIDER=groq
GROQ_API_KEY=your_key_here
GROQ_MODEL=mixtral-8x7b-32768
```
Get free key: https://console.groq.com/

**Option C: Ollama (Local, 100% FREE)**
```
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2
```

### Database & Other Services
```
API_PORT=8000
WEB_PORT=3000
APP_ENV=production
LOG_LEVEL=INFO
```

## 📋 Pre-Deployment Checklist

- [ ] All environment variables set
- [ ] Database configured (if needed)
- [ ] LLM provider API key obtained
- [ ] Code pushed to GitHub
- [ ] `.env` file NOT in git (add to .gitignore)

## 🌐 Free Hosting Platforms Comparison

| Platform | Cost | Setup | Domain | Support |
|----------|------|-------|--------|---------|
| **Vercel** | FREE | 2 min | vercel.app | Excellent |
| **Railway** | FREE | 3 min | railway.app | Good |
| **Render** | FREE | 3 min | render.com | Good |
| **Netlify** | FREE | 2 min | netlify.app | Excellent |
| **Heroku** | Paid | 3 min | herokuapp.com | Good |

## 🔐 Free LLM Providers Comparison

| Provider | Cost | Speed | Quality | Rate Limit |
|----------|------|-------|---------|-----------|
| **Gemini** | FREE | Fast | Excellent | 15 req/min |
| **GroqCloud** | FREE | Very Fast | Good | High |
| **Ollama** | FREE | Local | Good | Unlimited |

## ✅ Deployment Steps

### Step 1: Prepare Code
```bash
cd /home/user/LA_BOT
git add .
git commit -m "Ready for deployment"
git push origin claude/cool-wright-95j17z
```

### Step 2: Create on Vercel
1. Visit https://vercel.com
2. Click "New Project"
3. Import your GitHub repo
4. Add environment variables
5. Deploy!

### Step 3: Test
```bash
curl https://your-deployment.vercel.app/api/health
```

## 📱 Custom Domain (FREE)

- Add Vercel domain for FREE
- Or use Cloudflare (free DNS)

## 🆘 Troubleshooting

**"LLM not configured"**
- Check environment variables are set correctly
- Verify API key in provider dashboard

**"Database connection failed"**
- Ensure database service is running
- Check DATABASE_URL in env

**"Slow response"**
- First request has cold start (~5s) - normal
- Subsequent requests should be <1s

---

**Ready? Start with Vercel → takes 5 minutes!**
