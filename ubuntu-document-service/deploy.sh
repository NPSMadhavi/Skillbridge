#!/usr/bin/env bash
# SkillBridge Ubuntu Document Processing Service — Deployment Script
# Run this on the Ubuntu AI server as a user with sudo access.
# Usage: bash deploy.sh
set -euo pipefail

REPO_DIR="${SKILLBRIDGE_REPO_DIR:-/opt/skillbridge}"
SERVICE_DIR="$REPO_DIR/ubuntu-document-service"
VENV_DIR="$SERVICE_DIR/.venv"
SERVICE_USER="${SKILLBRIDGE_USER:-$(whoami)}"
PORT=8094

echo "================================================"
echo " SkillBridge Document Service Deployment"
echo " Service dir : $SERVICE_DIR"
echo " Port        : $PORT"
echo " User        : $SERVICE_USER"
echo "================================================"

# 1. Pull latest code
echo "[1/7] Pulling latest code from GitHub main..."
cd "$REPO_DIR"
git pull origin main

# 2. Create / update Python venv
echo "[2/7] Setting up Python virtual environment..."
cd "$SERVICE_DIR"
if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
deactivate

# 3. Ensure temp directory exists
echo "[3/7] Creating temp directory..."
mkdir -p /tmp/skillbridge_docs

# 4. Write systemd service file
echo "[4/7] Installing systemd service..."
sudo tee /etc/systemd/system/skillbridge-docservice.service > /dev/null <<EOF
[Unit]
Description=SkillBridge Ubuntu Document Processing Service
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$SERVICE_DIR
Environment="PATH=$VENV_DIR/bin:/usr/bin:/bin"
Environment="SKILLBRIDGE_API_KEY=${SKILLBRIDGE_API_KEY:-}"
Environment="OLLAMA_BASE_URL=http://127.0.0.1:11434"
Environment="OLLAMA_MODEL=qwen3.5:9b"
Environment="EMBEDDING_MODEL=BAAI/bge-m3"
Environment="EMBEDDING_DIM=768"
Environment="WORKER_CONCURRENCY=2"
Environment="MAX_FILE_SIZE_MB=100"
Environment="JOB_TTL_SECONDS=3600"
Environment="DOC_TEMP_DIR=/tmp/skillbridge_docs"
ExecStart=$VENV_DIR/bin/uvicorn app:app --host 127.0.0.1 --port $PORT --workers 1
Restart=on-failure
RestartSec=5
TimeoutStartSec=120
StandardOutput=journal
StandardError=journal
SyslogIdentifier=skillbridge-docservice

[Install]
WantedBy=multi-user.target
EOF

# 5. Reload systemd and (re)start service
echo "[5/7] Starting systemd service..."
sudo systemctl daemon-reload
sudo systemctl enable skillbridge-docservice
sudo systemctl restart skillbridge-docservice
sleep 3
sudo systemctl status skillbridge-docservice --no-pager

# 6. Configure Nginx proxy (append snippet if not already present)
echo "[6/7] Configuring Nginx proxy..."
NGINX_CONF="/etc/nginx/sites-enabled/skillbridge-docservice.conf"
if [ ! -f "$NGINX_CONF" ]; then
  sudo tee "$NGINX_CONF" > /dev/null <<'NGINXEOF'
# SkillBridge Document Processing Service proxy — port 8094
# This file is managed by deploy.sh. Do NOT edit manually.
server {
    # This block is a sub-location block; include it inside your existing
    # server { ... } that listens on 443 / rtxsvr domain,
    # OR keep this as a standalone include and add it to your main server block:
    #   include /etc/nginx/sites-enabled/skillbridge-docservice.conf;

    location /api/v1/documents/process {
        proxy_pass         http://127.0.0.1:8094;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 110m;
    }

    location /api/v1/documents/jobs/ {
        proxy_pass         http://127.0.0.1:8094;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        client_max_body_size 1m;
    }
}
NGINXEOF
  echo "    -> Nginx conf written to $NGINX_CONF"
  echo "    IMPORTANT: Add these two location blocks to your EXISTING Nginx server block"
  echo "    that handles rtxsvr.tail59469f.ts.net on port 443, then run:"
  echo "       sudo nginx -t && sudo systemctl reload nginx"
else
  echo "    -> Nginx conf already exists at $NGINX_CONF (not overwritten)"
fi

# 7. Quick health check
echo "[7/7] Running health check..."
sleep 2
curl -sf http://127.0.0.1:8094/health && echo "" && echo "✓ Document service is healthy on port $PORT" || echo "⚠ Health check failed — check: sudo journalctl -u skillbridge-docservice -n 50"

echo ""
echo "================================================"
echo " Deployment complete!"
echo ""
echo " Next steps if Nginx proxy was just written:"
echo "   1. Copy the two 'location' blocks from:"
echo "      $NGINX_CONF"
echo "      into your existing HTTPS server block."
echo "   2. sudo nginx -t && sudo systemctl reload nginx"
echo "   3. Test from Plesk:"
echo "      curl -H 'X-API-Key: \$SKILLBRIDGE_API_KEY' \\"
echo "           https://rtxsvr.tail59469f.ts.net/api/v1/documents/process"
echo "================================================"
