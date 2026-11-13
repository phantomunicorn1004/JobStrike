using System.IO;
using System.Text.Json;

namespace InterviewAssistant;

public sealed class RoundHistory
{
    static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    static string Folder => Path.Combine(AppSettings.DataFolder, "rounds");

    public string ApplicationKey { get; set; } = "";
    public List<RoundRecord> Rounds { get; set; } = [];

    static string FilePath(string key) => Path.Combine(Folder, $"{SanitizeKey(key)}.json");

    public static RoundHistory Load(string applicationKey)
    {
        if (string.IsNullOrWhiteSpace(applicationKey))
            return new RoundHistory { ApplicationKey = applicationKey };

        string path = FilePath(applicationKey);
        try
        {
            if (File.Exists(path))
            {
                var history = JsonSerializer.Deserialize<RoundHistory>(File.ReadAllText(path), Json);
                if (history != null)
                {
                    history.ApplicationKey = applicationKey;
                    history.Rounds ??= [];
                    return history;
                }
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            Log.Write($"Round history for '{applicationKey}' could not be read: {ex.Message}");
        }
        return new RoundHistory { ApplicationKey = applicationKey };
    }

    public void Save()
    {
        if (string.IsNullOrWhiteSpace(ApplicationKey)) return;
        try
        {
            Directory.CreateDirectory(Folder);
            File.WriteAllText(FilePath(ApplicationKey), JsonSerializer.Serialize(this, Json));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Write($"Round history could not be saved: {ex.Message}");
        }
    }

    public void AddRound(RoundRecord round)
    {
        Rounds.Add(round);
        Save();
    }

    public RoundRecord? LastRound => Rounds.Count > 0 ? Rounds[^1] : null;

    public List<string> AllStoriesUsed() =>
        Rounds.SelectMany(r => r.StoriesUsed).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    static string SanitizeKey(string key)
    {
        var chars = key.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_').ToArray();
        string sanitized = new(chars);
        return sanitized.Length > 0 ? sanitized[..Math.Min(sanitized.Length, 80)] : "default";
    }
}
