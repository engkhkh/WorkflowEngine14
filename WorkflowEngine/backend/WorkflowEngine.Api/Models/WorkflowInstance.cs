namespace WorkflowEngine.Api.Models;

public enum InstanceStatus
{
    Running,
    Completed,
    Terminated
}

public enum TaskStatus
{
    Pending,
    Completed
}

public class HistoryEntry
{
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string NodeId { get; set; } = string.Empty;
    public string NodeName { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty; // "Entered", "Approved", "Rejected", "Submitted", "AutoCompleted", "Escalated", "Forked", "Joined"
    public string? Actor { get; set; }
    public string? Comment { get; set; }

    // The specific edge that was followed to reach NodeId, if any - null for the Start node's
    // initial entry, and for markers like "Forked"/"AutoCompleted"/"Escalated" that aren't a
    // single-edge traversal. Lets the UI draw exactly which path an instance actually took.
    public string? EdgeId { get; set; }
}

/// <summary>
/// A real, queryable row per node action, separate from WorkflowInstance.History (which lives
/// inside that instance's JSON blob). This table survives independently, can be queried with
/// plain SQL across every instance at once (for ops/audit/reporting), and is the DB half of
/// the dual DB+file logging - see Services/ActivityFileLogger.cs for the file half.
/// </summary>
public class ActivityLogEntry
{
    public long Id { get; set; }
    public string InstanceId { get; set; } = string.Empty;
    public string DefinitionId { get; set; } = string.Empty;
    public string NodeId { get; set; } = string.Empty;
    public string NodeName { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string? Actor { get; set; }
    public string? Comment { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}

public class WorkflowInstance
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string DefinitionId { get; set; } = string.Empty;
    public string DefinitionName { get; set; } = string.Empty;
    public InstanceStatus Status { get; set; } = InstanceStatus.Running;

    // Node(s) the token is currently sitting at - a list because ParallelSplit
    // puts multiple concurrent tokens in flight at once.
    public List<string> CurrentNodeIds { get; set; } = new();

    // For each ParallelJoin node id, how many of its incoming branches have arrived
    // so far. Compared against the join's incoming-edge count in the definition to
    // decide whether the engine can continue past the join.
    public Dictionary<string, int> JoinArrivalCounts { get; set; } = new();

    // Cumulative data collected from every form submitted along the way.
    public Dictionary<string, object?> Data { get; set; } = new();

    public List<HistoryEntry> History { get; set; } = new();

    public string StartedBy { get; set; } = string.Empty;
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}

public class WorkflowTask
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string InstanceId { get; set; } = string.Empty;
    public string DefinitionId { get; set; } = string.Empty;
    public string NodeId { get; set; } = string.Empty;
    public string NodeName { get; set; } = string.Empty;
    public NodeType NodeType { get; set; }
    public string? AssignedTo { get; set; }
    public string? Priority { get; set; } // Low / Normal / High / Urgent
    public TaskStatus Status { get; set; } = TaskStatus.Pending;
    public FormDefinition? Form { get; set; }

    // The outcome buttons the frontend should render, snapshotted at task-creation time
    // from the distinct labels of this node's outgoing edges (e.g. ["Approve","Reject"],
    // or ["Suitable","Approved"], or ["Approved","Rejected","Canceled"] - Skelta lets each
    // Task activity define its own arbitrary outcome buttons, not just Approve/Reject, and
    // this generalizes to match. Falls back to ["Submit"] for a plain FormTask.
    public List<string> AvailableDecisions { get; set; } = new();

    public string Decision { get; set; } = string.Empty; // whichever AvailableDecisions entry was chosen
    public Dictionary<string, object?>? SubmittedData { get; set; }
    public string? Comment { get; set; }

    // --- Escalation bookkeeping (snapshotted from the node's Escalate*/EscalationMode fields) ---
    public int? EscalateAfterMinutes { get; set; }
    public string? EscalateTo { get; set; }
    public string? EscalationMode { get; set; } // "Reassign" | "AutoComplete"
    public string? TimeoutDecision { get; set; }
    public bool IsEscalated { get; set; }
    public string? OriginalAssignee { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}
