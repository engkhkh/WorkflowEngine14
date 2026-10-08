namespace WorkflowEngine.Api.Models;

/// <summary>
/// Node types supported by the engine.
///  Start / End       - Skelta/Camunda style boundary events
///  FormTask          - a user must fill a form (n8n-style "step" + Skelta "InfoPath/Web form" task)
///  ApprovalTask      - a user must Approve or Reject (Skelta approval activity)
///  Condition         - exclusive gateway that branches based on collected data (Camunda XOR-gateway)
///  Switch             - n-way branch on a single field's value (n8n Switch node / Camunda multi-outcome gateway)
///  ParallelSplit        - fork: every outgoing branch runs concurrently (Camunda/Skelta AND-gateway)
///  ParallelJoin          - sync point: waits until every incoming branch has arrived before continuing
///  Timer                   - waits for a duration before continuing (Skelta delay activity) - really waits
///  Email                     - sends a notification (Skelta email activity)
///  WebhookCall                  - calls an external HTTP endpoint (n8n HTTP request node) - really calls it
///  Automation                     - generic no-human-input step (script / custom code)
///  SubWorkflow                       - invokes another workflow definition (Camunda Call Activity) - stub for now
///  DocumentGeneration                   - generates a document from a template (Skelta document activity) - stub
///  InvokeSoapService                       - calls a SOAP/XML web service (Skelta Integration Activity) - really calls it
///  FileOperations                             - read/write/copy/delete a file (Skelta Integration Activity) - stub
///  XmlAction                                     - transform/query XML (Skelta Integration Activity) - stub
///  DatabaseActivity                                - runs a query against a database (Skelta Engine Activity) - stub
///  Logger                                            - writes a message to the instance history (Skelta Engine Activity) - really logs it
///  Notification                                        - in-app/push notification (Skelta Communication activity) - stub
///  SendSms                                               - sends an SMS (Skelta Communication activity) - stub
///  CancelWorkflow                                          - cancels the running instance from within the flow itself
///                                                             (Skelta Security "Cancel Approval Workflow") - really cancels it
/// </summary>
public enum NodeType
{
    Start,
    End,
    FormTask,
    ApprovalTask,
    Condition,
    Switch,
    ParallelSplit,
    ParallelJoin,
    Timer,
    Email,
    WebhookCall,
    Automation,
    SubWorkflow,
    DocumentGeneration,
    InvokeSoapService,
    FileOperations,
    XmlAction,
    DatabaseActivity,
    Logger,
    Notification,
    SendSms,
    CancelWorkflow
}

