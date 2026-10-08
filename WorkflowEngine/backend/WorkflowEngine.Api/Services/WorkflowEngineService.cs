using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using TaskStatus = WorkflowEngine.Api.Models.TaskStatus;

namespace WorkflowEngine.Api.Services;

public interface IWorkflowEngineService
{
    Task<WorkflowInstance> StartInstance(string definitionId, string startedBy, Dictionary<string, object?>? initialData);
    Task<WorkflowTask> CompleteTask(string taskId, string decision, Dictionary<string, object?>? formData, string? comment, string actor, string actorRole);
    Task<List<WorkflowTask>> GetTasksFor(string username, string role, bool includeCompleted = false);
    Task<WorkflowInstance?> GetInstance(string instanceId);
    Task<WorkflowInstance> CancelInstance(string instanceId, string actor, string actorRole);
}

/// <summary>
/// Core process engine. Scoped per request (like the DbContext it wraps) - every public
/// method loads what it needs, mutates the graph/instance, and calls SaveChangesAsync once.
/// </summary>
public class WorkflowEngineService : IWorkflowEngineService
{
    private readonly WorkflowDbContext _db;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IEmailSender _emailSender;
    private readonly IScriptRunner _scriptRunner;
    private readonly IActivityFileLogger _fileLogger;

    public WorkflowEngineService(WorkflowDbContext db, IHttpClientFactory httpClientFactory, IEmailSender emailSender, IScriptRunner scriptRunner, IActivityFileLogger fileLogger)
    {
        _db = db;
        _httpClientFactory = httpClientFactory;
        _emailSender = emailSender;
        _scriptRunner = scriptRunner;
        _fileLogger = fileLogger;
    }

    public async Task<WorkflowInstance> StartInstance(string definitionId, string startedBy, Dictionary<string, object?>? initialData)
    {
        var definition = await _db.Definitions.FirstOrDefaultAsync(d => d.Id == definitionId)
            ?? throw new KeyNotFoundException($"Workflow definition '{definitionId}' not found.");

        var startNode = definition.Nodes.FirstOrDefault(n => n.Type == NodeType.Start)
            ?? throw new InvalidOperationException("Workflow definition has no Start node.");

        var instance = new WorkflowInstance
        {
            DefinitionId = definition.Id,
            DefinitionName = definition.Name,
            StartedBy = startedBy,
            Data = initialData ?? new Dictionary<string, object?>()
        };

        instance.History.Add(new HistoryEntry
        {
            NodeId = startNode.Id,
            NodeName = startNode.Name,
            Action = "Entered",
            Actor = startedBy
        });

        _db.Instances.Add(instance);

        var newTasks = new List<WorkflowTask>();
        await AdvanceFrom(definition, instance, startNode.Id, startedBy, newTasks: newTasks);
        _db.Tasks.AddRange(newTasks);

        LogHistoryEntries(instance, instance.History); // fresh instance - every entry so far is new

        await _db.SaveChangesAsync();
        return instance;
    }

