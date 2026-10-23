using System.IO;

namespace InterviewAssistant;

/// <summary>
/// Appends diagnostics to %LOCALAPPDATA%\InterviewAssistant\log.txt (started afresh past 1 MB).
/// Logging must never break the app, so every failure here is swallowed.
/// </summary>
static class Log
{
    static readonly string FilePath = Path.Combine(AppSettings.DataFolder, "log.txt");
    static readonly Lock Gate = new();

    static Log()
    {
        try
        {
            Directory.CreateDirectory(AppSettings.DataFolder);
            if (File.Exists(FilePath) && new FileInfo(FilePath).Length > 1_000_000)
            {
                File.Delete(FilePath);
            }
        }
        catch (Exception)
        {
        }
    }

    public static void Write(string message)
    {
        lock (Gate)
        {
            try
            {
                // A long session (or a page error repeating every poll) must not grow the file without
                // limit: past 2 MB it becomes log.old.txt and a new log.txt starts.
                if (++_writes % 200 == 0 && new FileInfo(FilePath) is { Exists: true, Length: > 2_000_000 })
                {
                    File.Move(FilePath, Path.ChangeExtension(FilePath, ".old.txt"), overwrite: true);
                }
                File.AppendAllText(FilePath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}{Environment.NewLine}");
            }
            catch (Exception)
            {
            }
        }
    }

    static int _writes;
}
