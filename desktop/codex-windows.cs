using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Reuse the enumeration callback and inspect native windows, rather than
// allocating Get-Process pipelines and PowerShell delegates on every tick.
public static class ContinuerWindows {
    private delegate bool EnumProc(IntPtr hwnd, IntPtr param);
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }
    private sealed class Window {
        public IntPtr Handle;
        public uint Pid;
        public Rect Bounds;
    }
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    private static readonly EnumProc callback = Visit;
    private static readonly List<Window> windows = new List<Window>();
    private static readonly StringBuilder image = new StringBuilder(4096);
    private static bool includeMinimized;

    private static bool IsCodex(uint pid) {
        IntPtr process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) return false;
        try {
            image.Clear();
            uint size = (uint)image.Capacity;
            if (!QueryFullProcessImageName(process, 0, image, ref size)) return false;
            string path = image.ToString();
            string name = Path.GetFileName(path);
            return name.Equals("Codex.exe", StringComparison.OrdinalIgnoreCase) ||
                (name.Equals("ChatGPT.exe", StringComparison.OrdinalIgnoreCase) &&
                 path.IndexOf(@"\OpenAI.Codex_", StringComparison.OrdinalIgnoreCase) >= 0);
        } finally { CloseHandle(process); }
    }
    private static bool Visit(IntPtr handle, IntPtr unused) {
        if (!IsWindowVisible(handle)) return true;
        bool minimized = IsIconic(handle);
        if (minimized && !includeMinimized) return true;
        Rect rect;
        if (!GetWindowRect(handle, out rect)) return true;
        if (!minimized && (rect.Right - rect.Left <= 300 || rect.Bottom - rect.Top <= 250)) return true;
        uint pid;
        GetWindowThreadProcessId(handle, out pid);
        if (IsCodex(pid)) windows.Add(new Window { Handle = handle, Pid = pid, Bounds = rect });
        return true;
    }
    private static void Scan(bool minimized) {
        windows.Clear(); includeMinimized = minimized;
        EnumWindows(callback, IntPtr.Zero);
    }
    public static string DesktopKey() {
        Scan(true);
        var ids = new SortedSet<uint>();
        foreach (Window window in windows) ids.Add(window.Pid);
        return string.Join(",", ids);
    }
    public static void Track(int widgetPid) {
        IntPtr last = IntPtr.Zero;
        using (Process owner = Process.GetProcessById(widgetPid)) {
            do {
                try {
                    Scan(false);
                    IntPtr foreground = GetForegroundWindow();
                    uint foregroundPid;
                    GetWindowThreadProcessId(foreground, out foregroundPid);
                    Window target = windows.Find(w => w.Handle == foreground) ??
                        windows.Find(w => w.Handle == last) ?? (windows.Count > 0 ? windows[0] : null);
                    if (target == null) Console.WriteLine("{\"visible\":false,\"found\":false}");
                    else {
                        last = target.Handle;
                        Rect r = target.Bounds;
                        Console.WriteLine(string.Format(CultureInfo.InvariantCulture,
                            "{{\"visible\":{0},\"found\":true,\"x\":{1},\"y\":{2},\"width\":{3},\"height\":{4}}}",
                            foreground == target.Handle || foregroundPid == widgetPid ? "true" : "false",
                            r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top));
                    }
                } catch { Console.WriteLine("{\"visible\":false,\"found\":false,\"error\":\"window-tracker-failed\"}"); }
            } while (!owner.WaitForExit(600));
        }
    }
}
