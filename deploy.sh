#!/usr/bin/env bash
set -euo pipefail

remote="${DEPLOY_REMOTE:-ubuntu@129.226.95.14}"
target="${DEPLOY_TARGET:-/home/ubuntu/slide}"
backup_name="slide-backup-$(date +%Y%m%d-%H%M%S).tar.gz"

ssh -o BatchMode=yes -o ConnectTimeout=15 "$remote" \
  "tar -czf /home/ubuntu/${backup_name} -C /home/ubuntu slide"

rsync -az --delete -e 'ssh -o BatchMode=yes -o ConnectTimeout=15' \
  --exclude='.git/' \
  --exclude='.gitignore' \
  --exclude='tokenslide.md' \
  --exclude='**/*token*.md' \
  --exclude='**/*token*.txt' \
  --exclude='**/*token*.json' \
  --exclude='*.credentials' \
  --exclude='*.secret' \
  --exclude='credentials/' \
  --exclude='secrets/' \
  ./ "${remote}:${target}/"

ssh -o BatchMode=yes -o ConnectTimeout=15 "$remote" \
  "sudo install -m 0644 ${target}/.auth/slide.gezytech.web.id.nginx.conf /etc/nginx/sites-available/slide.gezytech.web.id && \
   sudo install -m 0644 ${target}/.auth/slide.gezytech.web.id.nginx.conf /etc/nginx/sites-enabled/slide.gezytech.web.id && \
   sudo install -m 0644 ${target}/.auth/gezyslide-auth.service /etc/systemd/system/gezyslide-auth.service && \
   sudo nginx -t && \
   sudo systemctl daemon-reload && \
   sudo systemctl restart gezyslide-auth.service && \
   sudo systemctl reload nginx"

printf 'Deployed %s to %s\n' "$(git rev-parse --short HEAD)" "$remote:$target"
