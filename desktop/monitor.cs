using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

// A GUI-subsystem executable has no console window, but inherits the pipes
// supplied by Electron for --track. No PowerShell runtime stays resident.
internal static class ContinuerMonitor {
    private static string Json(string value) {
        var text = new StringBuilder("\"");
        foreach (char ch in value) {
            if (ch == '\\' || ch == '"') { text.Append('\\'); text.Append(ch); }
            else if (ch < 32) { text.Append("\\u"); text.Append(((int)ch).ToString("x4")); }
            else text.Append(ch);
        }
        return text.Append('"').ToString();
    }
    // CommandLineToArgvW quoting, including spaces, quotes and trailing slashes.
    internal static string Quote(string value) {
        var text = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value) {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') { text.Append('\\', slashes * 2 + 1); text.Append(ch); }
            else { text.Append('\\', slashes); text.Append(ch); }
            slashes = 0;
        }
        text.Append('\\', slashes * 2);
        return text.Append('"').ToString();
    }
    private static void Status(string data, string root, string state, string message) {
        string json = "{\"pid\":" + Process.GetCurrentProcess().Id +
            ",\"state\":" + Json(state) + ",\"message\":" + Json(message) +
            ",\"updatedAt\":" + Json(DateTime.UtcNow.ToString("o")) +
            ",\"pluginRoot\":" + Json(root) + ",\"runtime\":\"native\"}";
        File.WriteAllText(Path.Combine(data, "autostart-status.json"), json, new UTF8Encoding(false));
    }
    private static void Launch(string node, string root, string data) {
        var info = new ProcessStartInfo(node, Quote(Path.Combine(root, "plugin", "open.js")) + " --auto");
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WorkingDirectory = root;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.EnvironmentVariables["CONTINUER_DATA_DIR"] = data;
        using (Process child = new Process()) {
            child.StartInfo = info;
            using (var output = new StreamWriter(Path.Combine(data, "autostart-launch.log"), false, new UTF8Encoding(false)))
            using (var error = new StreamWriter(Path.Combine(data, "autostart-error.log"), false, new UTF8Encoding(false))) {
                child.OutputDataReceived += (sender, e) => { if (e.Data != null) output.WriteLine(e.Data); };
                child.ErrorDataReceived += (sender, e) => { if (e.Data != null) error.WriteLine(e.Data); };
                child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
                if (!child.WaitForExit(45000)) {
                    child.Kill(); child.WaitForExit();
                    throw new Exception("Widget startup timed out; see autostart-error.log");
                }
                child.WaitForExit(); // Drain both asynchronous readers before closing logs.
                if (child.ExitCode != 0) throw new Exception("Widget startup failed; see autostart-error.log");
            }
        }
    }
    private static void Watch(string node, string root, string data) {
        using (var mutex = new Mutex(false, @"Local\CodexContinuerStartupWatcher")) {
            bool acquired;
            try { acquired = mutex.WaitOne(0); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return;
            try {
                Directory.CreateDirectory(data);
                Status(data, root, "watching", "Waiting for Codex desktop");
                string seen = "";
                DateTime retryAt = DateTime.MinValue;
                while (true) {
                    try {
                        string key = ContinuerWindows.DesktopKey();
                        if (key.Length == 0) {
                            if (seen.Length != 0) { seen = ""; Status(data, root, "watching", "Codex desktop closed; waiting for next launch"); }
                        } else if (key != seen && DateTime.UtcNow >= retryAt) {
                            Launch(node, root, data);
                            seen = key;
                            Status(data, root, "launched", "Widget started for Codex desktop");
                        }
                    } catch (Exception error) {
                        retryAt = DateTime.UtcNow.AddSeconds(30);
                        Status(data, root, "retrying", error.Message);
                    }
                    Thread.Sleep(2000);
                }
            } finally { mutex.ReleaseMutex(); }
        }
    }
    private static int Main(string[] args) {
        try {
            if (args.Length == 2 && args[0] == "--track") { ContinuerWindows.Track(int.Parse(args[1])); return 0; }
            if (args.Length == 4 && args[0] == "--watch") { Watch(args[1], args[2], args[3]); return 0; }
            return 2;
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
