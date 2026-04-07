#!/usr/bin/env bash
# VPS'te calistir:  cd ~/kyk-form && bash deploy/vps-github-baglanti.sh
# GitHub: HTTPS (PAT) veya SSH deploy key — kurumsal agda genelde biri acilir.

set -euo pipefail
REPO_DIR="${1:-$HOME/kyk-form}"
KEY_FILE="$HOME/.ssh/id_ed25519_github_kykform"
MARKER="# kykform-github-deploy"

echo "=== Baglanti testleri ==="
HTTPS_OK=0
if curl -sI --connect-timeout 12 https://github.com 2>/dev/null | head -1 | grep -qE 'HTTP/[0-9]'; then
  HTTPS_OK=1
  echo "HTTPS github.com: OK"
else
  echo "HTTPS github.com: ERISILEMIYOR (443)"
fi

SSH22_OK=0
if command -v nc >/dev/null 2>&1; then
  if nc -z -w 5 github.com 22 2>/dev/null; then SSH22_OK=1; echo "SSH github.com:22: OK"; else echo "SSH github.com:22: KAPALI"; fi
elif timeout 5 bash -c 'cat < /dev/null > /dev/tcp/github.com/22' 2>/dev/null; then
  SSH22_OK=1
  echo "SSH github.com:22: OK"
else
  echo "SSH github.com:22: test edilemedi / kapali"
fi

echo ""

if [[ "$HTTPS_OK" -eq 1 ]]; then
  echo ">>> HTTPS calisiyorsa — Personal Access Token ile (repo private ise sart):"
  echo "    GitHub -> Settings -> Developer settings -> Personal access tokens"
  echo "    Yetki: repo (veya fine-grained: Contents Read)"
  echo ""
  echo "    git -C \"$REPO_DIR\" remote set-url origin https://github.com/atlyatky/kykform.git"
  echo "    git -C \"$REPO_DIR\" pull  # kullanici: GitHub kullanici adi, sifre: TOKEN"
  echo ""
fi

if [[ "$SSH22_OK" -eq 1 ]]; then
  echo ">>> SSH (deploy key) — sunucuda kalir, onerilen:"
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  [[ -f "$KEY_FILE" ]] || ssh-keygen -t ed25519 -f "$KEY_FILE" -N "" -C "kykform-vps"
  touch "$HOME/.ssh/config"
  if ! grep -qF "$MARKER" "$HOME/.ssh/config" 2>/dev/null; then
    cat >> "$HOME/.ssh/config" << EOF

$MARKER
Host github.com
  HostName github.com
  User git
  IdentityFile $KEY_FILE
  IdentitiesOnly yes
EOF
  fi
  echo ""
  echo "---- Bu public key'i GitHub'a ekle: Repo -> Settings -> Deploy keys -> Add key ----"
  cat "${KEY_FILE}.pub"
  echo "--------------------------------------------------------------------------------"
  echo "Ekledikten sonra Enter..."
  read -r _
  git -C "$REPO_DIR" remote set-url origin git@github.com:atlyatky/kykform.git
  ssh -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 || true
  git -C "$REPO_DIR" fetch origin
  echo "fetch tamam."
fi

if [[ "$HTTPS_OK" -eq 0 && "$SSH22_OK" -eq 0 ]]; then
  echo "443 ve 22 kapali — ag ekibi: cikis izni (github.com) veya HTTP proxy:"
  echo "  export https_proxy=http://KULLANICI:SIFRE@proxy.sirket:8080"
  exit 1
fi

echo ""
echo "Son: cd \"$REPO_DIR\" && git pull origin main && docker compose up -d --build"
