# SPDX-License-Identifier: MIT
param(
    [ValidateSet('Enable','Disable')][string]$Mode = 'Enable',
    [ValidateRange(1024,65535)][int]$Port = 9322,
    [string]$AppPath = ''
)

$ErrorActionPreference = 'Stop'
$socket = $null
$timeout = $null
$http = $null
$handler = $null

function Resolve-DesktopApp {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        $candidate = $RequestedPath.Trim('"')
        if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and
            [IO.Path]::GetFileName($candidate) -match '^(Codex|ChatGPT)\.exe$') {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
        throw 'The supplied -AppPath is not a Codex.exe or ChatGPT.exe file.'
    }

    $candidates = New-Object 'System.Collections.Generic.List[string]'

    # Microsoft Store installation. Failure is allowed because some managed
    # machines block Get-AppxPackage even for the current user.
    try {
        $packages = @(Get-AppxPackage -ErrorAction Stop | Where-Object {
            $_.Name -match '^OpenAI\.(Codex|ChatGPT)$' -or
            $_.PackageFamilyName -match '^OpenAI\.(Codex|ChatGPT)_'
        } | Sort-Object Version -Descending)
        foreach ($package in $packages) {
            foreach ($relative in @('app\ChatGPT.exe','app\Codex.exe','ChatGPT.exe','Codex.exe')) {
                $candidates.Add((Join-Path $package.InstallLocation $relative))
            }
        }
    } catch {}

    foreach ($path in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI Codex\ChatGPT.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI Codex\Codex.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\ChatGPT\ChatGPT.exe'),
        (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\ChatGPT.exe'),
        (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\Codex.exe')
    )) { $candidates.Add($path) }

    # Do not resolve Codex.exe through PATH: the Codex CLI commonly uses that
    # name and must never be launched as the desktop app. ChatGPT.exe does not
    # have the same known CLI ambiguity.
    $command = Get-Command 'ChatGPT.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and $command.Path) { $candidates.Add($command.Path) }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and
            [IO.Path]::GetFileName($candidate) -match '^(Codex|ChatGPT)\.exe$') {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $manual = (Read-Host 'App not found automatically. Enter the full Codex.exe or ChatGPT.exe path').Trim('"')
    if (!(Test-Path -LiteralPath $manual -PathType Leaf) -or
        [IO.Path]::GetFileName($manual) -notmatch '^(Codex|ChatGPT)\.exe$') {
        throw 'Invalid app path.'
    }
    return (Resolve-Path -LiteralPath $manual).Path
}

Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.UseProxy = $false
$handler.AllowAutoRedirect = $false
$http = New-Object System.Net.Http.HttpClient($handler)
$http.Timeout = [TimeSpan]::FromSeconds(3)

function Get-Targets {
    $response = $http.GetAsync("http://127.0.0.1:$Port/json/list").GetAwaiter().GetResult()
    try {
        $response.EnsureSuccessStatusCode() | Out-Null
        return ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json)
    } finally { $response.Dispose() }
}

function Get-VerifiedListeners {
    try {
        return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | ForEach-Object {
            [pscustomobject]@{ LocalAddress = $_.LocalAddress; OwningProcess = $_.OwningProcess }
        })
    } catch {
        # Get-NetTCPConnection may be blocked by CIM policy on managed PCs.
        # netstat is a read-only fallback; keep the same address/owner checks.
        $found = @()
        foreach ($line in @(& "$env:SystemRoot\System32\netstat.exe" -ano -p tcp)) {
            if ($line -match '^\s*TCP\s+(\S+):(\d+)\s+\S+\s+\S+\s+(\d+)\s*$' -and [int]$matches[2] -eq $Port) {
                $found += [pscustomobject]@{ LocalAddress = $matches[1]; OwningProcess = [int]$matches[3] }
            }
        }
        return $found
    }
}

