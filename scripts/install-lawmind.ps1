$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:LAWMIND_REPO_URL) { $env:LAWMIND_REPO_URL } else { "https://github.com/sunhl4/LawMind.git" }
$RepoBranch = if ($env:LAWMIND_REPO_BRANCH) { $env:LAWMIND_REPO_BRANCH } else { "main" }
$InstallDir = if ($env:LAWMIND_INSTALL_DIR) { $env:LAWMIND_INSTALL_DIR } else { Join-Path $HOME ".lawmind\openclaw" }
$Preset = if ($env:LAWMIND_PRESET) { $env:LAWMIND_PRESET } else { "qwen-chatlaw" }

Write-Host "[LawMind Installer] Windows one-click install"
Write-Host "repo: $RepoUrl"
Write-Host "branch: $RepoBranch"
Write-Host "install dir: $InstallDir"
Write-Host "preset: $Preset"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

Require-Command git
Require-Command node
Require-Command npm

$NodeVersionRaw = node -v
$NodeMajor = [int]($NodeVersionRaw.TrimStart("v").Split(".")[0])
if ($NodeMajor -lt 22) {
  throw "Node 22+ required. current: $NodeVersionRaw"
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "[LawMind Installer] pnpm not found, installing globally..."
  npm install -g pnpm | Out-Host
}

$ParentDir = Split-Path -Parent $InstallDir
if (-not (Test-Path $ParentDir)) {
  New-Item -ItemType Directory -Path $ParentDir -Force | Out-Null
}

if (Test-Path (Join-Path $InstallDir ".git")) {
  Write-Host "[LawMind Installer] updating existing checkout..."
  git -C $InstallDir fetch origin $RepoBranch | Out-Host
  git -C $InstallDir checkout $RepoBranch | Out-Host
  git -C $InstallDir pull --rebase origin $RepoBranch | Out-Host
} else {
  Write-Host "[LawMind Installer] cloning repo..."
  git clone --branch $RepoBranch $RepoUrl $InstallDir | Out-Host
}

Set-Location $InstallDir

Write-Host "[LawMind Installer] installing dependencies..."
pnpm install | Out-Host

Write-Host "[LawMind Installer] running onboarding..."
npm run lawmind:onboard -- --preset $Preset --yes --skip-smoke | Out-Host

Write-Host "[LawMind Installer] running env check..."
try {
  npm run lawmind:env:check | Out-Host
} catch {
  Write-Warning "env check reported issues; continue after filling .env.lawmind."
}

Write-Host ""
Write-Host "✅ Install complete."
Write-Host "Next:"
Write-Host "  cd `"$InstallDir`""
Write-Host "  npm run lawmind:smoke -- --fail-on-empty-claims"
Write-Host "  npm run lawmind:agent"
