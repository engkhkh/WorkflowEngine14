using System.Text;

namespace WorkflowEngine.Api.Services;

public interface IActivityFileLogger
{
    void Log(string instanceId, string nodeId, string nodeName, string action, string? actor, string? comment);
}

/// <summary>
/// Writes one line per node action to a plain rolling log file under Logs/, alongside the
/// same information going into the ActivityLogs DB table (see WorkflowEngineService's
/// LogHistoryEntries). This is deliberately a hand-rolled minimal file writer rather than
/// pulling in Serilog/NLog - no new NuGet package, and file logging for an audit trail like
/// this doesn't need anything more sophisticated than "append a line, one file per day".
/// A single process-wide lock keeps concurrent requests from interleaving/corrupting lines;
/// fine at this scale, would need a proper queue if you ever run multiple server instances
/// writing to the same shared file.
/// </summary>
public class ActivityFileLogger : IActivityFileLogger
{
    private readonly string _logDirectory;
    private readonly object _lock = new();
    private readonly ILogger<ActivityFileLogger> _logger;

    public ActivityFileLogger(IWebHostEnvironment env, ILogger<ActivityFileLogger> logger)
    {
        _logDirectory = Path.Combine(env.ContentRootPath, "Logs");
        _logger = logger;
        try { Directory.CreateDirectory(_logDirectory); }
        catch (Exception ex) { _logger.LogError(ex, "Could not create Logs directory at {Dir}", _logDirectory); }
    }

    public void Log(string instanceId, string nodeId, string nodeName, string action, string? actor, string? comment)
    {
        try
        {
            var path = Path.Combine(_logDirectory, $"activity-{DateTime.UtcNow:yyyy-MM-dd}.log");
            var line = new StringBuilder()
                .Append(DateTime.UtcNow.ToString("O")).Append('\t')
                .Append("instance=").Append(instanceId).Append('\t')
                .Append("node=").Append(nodeId).Append(" (\"").Append(nodeName).Append("\")").Append('\t')
                .Append("action=").Append(action).Append('\t')
                .Append("actor=").Append(actor ?? "-").Append('\t')
                .Append("comment=").Append(string.IsNullOrEmpty(comment) ? "-" : comment.Replace('\n', ' ').Replace('\t', ' '))
                .AppendLine()
                .ToString();

            lock (_lock)
            {
                File.AppendAllText(path, line);
            }
        }
        catch (Exception ex)
        {
            // A logging failure must never break the actual workflow - log the failure itself
            // to the normal ASP.NET Core logger (console/whatever's configured) and move on.
            _logger.LogError(ex, "Failed to write activity log file entry for instance {InstanceId}", instanceId);
        }
    }
}