try {
    try { $targets = @(Get-Targets) } catch {
        if ($Mode -eq 'Disable') { throw 'No local debug session was found. Nothing was changed.' }

        $exe = Resolve-DesktopApp -RequestedPath $AppPath
        $processName = [IO.Path]::GetFileNameWithoutExtension($exe)
        $running = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object {
            try { $_.Path -eq $exe } catch { $false }
        })
        if ($running.Count) {
            Read-Host 'Save your work, fully exit the desktop app including its tray icon, then press Enter' | Out-Null
            $running = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object {
                try { $_.Path -eq $exe } catch { $false }
            })
            if ($running.Count) { throw 'The app is still running. No process was terminated.' }
        }

        Write-Host 'Starting the app with a loopback-only DevTools port.'
        Start-Process -FilePath $exe -ArgumentList @('--remote-debugging-address=127.0.0.1',"--remote-debugging-port=$Port")

        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
            Start-Sleep -Milliseconds 300
            try { $targets = @(Get-Targets); break } catch {}
        } while ([DateTime]::UtcNow -lt $deadline)
        if (!$targets) { throw 'The local DevTools endpoint did not become ready within 30 seconds.' }
    }

    $listeners = @(Get-VerifiedListeners)
    if (!$listeners.Count -or @($listeners | Where-Object LocalAddress -ne '127.0.0.1').Count) {
        throw 'The debug port is not exclusively bound to 127.0.0.1. Fully exit the app.'
    }
    foreach ($listener in $listeners) {
        $owner = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
        if ($owner.ProcessName -notmatch '^(ChatGPT|Codex)$') {
            throw 'The debug port is not owned by the expected desktop app.'
        }
    }

    $pages = @($targets | Where-Object { $_.type -eq 'page' -and $_.url -eq 'app://-/index.html' })
    if (!$pages.Count) { throw 'The verified desktop-app main page was not found.' }

    $selected = 0
    if ($pages.Count -gt 1) {
        for ($index = 0; $index -lt $pages.Count; $index++) {
            Write-Host "[$index] $($pages[$index].title)"
        }
        if (![int]::TryParse((Read-Host 'Choose the main window number'), [ref]$selected) -or
            $selected -lt 0 -or $selected -ge $pages.Count) {
            throw 'Invalid window selection.'
        }
    }

    if ($Mode -eq 'Enable') {
        Write-Host ''
        Write-Host 'This injects a temporary Message Rail into ordinary Chat pages.'
        Write-Host 'It only connects to 127.0.0.1, does not modify installation files, and stores no chat text.'
        Write-Host 'Bookmarks store conversation/message IDs in the app localStorage.'
        if ((Read-Host 'After reviewing native-message-rail.js, type ENABLE to continue') -cne 'ENABLE') {
            throw 'Cancelled.'
        }
        $expression = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'native-message-rail.js') -Raw -Encoding UTF8
    } else {
        $expression = '(() => { window.__localNativeChatRail?.destroy(); return { removed: !window.__localNativeChatRail }; })()'
    }

    $uri = [Uri]$pages[$selected].webSocketDebuggerUrl
    if ($uri.Scheme -ne 'ws' -or $uri.Host -cne '127.0.0.1' -or $uri.Port -ne $Port -or
        $uri.UserInfo -or $uri.AbsolutePath -notlike '/devtools/page/*') {
        throw 'Rejected an unexpected CDP endpoint.'
    }

    $socket = New-Object System.Net.WebSockets.ClientWebSocket
    $socket.Options.Proxy = $null
    $timeout = New-Object System.Threading.CancellationTokenSource
    $timeout.CancelAfter(60000)
    $null = $socket.ConnectAsync($uri, $timeout.Token).GetAwaiter().GetResult()

    function Invoke-Cdp([int]$Id, [string]$Expression, [bool]$AwaitPromise) {
        $request = @{
            id = $Id
            method = 'Runtime.evaluate'
            params = @{ expression = $Expression; returnByValue = $true; awaitPromise = $AwaitPromise; timeout = 10000 }
        } | ConvertTo-Json -Depth 8 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($request)
        if ($bytes.Length -gt 4096) { throw 'Internal transport chunk exceeded its safety limit.' }
        $null = $socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, $timeout.Token).GetAwaiter().GetResult()

        do {
            $stream = New-Object IO.MemoryStream
            do {
                $buffer = New-Object byte[] 65536
                $part = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $timeout.Token).GetAwaiter().GetResult()
                if ($part.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { throw 'CDP disconnected.' }
                $stream.Write($buffer, 0, $part.Count)
                if ($stream.Length -gt 8388608) { throw 'CDP response exceeded the size limit.' }
            } until ($part.EndOfMessage)
            $message = [Text.Encoding]::UTF8.GetString($stream.ToArray())
            $stream.Dispose()
            $candidate = $message | ConvertFrom-Json
        } until ($candidate.id -eq $Id)

        if ($candidate.error -or $candidate.result.exceptionDetails) {
            throw ($candidate | ConvertTo-Json -Depth 10)
        }
        return $candidate
    }

    # Windows PowerShell may stall on one large WebSocket frame. Transfer the
    # audited UTF-8 source in small base64 chunks, then evaluate it in the app.
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($expression))
    $null = Invoke-Cdp 100 'window.__localRailPayload=""; true' $false
    $requestId = 101
    for ($offset = 0; $offset -lt $encoded.Length; $offset += 700) {
        $length = [Math]::Min(700, $encoded.Length - $offset)
        $chunk = $encoded.Substring($offset, $length)
        $null = Invoke-Cdp $requestId "window.__localRailPayload+='$chunk'; window.__localRailPayload.length" $false
        $requestId++
    }
    $runner = '(()=>{const b=atob(window.__localRailPayload);delete window.__localRailPayload;const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return(0,eval)(new TextDecoder().decode(a))})()'
    $reply = Invoke-Cdp $requestId $runner $true
    $value = $reply.result.result.value
    $value | ConvertTo-Json -Depth 5 | Write-Host

    if ($Mode -eq 'Enable' -and $value.waitingForChat) {
        Write-Host 'Enabled. Open an ordinary Chat with at least four user messages.' -ForegroundColor Green
    } elseif ($Mode -eq 'Enable') {
        Write-Host 'Message Rail enabled.' -ForegroundColor Green
    } else {
        Write-Host 'Message Rail removed from the current app session.' -ForegroundColor Green
    }
    Write-Host 'The DevTools port remains open until the desktop app fully exits.'
} catch {
    Write-Host $_ -ForegroundColor Red
    exit 1
} finally {
    if ($socket) { $socket.Dispose() }
    if ($timeout) { $timeout.Dispose() }
    if ($http) { $http.Dispose() }
    if ($handler) { $handler.Dispose() }
}