public class WorkflowNode
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public NodeType Type { get; set; }
    public string Name { get; set; } = string.Empty;

    // Canvas position, used purely by the Angular designer to redraw the diagram.
    public double X { get; set; }
    public double Y { get; set; }

    // Who should receive the task. A comma-separated list means "assigned to more than one
    // person/role at once" (Skelta's multi-user work items) - whoever acts on it first
    // completes it for everyone else too, since it's a single task row, not one per assignee.
    public string? Assignee { get; set; }

    // Shown to whoever ends up with this node's task (FormTask/ApprovalTask), and as a
    // designer-only note on every other node type. Skelta calls this an activity's
    // "Instructions"/description text.
    public string? Description { get; set; }

    // Present only on FormTask / ApprovalTask nodes.
    public FormDefinition? Form { get; set; }

    // Present only on Condition nodes, e.g. "amount > 1000"
    public string? ConditionExpression { get; set; }

    // Present only on generic Automation nodes. AutomationAction is a short label (e.g.
    // "script.run"); ScriptBody is the actual multi-line script text (Skelta's Script
    // activity expression editor). If ScriptLanguage is set ("JavaScript" or "CSharp") it
    // REALLY runs - see WorkflowEngineService.RunScriptAsync / Services/ScriptRunner.cs -
    // otherwise (null) it stays the old stub (auto-completes via DefaultOutcome).
    public string? AutomationAction { get; set; }
    public string? ScriptBody { get; set; }
    public string? ScriptLanguage { get; set; } // "JavaScript" (sandboxed) | "CSharp" (full trust, not sandboxed)

    // --- Skelta-style escalation, available on FormTask / ApprovalTask ---
    // If the task is still Pending this many minutes after creation, the background
    // TaskEscalationService reassigns it to EscalateTo and logs an "Escalated" history entry.
    public int? EscalateAfterMinutes { get; set; }
    public string? EscalateTo { get; set; }

    // Priority shown in the task inbox (Low / Normal / High / Urgent). FormTask/ApprovalTask only.
    public string? Priority { get; set; }

    // --- Timer node ---
    public int? DurationSeconds { get; set; }

    // --- Email node - really sends via SMTP now, see WorkflowEngineService.SendEmailAsync.
    // Falls back to the DefaultOutcome stub behavior if SMTP isn't configured. ---
    public string? EmailTo { get; set; }
    public string? EmailSubject { get; set; }
    public string? EmailBody { get; set; }
    public bool EmailIsHtml { get; set; } // Skelta 2017 R2 U2 added HTML subject/body support

    // --- WebhookCall node (Skelta "Invoke Web API" / REST) ---
    public string? WebhookUrl { get; set; }
    public string? WebhookMethod { get; set; } // GET / POST / PUT / DELETE

    // If set, the ENTIRE raw response (parsed JSON if possible, else raw text) is ALSO stored
    // under this exact key in the instance's data, in addition to the existing behavior of
    // flattening a JSON object response's top-level fields directly into the data bag. Lets
    // you reference "the whole response" explicitly (e.g. in a later Script node, or bound
    // straight onto a Task's form field with a matching key) instead of only ever getting
    // individual flattened fields. Same idea as Skelta's "assign to variable" output binding.
    public string? ResultVariable { get; set; }

    // --- InvokeSoapService node (Skelta Integration Activity - SOAP/XML) - really calls it ---
    // Posts SoapEnvelope (with instance data's {{fieldName}} placeholders substituted) as the
    // request body with the SOAPAction header set, to WebhookUrl. The raw XML response text is
    // stored under ResultVariable (reuses the same field as WebhookCall above) since parsing an
    // arbitrary WSDL response shape generically isn't practical - read/query it further with an
    // XmlAction or Script node downstream.
    public string? SoapEnvelope { get; set; }
    public string? SoapAction { get; set; }

    // --- FileOperations node (Skelta Integration Activity) - stub, see SubWorkflow note ---
    public string? FileOperation { get; set; } // "Read" | "Write" | "Copy" | "Delete" | "Move"
    public string? FilePath { get; set; }

    // --- XmlAction node (Skelta Integration Activity) - stub, see SubWorkflow note ---
    public string? XmlXPath { get; set; }
    public string? XmlSourceVariable { get; set; }

    // --- Multi-outcome auto nodes: Automation / Email / WebhookCall / Timer ---
    // Skelta activities like "Invoke Web API" or "Script" branch on multiple real outcomes
    // (Successful / UnSuccessful / Error Encountered, or numeric 0/1). This demo engine has
    // no real HTTP client or script runtime behind these nodes, so it can't evaluate which
    // outcome actually happened - instead the designer picks which outgoing edge (by label)
    // the node should always take, so the *shape* of a recreated flow (including its retry
    // loops) stays faithful even though the branching itself isn't really executed. Wire a
    // real HTTP client / script host into WorkflowEngineService.FollowEdge to make this live.
    public string? DefaultOutcome { get; set; }

    // --- Escalation behavior, available on FormTask / ApprovalTask ---
    // "Reassign" (default) hands the task to EscalateTo and keeps it pending, same as before.
    // "AutoComplete" instead completes the task itself once the deadline passes, using
    // TimeoutDecision as the outcome (must match one of the node's outgoing edge labels) -
    // models Skelta's "Timeout Warning - Action" pattern where an unanswered task times
    // itself out onto its own branch rather than just being handed to someone else.
    // "Notify" sends a one-time reminder to EscalateTo (a username or role) and leaves the task
    // exactly where it is - not reassigned, not completed. Modeled on Skelta_HWS.dll's separate
    // EscalateReminderMessage / EscalateNotificaion handlers, which are distinct from its
    // EscalateWorkItemReassign / EscalateMoveToDifferentQueue ones: a nudge is not a handoff.
    public string? EscalationMode { get; set; } // "Reassign" | "AutoComplete" | "Notify"

    // If true, EscalateAfterMinutes counts only business time (see BusinessHoursCalculator),
    // not raw wall-clock minutes. Read from the definition at sweep time rather than
    // snapshotted onto the task, so no new WorkflowTask column is needed.
    public bool UseBusinessHours { get; set; }
    public string? TimeoutDecision { get; set; }

    // --- Switch node (n8n Switch / Camunda multi-outcome gateway) ---
    // Reads instance.Data[SwitchField] and takes the outgoing edge whose Label matches its
    // value (case-insensitive), e.g. field "leaveType" -> edges labeled "Annual"/"Sick"/"Unpaid".
    // Falls back to an edge labeled "Default", then to the first outgoing edge.
    public string? SwitchField { get; set; }

    // --- SubWorkflow node (Camunda Call Activity) ---
    // References another published WorkflowDefinition by id. This is currently a STUB, same
    // as Email/Automation/DocumentGeneration below: it auto-completes via DefaultOutcome
    // rather than actually starting and waiting on a real nested instance. Wire real
    // parent/child instance linking into WorkflowEngineService.FollowEdge to make this live.
    public string? SubWorkflowDefinitionId { get; set; }
    public string? SubWorkflowDefinitionName { get; set; } // cached label for display only

    // --- DocumentGeneration node (Skelta document activity) - stub, see SubWorkflow note ---
    public string? DocumentTemplate { get; set; }
    public string? DocumentName { get; set; }

    // --- DatabaseActivity node (Skelta Engine Activity) - stub. Genuine arbitrary SQL
    // execution against a user-provided connection string is a real trust decision, same
    // category as the C# script option - not wired to actually run until you ask for it. ---
    public string? DatabaseConnectionName { get; set; } // a named connection you'd configure server-side, not a raw string
    public string? DatabaseQuery { get; set; }

    // --- Logger node (Skelta Engine Activity) - REALLY logs: appends Message (with
    // {{fieldName}} placeholders substituted) as a plain entry in the instance's history.
    // No external system involved, so there's no real/stub distinction to make here - safe
    // by construction, unlike the other Integration/Engine activities above. ---
    public string? LogMessage { get; set; }

    // --- Notification / SendSms nodes (Skelta Communication activities) - stub, same shape
    // as Email before it went live; wire a push provider / SMS gateway to make these real. ---
    public string? NotificationTo { get; set; }
    public string? NotificationMessage { get; set; }
    public string? SmsTo { get; set; }
    public string? SmsMessage { get; set; }

    // --- CancelWorkflow node (Skelta Security "Cancel Approval Workflow") - REALLY cancels
    // the running instance when reached, exactly like a user hitting the Cancel button on
    // the instance page, just triggered by the flow itself (e.g. from a Condition branch
    // that detects the request is no longer needed). No further nodes execute after this. ---
    public string? CancelReason { get; set; }
}

public class WorkflowEdge
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string SourceNodeId { get; set; } = string.Empty;
    public string TargetNodeId { get; set; } = string.Empty;

    // For ApprovalTask outgoing edges this MUST be "Approve" or "Reject".
    // For Condition outgoing edges this is "True" / "False".
    // For ParallelSplit outgoing edges every edge fires ("Default" x N - order doesn't matter).
    // For everything else it is simply "Default".
    public string Label { get; set; } = "Default";
}

public class WorkflowDefinition
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public bool IsPublished { get; set; }
    public int Version { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public List<WorkflowNode> Nodes { get; set; } = new();
    public List<WorkflowEdge> Edges { get; set; } = new();
}
