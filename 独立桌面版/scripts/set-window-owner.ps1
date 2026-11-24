param([UInt32]$Window, [Int64]$Owner)
$signature = @'
using System;
using System.Runtime.InteropServices;
public static class PetOwnerApi {
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
}
'@
Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue
[void][PetOwnerApi]::SetWindowLongPtr([IntPtr]::new([Int64]$Window), -8, [IntPtr]::new($Owner))
Write-Output '{"ok":true}'
