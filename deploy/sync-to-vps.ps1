# KYK Form -> VPS: proje arşivi (scp) + uzakta docker compose up -d --build
# Kullanım:
#   $env:VPS_HOST = "1.2.3.4"; $env:VPS_USER = "root"; .\deploy\sync-to-vps.ps1
# veya:
#   .\deploy\sync-to-vps.ps1 -Host "1.2.3.4" -User "root" -RemoteDir "/opt/kyk-form"
#
# Gereksinim: OpenSSH (ssh, scp) — Windows 10/11 genelde yüklü.
# İlk kurulum: sunucuda hedef klasörde .env oluşturun (.env.example'a bakın); JWT_SECRET ve PUBLIC_FORM_BASE_URL ayarlayın.

param(
  [Alias("Host")]
  [string] $VpsHost = $env:VPS_HOST,
  [string] $User = $(if ($env:VPS_USER) { $env:VPS_USER } else { "root" }),
  [string] $RemoteDir = $(if ($env:VPS_REMOTE_DIR) { $env:VPS_REMOTE_DIR } else { "/opt/kyk-form" })
)

$ErrorActionPreference = "Stop"

if (-not $VpsHost -or $VpsHost.Trim() -eq "") {
  Write-Host "VPS_HOST bos. Ornek:" -ForegroundColor Yellow
  Write-Host '  $env:VPS_HOST = "SUNUCU_IP"; $env:VPS_USER = "root"; .\deploy\sync-to-vps.ps1' -ForegroundColor Gray
  exit 1
}

# deploy/ klasörünün bir üstü = proje kökü
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "docker-compose.yml"))) {
  Write-Error "docker-compose.yml bulunamadi (root: $root)"
  exit 1
}

$tarball = Join-Path $env:TEMP "kyk-form-deploy-$(Get-Date -Format 'yyyyMMdd-HHmmss').tgz"
Write-Host "Arsiv olusturuluyor: $tarball" -ForegroundColor Cyan

Push-Location $root
try {
  # .env paketlenmez (uzaktaki uretim .env korunur)
  tar -czf $tarball `
    --exclude=node_modules `
    --exclude=frontend/node_modules `
    --exclude=backend/node_modules `
    --exclude=frontend/dist `
    --exclude=backend/dist `
    --exclude=.git `
    --exclude=.env `
    .
}
finally {
  Pop-Location
}

$remoteTar = "/tmp/kyk-form-deploy.tgz"
$remoteScript = @"
set -e
mkdir -p '$RemoteDir'
cd '$RemoteDir'
if [ -f .env ]; then cp .env /tmp/kyk-form.env.bak; fi
tar -xzf '$remoteTar'
if [ -f /tmp/kyk-form.env.bak ]; then mv /tmp/kyk-form.env.bak .env; fi
rm -f '$remoteTar'
docker compose up -d --build
docker compose ps
"@

# Uzak bash CRLF ile bozulmasin (set -e hatasi)
$remoteScriptUnix = $remoteScript -replace "`r`n", "`n" -replace "`r", "`n"
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScriptUnix))

Write-Host "Yukleniyor: ${User}@${VpsHost}:$remoteTar" -ForegroundColor Cyan
scp $tarball "${User}@${VpsHost}:$remoteTar"

Write-Host "Uzakta compose calistiriliyor..." -ForegroundColor Cyan
ssh "${User}@${VpsHost}" "echo $b64 | base64 -d | bash"

Remove-Item -Force $tarball -ErrorAction SilentlyContinue
Write-Host "Tamam: http://${VpsHost}/ (veya alan adiniz)" -ForegroundColor Green
