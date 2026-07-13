# Static file server for embusca (no Python/Node needed)
# Tries to listen on all interfaces (so phones on the same Wi-Fi can connect);
# falls back to localhost-only if the URL ACL hasn't been granted yet.
# To allow network access, run once in an ADMIN PowerShell:
#   netsh http add urlacl url=http://+:8420/ sddl=D:(A;;GX;;;WD)
#   netsh advfirewall firewall add rule name="embusca" dir=in action=allow protocol=TCP localport=8420
param([int]$Port = 8420)

$root = Join-Path $PSScriptRoot "."
$listener = New-Object System.Net.HttpListener
try {
    $listener.Prefixes.Add("http://+:$Port/")
    $listener.Start()
    $ips = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' }).IPAddress
    Write-Host "embusca serving on ALL interfaces, port $Port"
    foreach ($ip in $ips) { Write-Host "  phone/other devices: http://${ip}:$Port/" }
} catch {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Start()
    Write-Host "embusca serving http://localhost:$Port/ (localhost only - run the netsh commands as admin to enable phone access)"
}

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
        $path = $ctx.Request.Url.AbsolutePath
        if ($path -eq "/") { $path = "/index.html" }
        $file = Join-Path $root ($path.TrimStart("/") -replace "/", "\")
        $fullRoot = (Resolve-Path $root).Path
        $ok = (Test-Path $file -PathType Leaf)
        if ($ok) {
            $full = (Resolve-Path $file).Path
            if (-not $full.StartsWith($fullRoot)) { $ok = $false }
        }
        if ($ok) {
            $bytes = [System.IO.File]::ReadAllBytes($file)
            $ext = [System.IO.Path]::GetExtension($file).ToLower()
            if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $ctx.Response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
        }
        $ctx.Response.OutputStream.Close()
    } catch {
        # keep serving on per-request errors
    }
}
