# Deskfall window tracker (Windows).
# Streams one JSON line per change describing visible top-level windows (top-most first),
# taskbars and the foreground window. Coordinates are physical screen pixels.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File winlist.ps1 <ownerPid> <intervalMs>
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class DeskfallWindows {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT value, int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);

    const int GWL_STYLE = -16;
    const int GWL_EXSTYLE = -20;
    const int WS_CHILD = 0x40000000;
    const int WS_EX_TOOLWINDOW = 0x00000080;
    const int WS_EX_TRANSPARENT = 0x00000020;
    const int WS_EX_NOACTIVATE = 0x08000000;
    const uint GW_OWNER = 4;
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    const int DWMWA_CLOAKED = 14;
    const int MIN_SIZE = 60;
    static readonly IntPtr PER_MONITOR_AWARE_V2 = new IntPtr(-4);

    static string ClassOf(IntPtr h) {
        var sb = new StringBuilder(256);
        GetClassName(h, sb, sb.Capacity);
        return sb.ToString();
    }

    static RECT BoundsOf(IntPtr h) {
        RECT r;
        if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) != 0) {
            GetWindowRect(h, out r);
        }
        return r;
    }

    static bool IsCloaked(IntPtr h) {
        int cloaked;
        return DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0;
    }

    static void AppendRect(StringBuilder sb, RECT r) {
        sb.Append(r.Left).Append(',').Append(r.Top).Append(',').Append(r.Right).Append(',').Append(r.Bottom);
    }

    public static string Snapshot(uint ownerPid) {
        SetThreadDpiAwarenessContext(PER_MONITOR_AWARE_V2);
        var windows = new StringBuilder();
        var bars = new StringBuilder();
        EnumWindows((h, p) => {
            if (!IsWindowVisible(h) || IsIconic(h) || IsCloaked(h)) return true;
            string cls = ClassOf(h);
            if (cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") {
                if (bars.Length > 0) bars.Append(',');
                bars.Append('['); AppendRect(bars, BoundsOf(h)); bars.Append(']');
                return true;
            }
            if (cls == "Progman" || cls == "WorkerW") return true;
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (pid == ownerPid) return true;
            int style = GetWindowLong(h, GWL_STYLE);
            int ex = GetWindowLong(h, GWL_EXSTYLE);
            if ((style & WS_CHILD) != 0) return true;
            if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_TRANSPARENT) != 0) return true;
            if ((ex & WS_EX_NOACTIVATE) != 0 && GetWindow(h, GW_OWNER) == IntPtr.Zero) return true;
            if (GetWindowTextLength(h) == 0) return true;
            RECT r = BoundsOf(h);
            if (r.Right - r.Left < MIN_SIZE || r.Bottom - r.Top < MIN_SIZE) return true;
            if (windows.Length > 0) windows.Append(',');
            windows.Append('[').Append(h.ToInt64()).Append(',');
            AppendRect(windows, r);
            windows.Append(']');
            return true;
        }, IntPtr.Zero);

        IntPtr fg = GetForegroundWindow();
        string fgCls = fg == IntPtr.Zero ? "" : ClassOf(fg);
        bool fgDesktop = fgCls == "Progman" || fgCls == "WorkerW" || fgCls == "Shell_TrayWnd";
        var sb = new StringBuilder();
        sb.Append("{\"fg\":").Append(fg.ToInt64());
        sb.Append(",\"fgDesktop\":").Append(fgDesktop ? "true" : "false");
        sb.Append(",\"fgRect\":[");
        if (fg != IntPtr.Zero) AppendRect(sb, BoundsOf(fg));
        sb.Append("],\"bars\":[").Append(bars).Append("],\"windows\":[").Append(windows).Append("]}");
        return sb.ToString();
    }

    static bool IsAlive(uint pid) {
        try { return !Process.GetProcessById((int)pid).HasExited; } catch { return false; }
    }

    const int MIN_INTERVAL_MS = 15;
    const int MAX_INTERVAL_MS = 2000;
    static volatile int interval = 33;
    static volatile bool inputClosed = false;

    // Reads "interval <ms>" commands from stdin; stdin closing means the app is gone.
    static void ReadCommands() {
        try {
            string line;
            while ((line = Console.In.ReadLine()) != null) {
                string[] parts = line.Trim().Split(' ');
                int ms;
                if (parts.Length == 2 && parts[0] == "interval" && int.TryParse(parts[1], out ms)) {
                    interval = Math.Max(MIN_INTERVAL_MS, Math.Min(MAX_INTERVAL_MS, ms));
                }
            }
        } catch (Exception) {
            // Broken pipe: same as end of input.
        }
        inputClosed = true;
    }

    public static void Run(uint ownerPid, int intervalMs) {
        interval = Math.Max(MIN_INTERVAL_MS, Math.Min(MAX_INTERVAL_MS, intervalMs));
        var reader = new Thread(ReadCommands);
        reader.IsBackground = true;
        reader.Start();
        string last = null;
        var watch = Stopwatch.StartNew();
        var stdout = Console.Out;
        while (!inputClosed) {
            if (watch.ElapsedMilliseconds > 2000) {
                if (!IsAlive(ownerPid)) return;
                watch.Restart();
            }
            string snap = Snapshot(ownerPid);
            if (snap != last) {
                stdout.WriteLine(snap);
                stdout.Flush();
                last = snap;
            }
            Thread.Sleep(interval);
        }
    }
}
"@

$ownerPid = [uint32]$args[0]
$interval = [int]$args[1]
[DeskfallWindows]::Run($ownerPid, $interval)
