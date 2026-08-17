<#
    JDG Clockwork — build and publish a release.

        .\tools\release.ps1

    What it does, in order:
      1. packs the extension into a signed .crx using your local Chrome
      2. derives the extension ID from the signing key
      3. writes dist\updates.xml (the manifest Chrome polls for updates)
      4. writes dist\install-jdg-clockwork.ps1 with the ID and URLs filled in
      5. creates the GitHub repo if it does not exist, pushes, and publishes
         a release with the .crx, updates.xml and installer attached

    The signing key (key.pem) is created on the first run and reused after
    that. It is gitignored. If you lose it, the extension ID changes and every
    colleague has to be reinstalled — so back it up somewhere private.

    Prerequisites: Chrome, git, and gh (authenticated with `gh auth login`).
#>
[CmdletBinding()]
param(
    [string]$RepoName = 'jdg-clockwork',
    [ValidateSet('public', 'private')]
    [string]$Visibility = 'public',
    [switch]$SkipPublish
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Fail($msg) { Write-Host "  x $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "  - $msg" -ForegroundColor Gray }
function Good($msg) { Write-Host "  + $msg" -ForegroundColor Green }

Write-Host ''
Write-Host '  JDG Clockwork - release' -ForegroundColor Cyan
Write-Host '  =====================================================' -ForegroundColor DarkGray

# ---------------------------------------------------------------- prerequisites
$chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Fail 'Chrome not found - it is what signs the .crx.' }

$openssl = @(
    'openssl',
    "$env:ProgramFiles\Git\mingw64\bin\openssl.exe",
    "$env:ProgramFiles\Git\usr\bin\openssl.exe"
) | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
if (-not $openssl) { Fail 'openssl not found (it ships with Git for Windows).' }

$version = (Get-Content 'manifest.json' -Raw | ConvertFrom-Json).version
Step "version $version"

# ------------------------------------------------------------------- 1. package
$stage = Join-Path $env:TEMP 'jdg-clockwork-pkg'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage | Out-Null

# Only what the browser actually loads. Tests and tooling stay in the repo.
Copy-Item 'manifest.json' $stage
Copy-Item 'icons' $stage -Recurse
Copy-Item 'src' $stage -Recurse

$dist = Join-Path $Root 'dist'
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }

$key = Join-Path $Root 'key.pem'
$packArgs = @("--pack-extension=$stage", '--no-message-box')
if (Test-Path $key) {
    $packArgs += "--pack-extension-key=$key"
    Step 'reusing existing key.pem'
}
else {
    Step 'no key.pem yet - generating one (BACK THIS UP)'
}

& $chrome $packArgs | Out-Null

# Chrome writes <stage>.crx / <stage>.pem next to the staged folder, and does it
# asynchronously, so wait for the file rather than assuming it is there.
$crxOut = "$stage.crx"
$pemOut = "$stage.pem"
$waited = 0
while (-not (Test-Path $crxOut) -and $waited -lt 30) { Start-Sleep -Milliseconds 500; $waited++ }
if (-not (Test-Path $crxOut)) { Fail 'Chrome did not produce a .crx. Close any running "chrome --pack-extension" and retry.' }

if ((Test-Path $pemOut) -and -not (Test-Path $key)) { Move-Item $pemOut $key }
elseif (Test-Path $pemOut) { Remove-Item $pemOut -Force }

$crx = Join-Path $dist 'jdg-clockwork.crx'
Move-Item $crxOut $crx -Force
Good "packed $([math]::Round((Get-Item $crx).Length / 1KB)) KB -> dist\jdg-clockwork.crx"

# --------------------------------------------------------------- 2. extension id
# Chrome's ID is the first 16 bytes of the SHA-256 of the DER public key, with
# each hex nibble mapped 0-f onto a-p.
$der = Join-Path $env:TEMP 'jdg-clockwork-pub.der'
& $openssl rsa -in $key -pubout -outform DER -out $der 2>$null
if (-not (Test-Path $der)) { Fail 'Could not export the public key with openssl.' }

