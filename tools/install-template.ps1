<#
    JDG Clockwork — installer
    ------------------------------------------------------------------
    Installs the Clockwork extension into Chrome (and Edge, if present)
    for the CURRENT USER. No admin rights, no clicking through
    chrome://extensions.

    It works by writing a Chrome enterprise policy under HKCU, which
    tells the browser to fetch and install the extension from GitHub and
    to keep it up to date automatically.

    Run:        iwr -useb {{INSTALL_URL}} | iex
    Uninstall:  save this file and run  .\install-jdg-clockwork.ps1 -Uninstall

    Two things worth knowing before you run it:
      * A policy-installed extension cannot be turned off or removed from
        chrome://extensions. Use -Uninstall to take it back off.
      * The extension only ever runs on team.justdigitalgurus.com, and it
        only reads your own attendance. Source: {{REPO_URL}}
#>
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$ExtensionId = '{{EXT_ID}}'
$UpdateUrl   = '{{UPDATE_URL}}'
$RepoUrl     = '{{REPO_URL}}'

$Browsers = @(
    @{ Name = 'Chrome'; Policy = 'HKCU:\SOFTWARE\Policies\Google\Chrome'; Process = 'chrome' },
    @{ Name = 'Edge';   Policy = 'HKCU:\SOFTWARE\Policies\Microsoft\Edge'; Process = 'msedge' }
)

function Write-Step($msg, $colour = 'Gray') {
    if (-not $Quiet) { Write-Host $msg -ForegroundColor $colour }
}

function Test-BrowserInstalled($process) {
    $paths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    if ($process -eq 'msedge') {
        $paths = @(
            "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
        )
    }
    foreach ($p in $paths) { if (Test-Path $p) { return $true } }
    return $false
}

# The forcelist is a numbered list of "<id>;<update url>" strings. Reuse our own
# slot if it is already there; otherwise take the first free number, so we never
# stomp on an extension somebody else's policy installed.
function Set-ForcelistEntry($policyRoot) {
    $key = Join-Path $policyRoot 'ExtensionInstallForcelist'
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }

    $existing = Get-Item -Path $key
    $slot = $null
    foreach ($name in $existing.GetValueNames()) {
        if ((Get-ItemProperty -Path $key -Name $name).$name -like "$ExtensionId;*") { $slot = $name; break }
    }
    if (-not $slot) {
        $used = @($existing.GetValueNames())
        $i = 1
        while ($used -contains "$i") { $i++ }
        $slot = "$i"
    }
    Set-ItemProperty -Path $key -Name $slot -Value "$ExtensionId;$UpdateUrl" -Type String
    return $slot
}

function Remove-ForcelistEntry($policyRoot) {
    $key = Join-Path $policyRoot 'ExtensionInstallForcelist'
    if (-not (Test-Path $key)) { return $false }
    $removed = $false
    $item = Get-Item -Path $key
    foreach ($name in $item.GetValueNames()) {
        if ((Get-ItemProperty -Path $key -Name $name).$name -like "$ExtensionId;*") {
            Remove-ItemProperty -Path $key -Name $name
            $removed = $true
        }
    }
    return $removed
}

Write-Step ''
Write-Step '  JDG Clockwork' 'Cyan'
Write-Step '  ---------------------------------------------' 'DarkGray'

$touched = @()
foreach ($b in $Browsers) {
    if (-not (Test-BrowserInstalled $b.Process)) { continue }

    if ($Uninstall) {
        if (Remove-ForcelistEntry $b.Policy) {
            Write-Step "  Removed from $($b.Name)." 'Yellow'
            $touched += $b
        }
    }
    else {
        $slot = Set-ForcelistEntry $b.Policy
        Write-Step "  Registered with $($b.Name) (policy slot $slot)." 'Green'
        $touched += $b
    }
}

if ($touched.Count -eq 0) {
    if ($Uninstall) { Write-Step '  Nothing to remove — it was not installed.' 'Yellow' }
    else { Write-Step '  No Chrome or Edge installation found. Nothing to do.' 'Red' }
    Write-Step ''
    return
}

Write-Step ''
$running = @()
foreach ($b in $touched) {
    if (Get-Process -Name $b.Process -ErrorAction SilentlyContinue) { $running += $b.Name }
}

if ($running.Count -gt 0) {
    Write-Step "  Restart $($running -join ' and ') to finish." 'Cyan'
    Write-Step '  (Policies are read at browser startup. Closing every window is enough.)' 'DarkGray'
}
else {
    Write-Step '  Done — it will be there next time you open the browser.' 'Cyan'
}

if (-not $Uninstall) {
    Write-Step ''
    Write-Step '  Sign in to team.justdigitalgurus.com as usual. Clockwork adds a' 'DarkGray'
    Write-Step '  readout to the top bar and panels to the dashboard, attendance' 'DarkGray'
    Write-Step '  and holiday pages. It reads only your own attendance.' 'DarkGray'
    Write-Step "  Source: $RepoUrl" 'DarkGray'
}
Write-Step ''
