# Compile the Windows setup.exe with Inno Setup (ISCC).
# Prerequisites: npm run build  (stages dist/installer-win/)
#                Inno Setup 6 installed

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$IssDir = Join-Path $Root "dist\installer-win"
$Iss = Join-Path $IssDir "oesf-lpr-agent.iss"

if (-not (Test-Path $Iss)) {
  Write-Error "Missing $Iss — run: npm run build"
}

$candidates = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
  "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe"
)
$iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) {
  Write-Error "Inno Setup 6 (ISCC.exe) not found. Install from https://jrsoftware.org/isinfo.php"
}

Write-Host "→ $iscc $Iss"
& $iscc $Iss
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Get-ChildItem (Join-Path $Root "dist") -Filter "oesf-lpr-agent-*-setup-win-x64.exe" |
  ForEach-Object { Write-Host "✓ $($_.FullName)" }
