using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using TaskStatus = WorkflowEngine.Api.Models.TaskStatus;

namespace WorkflowEngine.Api.Services;

/// <summary>
/// Three things share this one background sweep, since all are "resume/nudge a pending task
/// once a deadline passes" - the same mechanism, different intent:
///   1. Skelta-style escalation - any FormTask/ApprovalTask node can set EscalateAfterMinutes.
///      "Reassign" (default) hands the task to EscalateTo; "AutoComplete" completes it with
///      TimeoutDecision as the outcome; "Notify" sends a one-time reminder and leaves the task
///      where it is (Skelta_HWS.dll keeps reminder handlers separate from reassign handlers).
///   2. Business-hours-aware deadlines - if the node's UseBusinessHours is set, the deadline
///      counts only configured work hours/days (Skelta.Calendar.BusinessHours.Timeout), not
///      raw wall-clock minutes.
///   3. Real Timer nodes - WorkflowEngineService.FollowEdge creates a hidden task
///      (AssignedTo = null, EscalationMode = "AutoComplete") for every Timer node; this sweep
///      resumes the instance once the real duration elapses.
/// </summary>
public class TaskEscalationHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TaskEscalationHostedService> _logger;
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(15);

    public TaskEscalationHostedService(IServiceScopeFactory scopeFactory, ILogger<TaskEscalationHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RunEscalationSweep(stoppingToken); }
            catch (Exception ex) { _logger.LogError(ex, "Escalation sweep failed."); }

            try { await Task.Delay(PollInterval, stoppingToken); }
            catch (TaskCanceledException) { /* shutting down */ }
        }
    }

    private async Task RunEscalationSweep(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WorkflowDbContext>();
        var engine = scope.ServiceProvider.GetRequiredService<IWorkflowEngineService>();
        var businessHours = scope.ServiceProvider.GetRequiredService<IBusinessHoursCalculator>();
        var fileLogger = scope.ServiceProvider.GetRequiredService<IActivityFileLogger>();
        var emailSender = scope.ServiceProvider.GetRequiredService<IEmailSender>();

        var now = DateTime.UtcNow;
        var candidates = await db.Tasks
            .Where(t => t.Status == TaskStatus.Pending && !t.IsEscalated && t.EscalateAfterMinutes != null)
            .ToListAsync(ct);

        if (candidates.Count == 0) return;

        // One definition load per distinct DefinitionId per sweep, not per task.
        var definitionCache = new Dictionary<string, WorkflowDefinition?>();
        async Task<WorkflowDefinition?> GetDefinition(string definitionId)
        {
            if (!definitionCache.TryGetValue(definitionId, out var def))
            {
                def = await db.Definitions.FirstOrDefaultAsync(d => d.Id == definitionId, ct);
                definitionCache[definitionId] = def;
            }
            return def;
        }

        foreach (var task in candidates)
        {
            var useBusinessHours = false;
            try
            {
                var definition = await GetDefinition(task.DefinitionId);
                useBusinessHours = definition?.Nodes.FirstOrDefault(n => n.Id == task.NodeId)?.UseBusinessHours ?? false;
            }
            catch (Exception ex)
            {
                // Degrade to wall-clock timing rather than blocking escalation entirely.
                _logger.LogError(ex, "Could not read UseBusinessHours for task {TaskId} - using wall-clock deadline", task.Id);
            }

            var isDue = useBusinessHours
                ? businessHours.HasElapsedBusinessMinutes(task.CreatedAt, now, task.EscalateAfterMinutes!.Value)
                : now >= task.CreatedAt.AddMinutes(task.EscalateAfterMinutes!.Value);
            if (!isDue) continue;

            if (task.EscalationMode == "AutoComplete" && !string.IsNullOrEmpty(task.TimeoutDecision))
            {
                try
                {
                    await engine.CompleteTask(task.Id, task.TimeoutDecision, null,
                        $"Auto-completed after {task.EscalateAfterMinutes} min with no response.", "system", "");
                    _logger.LogInformation("Auto-completed task {TaskId} ({Node}) with outcome {Decision}",
                        task.Id, task.NodeName, task.TimeoutDecision);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to auto-complete task {TaskId} on timeout", task.Id);
                }
                continue;
            }

            if (task.EscalationMode == "Notify")
            {
                if (string.IsNullOrEmpty(task.EscalateTo)) continue; // nothing configured to notify

                // EscalateTo may be a username or a role - resolve to every matching user's email.
                var recipients = await db.Users
                    .Where(u => u.IsActive && (u.Username == task.EscalateTo || u.Role == task.EscalateTo))
                    .Select(u => u.Email)
                    .Where(e => !string.IsNullOrEmpty(e))
                    .ToListAsync(ct);

                if (emailSender.IsConfigured && recipients.Count > 0)
                {
                    var subject = $"Reminder: '{task.NodeName}' is still waiting on you";
                    var body = $"This task has been pending since {task.CreatedAt:u} with no response yet.";
                    foreach (var email in recipients)
                        await emailSender.SendAsync(email, subject, body, false);
                }

                task.IsEscalated = true; // one reminder only, matching single-shot Reassign semantics

                var instance = await db.Instances.FirstOrDefaultAsync(i => i.Id == task.InstanceId, ct);
                if (instance != null)
                {
                    var entry = new HistoryEntry
                    {
                        NodeId = task.NodeId, NodeName = task.NodeName, Action = "Reminded", Actor = "system",
                        Comment = $"Reminder sent to {task.EscalateTo} after {task.EscalateAfterMinutes} min with no response."
                    };
                    instance.History = new List<HistoryEntry>(instance.History) { entry };
                    LogToActivityTable(db, fileLogger, instance, entry);
                }

                await db.SaveChangesAsync(ct);
                _logger.LogInformation("Sent escalation reminder for task {TaskId} ({Node}) to {To}", task.Id, task.NodeName, task.EscalateTo);
                continue;
            }

            // Default: "Reassign"
            if (string.IsNullOrEmpty(task.EscalateTo)) continue; // nothing to reassign to

            var reassignInstance = await db.Instances.FirstOrDefaultAsync(i => i.Id == task.InstanceId, ct);

            task.OriginalAssignee ??= task.AssignedTo;
            task.AssignedTo = task.EscalateTo;
            task.IsEscalated = true;

            if (reassignInstance != null)
            {
                var entry = new HistoryEntry
                {
                    NodeId = task.NodeId, NodeName = task.NodeName, Action = "Escalated", Actor = "system",
                    Comment = $"Reassigned from {task.OriginalAssignee} to {task.EscalateTo} after {task.EscalateAfterMinutes} min"
                };
                reassignInstance.History = new List<HistoryEntry>(reassignInstance.History) { entry };
                LogToActivityTable(db, fileLogger, reassignInstance, entry);
            }

            await db.SaveChangesAsync(ct);
            _logger.LogInformation("Escalated task {TaskId} ({Node}) from {From} to {To}",
                task.Id, task.NodeName, task.OriginalAssignee, task.EscalateTo);
        }
    }

    /// <summary>Same dual DB+file write as WorkflowEngineService.LogHistoryEntries. Kept local
    /// because this service resolves its own scoped DbContext and can't reuse the engine's
    /// private helper. Previously the escalation sweep never wrote to ActivityLogs at all.</summary>
    private static void LogToActivityTable(WorkflowDbContext db, IActivityFileLogger fileLogger, WorkflowInstance instance, HistoryEntry entry)
    {
        db.ActivityLogs.Add(new ActivityLogEntry
        {
            InstanceId = instance.Id,
            DefinitionId = instance.DefinitionId,
            NodeId = entry.NodeId,
            NodeName = entry.NodeName,
            Action = entry.Action,
            Actor = entry.Actor,
            Comment = entry.Comment,
            Timestamp = entry.Timestamp
        });
        fileLogger.Log(instance.Id, entry.NodeId, entry.NodeName, entry.Action, entry.Actor, entry.Comment);
    }
}