$sha = (Get-FileHash $der -Algorithm SHA256).Hash.Substring(0, 32).ToLower()
Remove-Item $der -Force
$extId = -join ($sha.ToCharArray() | ForEach-Object {
        [char]([int][char]'a' + [Convert]::ToInt32([string]$_, 16))
    })
Good "extension id $extId"

# ------------------------------------------------------------------ 3. manifests
try { $ghUser = (gh api user --jq .login 2>$null) } catch { $ghUser = $null }
if (-not $ghUser) { Fail 'gh is not authenticated. Run:  gh auth login' }

$repoUrl    = "https://github.com/$ghUser/$RepoName"
$assetBase  = "$repoUrl/releases/latest/download"
$updateUrl  = "$assetBase/updates.xml"
$installUrl = "$assetBase/install-jdg-clockwork.ps1"

$updatesXml = @"
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='$extId'>
    <updatecheck codebase='$assetBase/jdg-clockwork.crx' version='$version' />
  </app>
</gupdate>
"@
Set-Content -Path (Join-Path $dist 'updates.xml') -Value $updatesXml -Encoding utf8
Good 'wrote dist\updates.xml'

$installer = Get-Content (Join-Path $PSScriptRoot 'install-template.ps1') -Raw
$installer = $installer.Replace('{{EXT_ID}}', $extId)
$installer = $installer.Replace('{{UPDATE_URL}}', $updateUrl)
$installer = $installer.Replace('{{REPO_URL}}', $repoUrl)
$installer = $installer.Replace('{{INSTALL_URL}}', $installUrl)
Set-Content -Path (Join-Path $dist 'install-jdg-clockwork.ps1') -Value $installer -Encoding utf8
Good 'wrote dist\install-jdg-clockwork.ps1'

if ($SkipPublish) {
    Write-Host ''
    Write-Host '  Built only (-SkipPublish). Nothing was pushed.' -ForegroundColor Yellow
    Write-Host ''
    return
}

# --------------------------------------------------------------------- 4. publish
$remote = (git remote get-url origin 2>$null)
if (-not $remote) {
    Step "creating $Visibility repo $ghUser/$RepoName"
    gh repo create $RepoName --$Visibility --source=. --remote=origin --push
    if ($LASTEXITCODE -ne 0) { Fail 'gh repo create failed.' }
}
else {
    Step "pushing to $remote"
    git push -u origin main
    if ($LASTEXITCODE -ne 0) { Fail 'git push failed.' }
}
Good 'pushed'

$tag = "v$version"
$notes = @"
Install on a colleague's machine (Windows, no admin needed):

``````powershell
iwr -useb $installUrl | iex
``````

Restart Chrome afterwards. To remove it later, save that script and run it with ``-Uninstall``.

Extension ID: ``$extId``
"@

gh release view $tag *> $null
if ($LASTEXITCODE -eq 0) {
    Step "release $tag exists - replacing its assets"
    gh release upload $tag "$dist\jdg-clockwork.crx" "$dist\updates.xml" "$dist\install-jdg-clockwork.ps1" --clobber
}
else {
    gh release create $tag "$dist\jdg-clockwork.crx" "$dist\updates.xml" "$dist\install-jdg-clockwork.ps1" `
        --title "JDG Clockwork $version" --notes $notes
}
if ($LASTEXITCODE -ne 0) { Fail 'gh release failed.' }

Write-Host ''
Good "published $repoUrl/releases/tag/$tag"
Write-Host ''
Write-Host '  Send colleagues this one line:' -ForegroundColor Cyan
Write-Host ''
Write-Host "      iwr -useb $installUrl | iex" -ForegroundColor White
Write-Host ''
Write-Host '  Keep key.pem safe - it is what lets you ship updates.' -ForegroundColor DarkGray
Write-Host ''
