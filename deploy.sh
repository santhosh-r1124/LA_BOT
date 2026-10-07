#!/bin/bash
# Quick deployment helper script

set -e

echo "🚀 LA_BOT Deployment Helper"
echo "============================"
echo ""

# Check if git repo
if [ ! -d ".git" ]; then
    echo "❌ Not a git repository. Run: git init"
    exit 1
fi

echo "📋 Pre-deployment checklist:"
echo ""

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  Uncommitted changes detected:"
    git status --short
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check .env files
echo "✓ Environment files:"
[ -f ".env" ] && echo "  ✓ .env exists"
[ -f ".env.production" ] && echo "  ✓ .env.production exists"
[ -f ".env.example" ] && echo "  ✓ .env.example exists"
echo ""

# Check deployment configs
echo "✓ Deployment configs:"
[ -f "vercel.json" ] && echo "  ✓ vercel.json (for Vercel)"
[ -f "railway.json" ] && echo "  ✓ railway.json (for Railway)"
[ -f "package.json" ] && echo "  ✓ package.json"
echo ""

# Display deployment options
echo "🌐 Deployment Platforms (FREE):"
echo ""
echo "1. Vercel (Recommended)"
echo "   - Visit: https://vercel.com"
echo "   - Connect GitHub repo"
echo "   - Add env vars"
echo "   - Deploy!"
echo ""
echo "2. Railway"
echo "   - Visit: https://railway.app"
echo "   - Connect GitHub repo"
echo "   - Deploy!"
echo ""
echo "3. Render"
echo "   - Visit: https://render.com"
echo "   - Connect GitHub repo"
echo "   - Deploy!"
echo ""

# Display LLM options
echo "🤖 Free LLM Providers:"
echo ""
echo "1. Google Gemini (Recommended)"
echo "   - Get API key: https://ai.google.dev"
echo "   - Set: GEMINI_API_KEY in deployment config"
echo ""
echo "2. GroqCloud"
echo "   - Get API key: https://console.groq.com"
echo "   - Set: GROQ_API_KEY in deployment config"
echo ""
echo "3. Ollama (Local)"
echo "   - Download: https://ollama.ai"
echo "   - 100% free, runs locally"
echo ""

echo "✅ Ready to deploy!"
echo ""
echo "Next steps:"
echo "1. Get a FREE LLM API key from one of the providers above"
echo "2. Push to GitHub: git push origin claude/cool-wright-95j17z"
echo "3. Go to Vercel/Railway/Render and connect your repo"
echo "4. Add environment variables in the platform dashboard"
echo "5. Deploy!"
echo ""
echo "📚 Full guide: cat DEPLOYMENT.md"
