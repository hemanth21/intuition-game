# 🚀 Intuition Game — Deployment Guide

## ⚠️ Hostinger Reality Check

**Hostinger shared hosting** only supports **outgoing** WebSocket connections.
You CANNOT run a WebSocket server (our Python backend) on shared hosting.

We need: **Static frontend** → Hostinger + **Backend** → somewhere that supports WebSockets.

---

## 🏆 Option A: Hostinger Shared + Free Render Backend (Recommended — $0/month)

| Part | Where | Cost |
|------|-------|------|
| Frontend (React) | Hostinger (your domain) | $0 (already paid) |
| Backend (Python WS) | Render.com free tier | $0 |

### Step 1: Deploy frontend to Hostinger
```bash
# Build the frontend
cd /root/intuition-game/frontend
npm run build

# Upload dist/ folder to Hostinger via FTP or File Manager
# Put contents in: public_html/   (root of your domain)
```

### Step 2: Deploy backend to Render
1. Go to https://render.com → Sign up (GitHub login)
2. Click **New +** → **Web Service**
3. Connect your GitHub repo (or use manual deploy)
4. Settings:
   - **Name:** intuition-backend
   - **Environment:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port 10000`
   - **Free tier:** Yes (sleeps after inactivity, wakes on request)
5. Note your render URL: `https://intuition-backend.onrender.com`

### Step 3: Update WebSocket URL
Edit `frontend/src/App.jsx`:
```js
const WS_URL = isDev
  ? "ws://localhost:8765/ws"
  : "wss://intuition-backend.onrender.com/ws";  // ← YOUR RENDER URL
```
Rebuild and re-upload: `npm run build`

---

## 🏆 Option B: All-in-one VPS (Recommended if you want full control — $5-15/month)

| Part | Where | Cost |
|------|-------|------|
| Everything | Hostinger VPS (KVM 1 or higher) | ~$5/mo |
| OR | Any cheap VPS (DigitalOcean, Hetzner, OVH) | ~$5/mo |

### Setup on a Ubuntu/Debian VPS:

```bash
# 1. Install dependencies
apt update && apt install -y nginx python3-pip certbot python3-certbot-nginx

# 2. Clone/copy the project
scp -r /root/intuition-game user@your-vps-ip:~/

# 3. Build frontend
cd ~/intuition-game/frontend
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install && npm run build

# 4. Install backend deps
cd ~/intuition-game/backend
pip install -r requirements.txt

# 5. Set up backend as a service
sudo cp intuition-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now intuition-backend

# 6. Nginx config
sudo cp nginx-intuition.conf /etc/nginx/sites-available/intuition
sudo ln -s /etc/nginx/sites-available/intuition /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 7. SSL (after pointing DNS)
sudo certbot --nginx -d yourdomain.com
```

### Point your Hostinger domain to the VPS:
1. Go to Hostinger → Domains → DNS/Nameservers
2. Add an **A record**: `@` → `<VPS_IP_ADDRESS>`
3. Wait for propagation (5-30 min)

---

## 🏆 Option C: Cheapest Hybrid ($0+domain)

| Part | Where | Cost |
|------|-------|------|
| Frontend | GitHub Pages / Netlify | $0 |
| Backend | Railway / Render | $0-5 |
| Domain | Hostinger (point to frontend) | Already paid |

Same as Option A but use free frontend hosting instead of Hostinger.

---

## 📁 Port Reference

| Service | Dev Port | Production Port |
|---------|----------|-----------------|
| Frontend (Vite) | 5173 | N/A (static files via nginx) |
| Backend (FastAPI) | 8765 | 8765 (proxied via nginx) |
| Nginx (HTTPS) | — | 443 (SSL) |

---

## 🔧 Environment Config

The frontend auto-detects the WS URL. For production, set it in `App.jsx`:

```js
// For Render/Railway/VPS
// Option 1: Same domain, nginx proxies /ws → backend (Option B)
//  → no change needed (auto-detects)

// Option 2: Separate backend domain (Option A)
const WS_URL = isDev
  ? "ws://localhost:8765/ws"
  : "wss://your-backend.onrender.com/ws";
```

---

## ✅ Post-Deployment Checklist

- [ ] Frontend loads on your domain
- [ ] WebSocket connects (check browser DevTools → Network → WS)
- [ ] Can join queue
- [ ] Two players can match and play
- [ ] Timer works
- [ ] Results screen shows guess history
- [ ] SSL certificate valid (green padlock)
