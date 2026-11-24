$signature = @'
using System;
using System.Runtime.InteropServices;
public static class PetWindowApi {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
'@
Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue
$candidates = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -eq 'Kimi Code' -or $_.MainWindowTitle -eq 'Kimi') -and -not [PetWindowApi]::IsIconic($_.MainWindowHandle) } | Select-Object -First 1
if (-not $candidates) { Write-Output 'null'; exit 0 }
$rect = New-Object PetWindowApi+RECT
[void][PetWindowApi]::GetWindowRect($candidates.MainWindowHandle, [ref]$rect)
[pscustomobject]@{ handle = $candidates.MainWindowHandle.ToInt64(); title = $candidates.MainWindowTitle; x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } | ConvertTo-Json -Compress