    public async Task<WorkflowTask> CompleteTask(string taskId, string decision, Dictionary<string, object?>? formData, string? comment, string actor, string actorRole)
    {
        var task = await _db.Tasks.FirstOrDefaultAsync(t => t.Id == taskId)
            ?? throw new KeyNotFoundException($"Task '{taskId}' not found.");
        if (task.Status == TaskStatus.Completed)
            throw new InvalidOperationException("Task has already been completed.");

        // "system" is a reserved actor used for automated timeout/timer completions - skip
        // the ownership check for it (a human didn't click the button, the background
        // sweep - TaskEscalationHostedService - did, whether for escalation or a Timer node).
        if (actor != "system" && !MatchesAssignee(task.AssignedTo, actor, actorRole))
            throw new UnauthorizedAccessException("This task is not assigned to you.");

        if (task.AvailableDecisions.Count > 0 && !task.AvailableDecisions.Contains(decision, StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException($"'{decision}' is not a valid outcome for this task. Expected one of: {string.Join(", ", task.AvailableDecisions)}.");

        var definition = await _db.Definitions.FirstOrDefaultAsync(d => d.Id == task.DefinitionId)
            ?? throw new KeyNotFoundException($"Workflow definition '{task.DefinitionId}' not found.");
        var instance = await _db.Instances.FirstOrDefaultAsync(i => i.Id == task.InstanceId)
            ?? throw new KeyNotFoundException($"Workflow instance '{task.InstanceId}' not found.");
        var historyCountBefore = instance.History.Count; // everything added from here on is new, for logging purposes

        task.Status = TaskStatus.Completed;
        task.Decision = decision;
        task.SubmittedData = formData;
        task.Comment = comment;
        task.CompletedAt = DateTime.UtcNow;

        if (formData != null)
        {
            // Reassign so EF's JSON value comparer picks up the change.
            var merged = new Dictionary<string, object?>(instance.Data);
            foreach (var kv in formData) merged[kv.Key] = kv.Value;
            instance.Data = merged;
        }

        // Hidden system tasks (Timer nodes - see FollowEdge) have no human-facing name; skip
        // logging a redundant duplicate "Entered ... Timer fired" style noise for those and
        // just log the real decision for genuine human/approval tasks.
        if (task.AssignedTo != null)
        {
            instance.History = new List<HistoryEntry>(instance.History) {
                new() { NodeId = task.NodeId, NodeName = task.NodeName, Action = decision, Actor = actor, Comment = comment }
            };
        }
        else
        {
            instance.History = new List<HistoryEntry>(instance.History) {
                new() { NodeId = task.NodeId, NodeName = task.NodeName, Action = "TimerFired", Actor = "system", Comment = $"Waited {task.EscalateAfterMinutes} min, then took '{decision}'" }
            };
        }

        instance.CurrentNodeIds = instance.CurrentNodeIds.Where(id => id != task.NodeId).ToList();

        // The chosen decision string IS the outgoing edge label to follow - this is what
        // lets a Task activity have any number of custom outcome buttons (Skelta-style)
        // instead of being hardcoded to Approve/Reject.
        var newTasks = new List<WorkflowTask>();
        await AdvanceFrom(definition, instance, task.NodeId, actor, decision, newTasks);
        _db.Tasks.AddRange(newTasks);

        LogHistoryEntries(instance, instance.History.Skip(historyCountBefore));

        await _db.SaveChangesAsync();
        return task;
    }

    /// <summary>
    /// Writes the given history entries to both the ActivityLogs DB table (same _db, same
    /// SaveChangesAsync as everything else in the calling method - stays atomic with it) and
    /// the file log. Called at just two integration points (end of StartInstance, end of
    /// CompleteTask, diffing instance.History before/after) plus CancelInstance's direct entry,
    /// rather than touching every individual AdvanceFrom/FollowEdge call site - lower risk of
    /// missing a spot or introducing a mistake in a big mechanical refactor.
    /// </summary>
    private void LogHistoryEntries(WorkflowInstance instance, IEnumerable<HistoryEntry> entries)
    {
        foreach (var entry in entries)
        {
            _db.ActivityLogs.Add(new ActivityLogEntry
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
            _fileLogger.Log(instance.Id, entry.NodeId, entry.NodeName, entry.Action, entry.Actor, entry.Comment);
        }
    }

    public async Task<List<WorkflowTask>> GetTasksFor(string username, string role, bool includeCompleted = false)
    {
        // AssignedTo can be a comma-separated list (Skelta-style multi-user work items) - "any
        // one of these people" - so this can't be a simple SQL equality filter; load candidates
        // (bounded by Status for a live inbox) and match in memory. AssignedTo == null covers
        // hidden system tasks (Timer waits), which never match a real username/role.
        var query = _db.Tasks.AsQueryable();
        if (!includeCompleted) query = query.Where(t => t.Status == TaskStatus.Pending);
        var candidates = await query.ToListAsync();
        return candidates.Where(t => MatchesAssignee(t.AssignedTo, username, role))
            .OrderByDescending(t => t.CreatedAt).ToList();
    }

    /// <summary>AssignedTo may be a single username/role or a comma-separated list of several
    /// (Skelta-style multi-user work item) - matches if the given username OR role appears
    /// anywhere in that list. Whoever acts on it first completes the single underlying task
    /// row, which is what makes it disappear from everyone else's inbox too.</summary>
    /// <summary>
    /// Expands the "{{initiator}}" token in a node's Assignee to the username of whoever started
    /// the instance, so a process can hand a step back to its requester (e.g. "fill in your
    /// purchase requisition", "confirm receipt") without hard-coding one user or role. Can be
    /// combined with others in a comma-separated list, e.g. "{{initiator}},procurement".
    /// </summary>
    private static string? ResolveAssignee(string? assignee, WorkflowInstance instance)
    {
        if (string.IsNullOrEmpty(assignee) || !assignee.Contains("{{initiator}}", StringComparison.OrdinalIgnoreCase))
            return assignee;
        return assignee.Replace("{{initiator}}", instance.StartedBy, StringComparison.OrdinalIgnoreCase);
    }

    private static bool MatchesAssignee(string? assignedTo, string username, string role)
    {
        if (string.IsNullOrEmpty(assignedTo)) return false;
        var targets = assignedTo.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        return targets.Any(x => string.Equals(x, username, StringComparison.OrdinalIgnoreCase))
            || (!string.IsNullOrEmpty(role) && targets.Any(x => string.Equals(x, role, StringComparison.OrdinalIgnoreCase)));
    }

    public async Task<WorkflowInstance?> GetInstance(string instanceId)
        => await _db.Instances.FirstOrDefaultAsync(i => i.Id == instanceId);

    /// <summary>
    /// Cancels a Running instance - only the person who started it, or an admin, may do this.
    /// Uses the InstanceStatus.Terminated value that's existed since day one but was never
    /// actually reachable until now, so this needs no schema change. Any of the instance's
    /// still-Pending tasks are force-completed with decision "Canceled" so they vanish from
    /// whoever's inbox they were sitting in, instead of lingering forever on a dead instance.
    /// </summary>
    public async Task<WorkflowInstance> CancelInstance(string instanceId, string actor, string actorRole)
    {
        var instance = await _db.Instances.FirstOrDefaultAsync(i => i.Id == instanceId)
            ?? throw new KeyNotFoundException($"Workflow instance '{instanceId}' not found.");

        if (instance.Status != InstanceStatus.Running)
            throw new InvalidOperationException("Only a running instance can be canceled.");

        var isOwner = string.Equals(instance.StartedBy, actor, StringComparison.OrdinalIgnoreCase);
        var isAdmin = string.Equals(actorRole, "admin", StringComparison.OrdinalIgnoreCase);
        if (!isOwner && !isAdmin)
            throw new UnauthorizedAccessException("Only the person who started this request, or an admin, can cancel it.");

        var pendingTasks = await _db.Tasks
            .Where(t => t.InstanceId == instanceId && t.Status == TaskStatus.Pending)
            .ToListAsync();

        foreach (var task in pendingTasks)
        {
            task.Status = TaskStatus.Completed;
            task.Decision = "Canceled";
            task.CompletedAt = DateTime.UtcNow;
        }

        instance.Status = InstanceStatus.Terminated;
        instance.CompletedAt = DateTime.UtcNow;
        instance.CurrentNodeIds = new List<string>();
        var cancelEntry = new HistoryEntry { NodeId = "", NodeName = instance.DefinitionName, Action = "Canceled", Actor = actor };
        instance.History = new List<HistoryEntry>(instance.History) { cancelEntry };
        LogHistoryEntries(instance, new[] { cancelEntry });

        await _db.SaveChangesAsync();
        return instance;
    }

    /// <summary>
    /// Walks the graph forward from <paramref name="fromNodeId"/>, auto-completing Condition,
    /// ParallelSplit/Join and Email/Automation, really executing WebhookCall over HTTP, really
    /// waiting out Timer nodes (via a hidden task + the existing escalation sweep), and
    /// stopping (creating a task) at the next FormTask/ApprovalTask, or completing the
    /// instance at an End node. Recurses along every branch so a ParallelSplit can fan out
    /// into several simultaneous tokens.
    /// </summary>
    private async Task AdvanceFrom(WorkflowDefinition definition, WorkflowInstance instance, string fromNodeId, string? actor,
        string? forcedEdgeLabel = null, List<WorkflowTask>? newTasks = null)
    {
        newTasks ??= new List<WorkflowTask>();
        var currentNode = definition.Nodes.FirstOrDefault(n => n.Id == fromNodeId);
        var outgoing = definition.Edges.Where(e => e.SourceNodeId == fromNodeId).ToList();

        if (outgoing.Count == 0)
        {
            CompleteInstanceIfNoWork(instance);
            return;
        }

        // ParallelSplit: fan out down EVERY outgoing edge as an independent branch. Sequential
        // awaits (not Task.WhenAll) - the shared DbContext isn't safe to use concurrently.
        if (currentNode?.Type == NodeType.ParallelSplit)
        {
            instance.History = new List<HistoryEntry>(instance.History) {
                new() { NodeId = currentNode.Id, NodeName = currentNode.Name, Action = "Forked", Actor = "system" }
            };
            foreach (var edge in outgoing)
                await FollowEdge(definition, instance, edge, actor, newTasks);
            return;
        }

        List<WorkflowEdge> chosen;
        if (forcedEdgeLabel != null)
        {
            var match = outgoing.FirstOrDefault(e => string.Equals(e.Label, forcedEdgeLabel, StringComparison.OrdinalIgnoreCase));
            chosen = new List<WorkflowEdge> { match ?? outgoing.First() };
        }
        else if (currentNode?.Type == NodeType.Condition)
        {
            var isTrue = ConditionEvaluator.Evaluate(currentNode.ConditionExpression, instance.Data);
            var match = outgoing.FirstOrDefault(e => string.Equals(e.Label, isTrue ? "True" : "False", StringComparison.OrdinalIgnoreCase));
            chosen = new List<WorkflowEdge> { match ?? outgoing.First() };
        }
        else if (currentNode?.Type == NodeType.Switch)
        {
            // n-way branch: take the edge whose Label matches instance.Data[SwitchField]'s
            // value (case-insensitive), falling back to an edge labeled "Default", then the
            // first outgoing edge - so a Switch with no matching branch still moves forward
            // instead of stalling the instance.
            instance.Data.TryGetValue(currentNode.SwitchField ?? "", out var switchValue);
            var valueStr = switchValue?.ToString() ?? "";
            var match = outgoing.FirstOrDefault(e => string.Equals(e.Label, valueStr, StringComparison.OrdinalIgnoreCase))
                ?? outgoing.FirstOrDefault(e => string.Equals(e.Label, "Default", StringComparison.OrdinalIgnoreCase));
            chosen = new List<WorkflowEdge> { match ?? outgoing.First() };
        }
        else if (currentNode?.Type is NodeType.SubWorkflow or NodeType.DocumentGeneration or NodeType.FileOperations or NodeType.XmlAction
            or NodeType.DatabaseActivity or NodeType.Notification or NodeType.SendSms
            && !string.IsNullOrEmpty(currentNode.DefaultOutcome))
        {
            // Still-stub activities (no real nested-instance execution/document generator/file
            // system/XML engine/database/push provider/SMS gateway wired up) - the designer
            // picks which labeled outgoing edge to always take. (Email, WebhookCall,
            // InvokeSoapService, scripted Automation, Logger and CancelWorkflow have their own
            // real dispatch in FollowEdge and never reach this branch.)
            var match = outgoing.FirstOrDefault(e => string.Equals(e.Label, currentNode.DefaultOutcome, StringComparison.OrdinalIgnoreCase));
            chosen = new List<WorkflowEdge> { match ?? outgoing.First() };
        }
        else
        {
            chosen = new List<WorkflowEdge> { outgoing.First() };
        }

        foreach (var edge in chosen)
            await FollowEdge(definition, instance, edge, actor, newTasks);
    }

    private async Task FollowEdge(WorkflowDefinition definition, WorkflowInstance instance, WorkflowEdge edge, string? actor, List<WorkflowTask> newTasks)
    {
        var nextNode = definition.Nodes.FirstOrDefault(n => n.Id == edge.TargetNodeId);
        if (nextNode == null) { CompleteInstanceIfNoWork(instance); return; }

        // ParallelJoin: wait until every incoming branch has arrived before continuing past it.
        if (nextNode.Type == NodeType.ParallelJoin)
        {
            var required = definition.Edges.Where(e => e.TargetNodeId == nextNode.Id)
                .Select(e => e.SourceNodeId).Distinct().Count();
            var counts = new Dictionary<string, int>(instance.JoinArrivalCounts);
            counts.TryGetValue(nextNode.Id, out var arrived);
            arrived += 1;
            counts[nextNode.Id] = arrived;
            instance.JoinArrivalCounts = counts;

            instance.History = new List<HistoryEntry>(instance.History) {
                new() { NodeId = nextNode.Id, NodeName = nextNode.Name, Action = "Entered", Actor = actor,
                        Comment = $"Branch {arrived}/{required} arrived", EdgeId = edge.Id }
            };

            if (arrived < required) return; // still waiting on other branches

            counts.Remove(nextNode.Id);
            instance.JoinArrivalCounts = counts;
            instance.History = new List<HistoryEntry>(instance.History) {
                new() { NodeId = nextNode.Id, NodeName = nextNode.Name, Action = "Joined", Actor = "system" }
            };
            await AdvanceFrom(definition, instance, nextNode.Id, actor, newTasks: newTasks);
            return;
        }

        instance.History = new List<HistoryEntry>(instance.History) {
            new() { NodeId = nextNode.Id, NodeName = nextNode.Name, Action = "Entered", Actor = actor, EdgeId = edge.Id }
        };

        switch (nextNode.Type)
        {
            case NodeType.End:
                CompleteInstanceIfNoWork(instance);
                break;

            case NodeType.FormTask:
            case NodeType.ApprovalTask:
                instance.CurrentNodeIds = new List<string>(instance.CurrentNodeIds) { nextNode.Id };
                var outgoingLabels = definition.Edges.Where(e => e.SourceNodeId == nextNode.Id)
                    .Select(e => e.Label).Distinct().ToList();
                newTasks.Add(new WorkflowTask
                {
                    InstanceId = instance.Id,
                    DefinitionId = definition.Id,
                    NodeId = nextNode.Id,
                    NodeName = nextNode.Name,
                    NodeType = nextNode.Type,
                    AssignedTo = ResolveAssignee(nextNode.Assignee, instance),
                    Priority = nextNode.Priority ?? "Normal",
                    Form = nextNode.Form,
                    AvailableDecisions = outgoingLabels.Count > 0 ? outgoingLabels : new List<string> { "Submit" },
                    EscalateAfterMinutes = nextNode.EscalateAfterMinutes,
                    EscalateTo = nextNode.EscalateTo,
                    EscalationMode = nextNode.EscalationMode,
                    TimeoutDecision = nextNode.TimeoutDecision,
                    OriginalAssignee = ResolveAssignee(nextNode.Assignee, instance)
                });
                break;

            // Timer: REALLY waits. Creates a hidden system task (AssignedTo = null, so it
            // never shows in anyone's inbox - see GetTasksFor) that reuses the exact same
            // EscalateAfterMinutes/AutoComplete machinery as task escalation. The background
            // TaskEscalationHostedService resumes the instance once the real duration elapses.
            case NodeType.Timer:
                {
                    instance.CurrentNodeIds = new List<string>(instance.CurrentNodeIds) { nextNode.Id };
                    var timerEdges = definition.Edges.Where(e => e.SourceNodeId == nextNode.Id).ToList();
                    var outcome = !string.IsNullOrEmpty(nextNode.DefaultOutcome) && timerEdges.Any(e => e.Label == nextNode.DefaultOutcome)
                        ? nextNode.DefaultOutcome!
                        : timerEdges.FirstOrDefault()?.Label ?? "Default";
                    var minutes = Math.Max(1, (int)Math.Ceiling((nextNode.DurationSeconds ?? 60) / 60.0));

                    newTasks.Add(new WorkflowTask
                    {
                        InstanceId = instance.Id,
                        DefinitionId = definition.Id,
                        NodeId = nextNode.Id,
                        NodeName = nextNode.Name,
                        NodeType = NodeType.Timer,
                        AssignedTo = null, // hidden - see GetTasksFor
                        AvailableDecisions = new List<string> { outcome },
                        EscalateAfterMinutes = minutes,
                        EscalationMode = "AutoComplete",
                        TimeoutDecision = outcome
                    });
                }
                break;

            // WebhookCall: REALLY calls the configured URL and branches on the real result -
            // see CallWebhookAsync. Falls back to DefaultOutcome only if the URL is blank or
            // still a placeholder (e.g. a not-yet-configured node in a recreated flow).
            case NodeType.WebhookCall:
                {
                    var outcome = await CallWebhookAsync(nextNode, instance);
                    instance.History = new List<HistoryEntry>(instance.History) {
                        new() { NodeId = nextNode.Id, NodeName = nextNode.Name, Action = "AutoCompleted", Actor = "system", Comment = $"Webhook result: {outcome}" }
                    };
                    await AdvanceFrom(definition, instance, nextNode.Id, actor, outcome, newTasks);
                }
                break;

            // Email: REALLY sends via SMTP now - see SendEmailAsync. Falls back to the old
            // DefaultOutcome stub behavior if Smtp:Host isn't configured in appsettings.json.
            case NodeType.Email:
                {
                    var outcome = await SendEmailAsync(nextNode, instance);
                    instance.History = new List<HistoryEntry>(instance.History) {
                        new() { NodeId = nextNode.Id, NodeName = nextNode.Name, Action = "AutoCompleted", Actor = "system", Comment = $"Email result: {outcome}" }
                    };
                    await AdvanceFrom(definition, instance, nextNode.Id, actor, outcome, newTasks);
                }
                break;

            // Automation: REALLY executes if ScriptLanguage is set - see RunScriptAsync.
            // Falls back to the old DefaultOutcome stub if ScriptLanguage/ScriptBody is blank.
            case NodeType.Automation:
                {
                    var outcome = await RunScriptAsync(nextNode, instance);
                    instance.History = new List<HistoryEntry>(instance.History) {
                        new() { NodeId = nextNode.Id, NodeName = nextNode.Name, Action = "AutoCompleted", Actor = "system", Comment = $"Script result: {outcome}" }
                    };
                    await AdvanceFrom(definition, instance, nextNode.Id, actor, outcome, newTasks);
                }
                break;

            // InvokeSoapService: REALLY calls the configured SOAP endpoint - see CallSoapAsync.
            case NodeType.InvokeSoapService:
                {
                    var outcome = await CallSoapAsync(nextNode, instance);
                    instance.History = new List<HistoryEntry>(instance.History) {
                        new() { NodeId = nextNode.Id, NodeName = nextNode.Name, Action = "AutoCompleted", Actor = "system", Comment = $"SOAP result: {outcome}" }
                    };
                    await AdvanceFrom(definition, instance, nextNode.Id, actor, outcome, newTasks);
                }
                break;

            // Logger: REALLY logs. No external system involved (it's just a history entry),
            // so unlike the other Engine/Integration activities there's nothing to "wire up
            // for real" later - this is always live.
            case NodeType.Logger:
                {
                    var message = SubstitutePlaceholders(nextNode.LogMessage, instance.Data) ?? "";
                    instance.History = new List<HistoryEntry>(instance.History) {
                        new() { NodeId = nextNode.Id, NodeName = nextNode.Name, Action = "Logged", Actor = "system", Comment = message }
                    };
                    await AdvanceFrom(definition, instance, nextNode.Id, actor, newTasks: newTasks);
                }
                break;

            // CancelWorkflow: REALLY cancels the instance right here, same effect as a user
            // clicking Cancel on the instance page, just triggered by the flow itself. Any
            // other still-pending tasks for this instance are force-completed so they don't
            // linger in someone's inbox, same as the manual cancel path.
            case NodeType.CancelWorkflow:
                {
                    var reason = SubstitutePlaceholders(nextNode.CancelReason, instance.Data) ?? "Canceled by workflow.";
                    instance.History = new List<HistoryEntry>(instance.History) {
                        new() { NodeId = nextNode.Id, NodeName = nextNode.Name, Action = "Canceled", Actor = "system", Comment = reason }
                    };
                    instance.Status = InstanceStatus.Terminated;
                    instance.CompletedAt = DateTime.UtcNow;
                    instance.CurrentNodeIds = new List<string>();

                    var pendingTasks = await _db.Tasks
                        .Where(t => t.InstanceId == instance.Id && t.Status == TaskStatus.Pending)
                        .ToListAsync();
                    foreach (var task in pendingTasks)
                    {
                        task.Status = TaskStatus.Completed;
                        task.Decision = "Canceled";
                        task.CompletedAt = DateTime.UtcNow;
                    }
                }
                break;

            // Condition / Switch / ParallelSplit are handled by AdvanceFrom itself.
            // SubWorkflow, DocumentGeneration, FileOperations, XmlAction, DatabaseActivity,
            // Notification and SendSms are still stubs (no real nested-instance execution /
            // document generator / file system / XML engine / database / push provider / SMS
            // gateway wired up) and auto-complete via DefaultOutcome.
            case NodeType.Condition:
            case NodeType.Switch:
            case NodeType.ParallelSplit:
            case NodeType.SubWorkflow:
            case NodeType.DocumentGeneration:
            case NodeType.FileOperations:
            case NodeType.XmlAction:
            case NodeType.DatabaseActivity:
            case NodeType.Notification:
            case NodeType.SendSms:
                instance.History = new List<HistoryEntry>(instance.History) {
                    new() { NodeId = nextNode.Id, NodeName = nextNode.Name, Action = "AutoCompleted", Actor = "system" }
                };
                await AdvanceFrom(definition, instance, nextNode.Id, actor, newTasks: newTasks);
                break;

            case NodeType.Start:
            case NodeType.ParallelJoin:
                CompleteInstanceIfNoWork(instance);
                break;
        }
    }

    /// <summary>
    /// Actually runs the node's script if ScriptLanguage/ScriptBody are both set - see
    /// Services/ScriptRunner.cs for the JavaScript-vs-C# trust distinction. The script can
    /// read/write the instance's data (merged back in on success) and set which outgoing edge
    /// to take via a variable called `outcome`. Falls back to the old DefaultOutcome stub
    /// behavior if no language is configured, or if the script throws/times out - a bad
    /// script never crashes the request, it just doesn't get to pick its own outcome.
    /// </summary>
    private async Task<string> RunScriptAsync(WorkflowNode node, WorkflowInstance instance)
    {
        var fallback = string.IsNullOrEmpty(node.DefaultOutcome) ? "Successful" : node.DefaultOutcome;
        if (string.IsNullOrEmpty(node.ScriptLanguage) || string.IsNullOrWhiteSpace(node.ScriptBody))
            return fallback;

        var result = await _scriptRunner.RunAsync(node.ScriptLanguage, node.ScriptBody, instance.Data);
        if (!result.Success)
        {
            instance.History = new List<HistoryEntry>(instance.History) {
                new() { NodeId = node.Id, NodeName = node.Name, Action = "ScriptError", Actor = "system", Comment = result.Error }
            };
            return fallback;
        }

        if (result.UpdatedData != null) instance.Data = result.UpdatedData;
        return string.IsNullOrEmpty(result.Outcome) ? fallback : result.Outcome;
    }

    /// <summary>
    /// Actually sends the email via SMTP if configured (see IEmailSender), substituting
    /// {{fieldName}} placeholders in To/Subject/Body against the instance's collected data
    /// first - the seeded templates already write emails like "Hi {{employeeName}}..." that
    /// were never actually resolved while this node was a stub. Falls back to the old
    /// DefaultOutcome behavior if SMTP isn't configured, so flows still test-run end to end
    /// without needing real mail server credentials.
    /// </summary>
    private async Task<string> SendEmailAsync(WorkflowNode node, WorkflowInstance instance)
    {
        if (!_emailSender.IsConfigured)
            return string.IsNullOrEmpty(node.DefaultOutcome) ? "Successful" : node.DefaultOutcome;

        var to = SubstitutePlaceholders(node.EmailTo, instance.Data);
        if (string.IsNullOrWhiteSpace(to))
            return "UnSuccessful"; // nothing to send to - don't silently pretend it worked

        var subject = SubstitutePlaceholders(node.EmailSubject, instance.Data);
        var body = SubstitutePlaceholders(node.EmailBody, instance.Data);

        var sent = await _emailSender.SendAsync(to, subject ?? "", body ?? "", node.EmailIsHtml);
        return sent ? "Successful" : "UnSuccessful";
    }

    private static string? SubstitutePlaceholders(string? template, IDictionary<string, object?> data)
    {
        if (string.IsNullOrEmpty(template)) return template;
        return System.Text.RegularExpressions.Regex.Replace(template, @"\{\{(\w+)\}\}", m =>
            data.TryGetValue(m.Groups[1].Value, out var v) ? v?.ToString() ?? "" : m.Value);
    }

    /// <summary>
    /// Actually calls the node's configured webhook. Returns "Successful" / "UnSuccessful"
    /// (based on the real HTTP status code) or "Error Encountered" (connection failure,
    /// timeout, DNS failure, etc). A blank or still-placeholder URL (e.g. the "TODO-..." ones
    /// in the Skelta-recreated templates) skips the real call and falls back to the node's
    /// DefaultOutcome so a not-yet-configured flow can still be test-run end to end.
    /// </summary>
    private async Task<string> CallWebhookAsync(WorkflowNode node, WorkflowInstance instance)
    {
        if (string.IsNullOrWhiteSpace(node.WebhookUrl) || node.WebhookUrl.Contains("TODO", StringComparison.OrdinalIgnoreCase))
            return string.IsNullOrEmpty(node.DefaultOutcome) ? "Successful" : node.DefaultOutcome;

        try
        {
            var client = _httpClientFactory.CreateClient("workflow-webhook");
            var method = (node.WebhookMethod ?? "GET").ToUpperInvariant();

            HttpResponseMessage response;
            if (method is "POST" or "PUT")
            {
                var json = JsonSerializer.Serialize(instance.Data);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                response = method == "PUT"
                    ? await client.PutAsync(node.WebhookUrl, content)
                    : await client.PostAsync(node.WebhookUrl, content);
            }
            else
            {
                var request = new HttpRequestMessage(new HttpMethod(method), node.WebhookUrl);
                response = await client.SendAsync(request);
            }

            var body = await response.Content.ReadAsStringAsync();
            MergeJsonResponseIntoData(body, instance);
            StoreResultVariable(node.ResultVariable, body, instance);

            return response.IsSuccessStatusCode ? "Successful" : "UnSuccessful";
        }
        catch
        {
            return "Error Encountered";
        }
    }

    /// <summary>
    /// Actually calls the node's configured SOAP endpoint: POSTs SoapEnvelope (with
    /// {{fieldName}} placeholders substituted from the instance's data) as text/xml, with the
    /// SOAPAction header set. Parsing an arbitrary WSDL response shape generically isn't
    /// practical, so unlike CallWebhookAsync this does NOT try to flatten the response into
    /// individual data fields - the raw XML always goes into ResultVariable (or "soapResponse"
    /// if that's blank) for a downstream XmlAction/Script node to pick apart. Returns
    /// "Successful"/"UnSuccessful" from the HTTP status, "Error Encountered" on a connection
    /// failure, or falls back to DefaultOutcome if the URL is blank/still a TODO placeholder.
    /// </summary>
    private async Task<string> CallSoapAsync(WorkflowNode node, WorkflowInstance instance)
    {
        if (string.IsNullOrWhiteSpace(node.WebhookUrl) || node.WebhookUrl.Contains("TODO", StringComparison.OrdinalIgnoreCase))
            return string.IsNullOrEmpty(node.DefaultOutcome) ? "Successful" : node.DefaultOutcome;

        try
        {
            var client = _httpClientFactory.CreateClient("workflow-webhook");
            var envelope = SubstitutePlaceholders(node.SoapEnvelope, instance.Data) ?? "";
            var content = new StringContent(envelope, Encoding.UTF8, "text/xml");
            if (!string.IsNullOrEmpty(node.SoapAction))
                content.Headers.Add("SOAPAction", node.SoapAction);

            var response = await client.PostAsync(node.WebhookUrl, content);
            var body = await response.Content.ReadAsStringAsync();
            StoreResultVariable(node.ResultVariable ?? "soapResponse", body, instance);

            // A SOAP Fault can come back with HTTP 200 depending on the server, so check for
            // one explicitly rather than trusting the status code alone.
            var hasFault = body.Contains("Fault>", StringComparison.OrdinalIgnoreCase);
            return (response.IsSuccessStatusCode && !hasFault) ? "Successful" : "UnSuccessful";
        }
        catch
        {
            return "Error Encountered";
        }
    }

    /// <summary>Stores a raw response value under an explicit variable name in the instance's
    /// data, in addition to whatever field-level flattening a caller also does. This is the
    /// "assign result to a variable" behavior - Task form fields (or a later Script/Condition
    /// node) with a matching key automatically see it, same mechanism as any other data field.</summary>
    private static void StoreResultVariable(string? variableName, string rawValue, WorkflowInstance instance)
    {
        if (string.IsNullOrWhiteSpace(variableName)) return;
        var merged = new Dictionary<string, object?>(instance.Data) { [variableName] = rawValue };
        instance.Data = merged;
    }

    /// <summary>Best-effort merge of a flat JSON object response into the instance's data bag
    /// (e.g. a "GetNewManager" call returning {"managerUsername":"nadia"} becomes available
    /// to every later node/condition as instance.Data["managerUsername"]). Silently no-ops on
    /// anything that isn't a simple JSON object - never lets a malformed response break the flow.</summary>
    private static void MergeJsonResponseIntoData(string body, WorkflowInstance instance)
    {
        if (string.IsNullOrWhiteSpace(body)) return;
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return;

            var merged = new Dictionary<string, object?>(instance.Data);
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                merged[prop.Name] = prop.Value.ValueKind switch
                {
                    JsonValueKind.String => prop.Value.GetString(),
                    JsonValueKind.Number => prop.Value.GetDouble(),
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    JsonValueKind.Null => null,
                    _ => prop.Value.ToString() // nested object/array - stash as raw text rather than drop it
                };
            }
            instance.Data = merged;
        }
        catch (JsonException) { /* not JSON, or not an object - ignore */ }
    }

    private static void CompleteInstanceIfNoWork(WorkflowInstance instance)
    {
        if (instance.CurrentNodeIds.Count == 0 && instance.Status == InstanceStatus.Running)
        {
            instance.Status = InstanceStatus.Completed;
            instance.CompletedAt = DateTime.UtcNow;
        }
    }
}
