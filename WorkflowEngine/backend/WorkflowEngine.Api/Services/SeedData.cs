using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Services;

public static partial class SeedData
{
    /// <summary>
    /// Demo accounts, one per role used in the sample workflow below. Username == the
    /// Assignee/Role value nodes reference, so the seeded flow "just works" against them.
    /// Passwords are the username + "123" purely for local dev convenience - change/remove
    /// this seeding entirely for anything beyond a demo.
    /// </summary>
    public static async Task SeedUsers(WorkflowDbContext db)
    {
        var accounts = new[]
        {
            ("employee", "Emma Employee", "employee@example.com", "employee"),
            ("manager", "Mike Manager", "manager@example.com", "manager"),
            ("new-manager", "Nadia New-Manager", "new.manager@example.com", "new-manager"),
            ("senior-manager", "Sara Senior-Manager", "senior.manager@example.com", "senior-manager"),
            ("hr", "Hana HR", "hr@example.com", "hr"),
            ("it", "Ivan IT", "it@example.com", "it"),
            ("finance", "Fiona Finance", "finance@example.com", "finance"),
            ("admin-stores", "Adam Admin-Stores", "admin.stores@example.com", "admin-stores"),
            ("department-head", "Dana Department-Head", "dept.head@example.com", "department-head"),
            ("secretary", "Sally Secretary", "secretary@example.com", "secretary"),
            ("committee-manager", "Cody Committee-Manager", "committee.manager@example.com", "committee-manager"),
            ("ambitious-committee", "Amira Committee-Member", "ambitious.committee@example.com", "ambitious-committee"),
            ("admin", "Alex Admin", "admin@example.com", "admin"),
            // ERP roles used by the Procure-to-Pay / Order-to-Cash / inventory / finance templates (SeedData.Erp.cs)
            ("procurement", "Paula Procurement", "procurement@example.com", "procurement"),
            ("warehouse", "Wade Warehouse", "warehouse@example.com", "warehouse"),
            ("sales", "Sami Sales", "sales@example.com", "sales"),
        };

        foreach (var (username, displayName, email, role) in accounts)
        {
            if (await db.Users.AnyAsync(u => u.Username == username)) continue;

            var (hash, salt) = PasswordHasher.Hash(username + "123");
            db.Users.Add(new User
            {
                Username = username,
                DisplayName = displayName,
                Email = email,
                Role = role,
                PasswordHash = hash,
                PasswordSalt = salt
            });
        }

        await db.SaveChangesAsync();
    }

    public static async Task SeedWorkflows(WorkflowDbContext db)
    {
        var builders = new (string Name, Func<WorkflowDefinition> Build)[]
        {
            ("Leave Request Approval", BuildLeaveRequestApproval),
            ("Clearance Approval", BuildClearanceApproval),
            ("Employee Transfer Approval", BuildEmployeeTransferApproval),
            ("New Start Work Approval", BuildNewStartWorkApproval),
            ("Candidates Request (from Skelta)", BuildCandidatesRequestFromSkelta),
            ("Ambitious Transfer (from Skelta)", BuildAmbitiousTransferFromSkelta),
            // ERP business processes (see SeedData.Erp.cs)
            (ErpPurchaseRequisitionName, BuildPurchaseRequisitionP2P),
            (ErpSalesOrderName, BuildSalesOrderO2C),
            (ErpStockTransferName, BuildStockTransfer),
            (ErpExpenseClaimName, BuildExpenseClaim),
            (ErpVendorRegistrationName, BuildVendorRegistration),
        };

        foreach (var (name, build) in builders)
        {
            if (await db.Definitions.AnyAsync(d => d.Name == name)) continue;
            db.Definitions.Add(build());
        }

        await db.SaveChangesAsync();
    }

    private static WorkflowDefinition BuildLeaveRequestApproval()
    {
        var start = new WorkflowNode { Type = NodeType.Start, Name = "Start", X = 40, Y = 260 };

        var request = new WorkflowNode
        {
            Type = NodeType.FormTask,
            Name = "Submit Leave Request",
            X = 240,
            Y = 260,
            Assignee = "employee",
            Priority = "Normal",
            Form = new FormDefinition
            {
                Title = "Leave Request",
                Fields = new List<FormField>
                {
                    new() { Key = "employeeName", Label = "Employee Name", Type = FormFieldType.Text, Required = true },
                    new() { Key = "employeeEmail", Label = "Employee Email", Type = FormFieldType.Email, Required = true },
                    new() { Key = "leaveType", Label = "Leave Type", Type = FormFieldType.Select, Required = true,
                        Options = new() { new(){Label="Annual",Value="Annual"}, new(){Label="Sick",Value="Sick"}, new(){Label="Unpaid",Value="Unpaid"} } },
                    new() { Key = "days", Label = "Number of Days", Type = FormFieldType.Number, Required = true },
                    new() { Key = "reason", Label = "Reason", Type = FormFieldType.TextArea }
                }
            }
        };

        var managerApproval = new WorkflowNode
        {
            Type = NodeType.ApprovalTask,
            Name = "Manager Approval",
            X = 460,
            Y = 260,
            Assignee = "manager",
            Priority = "High",
            // Skelta-style escalation: if the manager sits on it for a day, bump it to senior-manager.
            EscalateAfterMinutes = 1440,
            EscalateTo = "senior-manager",
            Form = new FormDefinition
            {
                Title = "Review Leave Request",
                Fields = new List<FormField>
                {
                    new() { Key = "employeeName", Label = "Employee Name", Type = FormFieldType.Text, ReadOnly = true },
                    new() { Key = "leaveType", Label = "Leave Type", Type = FormFieldType.Text, ReadOnly = true },
                    new() { Key = "days", Label = "Number of Days", Type = FormFieldType.Number, ReadOnly = true },
                    new() { Key = "managerComment", Label = "Comment", Type = FormFieldType.TextArea }
                }
            }
        };

        var condition = new WorkflowNode
        {
            Type = NodeType.Condition,
            Name = "Long Leave?",
            X = 680,
            Y = 260,
            ConditionExpression = "days > 5"
        };

        var hrApproval = new WorkflowNode
        {
            Type = NodeType.ApprovalTask,
            Name = "HR Approval (Long Leave)",
            X = 680,
            Y = 100,
            Assignee = "hr",
            Priority = "Normal",
            Form = new FormDefinition
            {
                Title = "HR Review",
                Fields = new List<FormField>
                {
                    new() { Key = "hrComment", Label = "HR Comment", Type = FormFieldType.TextArea }
                }
            }
        };

        // Fan out to two independent, concurrent notification branches, then sync back up.
        var split = new WorkflowNode { Type = NodeType.ParallelSplit, Name = "Notify Fan-out", X = 900, Y = 260 };

        var emailEmployee = new WorkflowNode
        {
            Type = NodeType.Email,
            Name = "Email Employee",
            X = 1100,
            Y = 160,
            EmailTo = "{{employeeEmail}}",
            EmailSubject = "Your leave request has been processed",
            EmailBody = "Hi {{employeeName}}, your leave request has been reviewed. Check the portal for details."
        };

        var webhookHris = new WorkflowNode
        {
            Type = NodeType.WebhookCall,
            Name = "Update HRIS System",
            X = 1100,
            Y = 360,
            WebhookMethod = "POST",
            WebhookUrl = "http://localhost:5000/api/demo/action/hris-leave-update"
        };

        var join = new WorkflowNode { Type = NodeType.ParallelJoin, Name = "Notify Sync", X = 1300, Y = 260 };
        var end = new WorkflowNode { Type = NodeType.End, Name = "End", X = 1480, Y = 260 };
        var rejectedEnd = new WorkflowNode { Type = NodeType.End, Name = "Rejected", X = 460, Y = 440 };

        var definition = new WorkflowDefinition
        {
            Name = "Leave Request Approval",
            Description = "Employee submits a leave request; manager approves/rejects (with escalation); leave over 5 days also needs HR sign-off; approved requests notify the employee and update HRIS in parallel.",
            IsPublished = true,
            Nodes = new() { start, request, managerApproval, condition, hrApproval, split, emailEmployee, webhookHris, join, end, rejectedEnd },
            Edges = new()
            {
                new() { SourceNodeId = start.Id, TargetNodeId = request.Id, Label = "Default" },
                new() { SourceNodeId = request.Id, TargetNodeId = managerApproval.Id, Label = "Default" },
                new() { SourceNodeId = managerApproval.Id, TargetNodeId = condition.Id, Label = "Approve" },
                new() { SourceNodeId = managerApproval.Id, TargetNodeId = rejectedEnd.Id, Label = "Reject" },
                new() { SourceNodeId = condition.Id, TargetNodeId = hrApproval.Id, Label = "True" },
                new() { SourceNodeId = condition.Id, TargetNodeId = split.Id, Label = "False" },
                new() { SourceNodeId = hrApproval.Id, TargetNodeId = split.Id, Label = "Approve" },
                new() { SourceNodeId = hrApproval.Id, TargetNodeId = rejectedEnd.Id, Label = "Reject" },
                new() { SourceNodeId = split.Id, TargetNodeId = emailEmployee.Id, Label = "Default" },
                new() { SourceNodeId = split.Id, TargetNodeId = webhookHris.Id, Label = "Default" },
                new() { SourceNodeId = emailEmployee.Id, TargetNodeId = join.Id, Label = "Default" },
                new() { SourceNodeId = webhookHris.Id, TargetNodeId = join.Id, Label = "Default" },
                new() { SourceNodeId = join.Id, TargetNodeId = end.Id, Label = "Default" },
            }
        };

        return definition;
    }

    private static WorkflowDefinition BuildClearanceApproval()
    {
        var start = new WorkflowNode { Type = NodeType.Start, Name = "Start", X = 40, Y = 220 };

        var request = new WorkflowNode
        {
            Type = NodeType.FormTask,
            Name = "Submit Clearance Request",
            X = 240,
            Y = 220,
            Assignee = "employee",
            Priority = "Normal",
            Form = new FormDefinition
            {
                Title = "Exit Clearance Request",
                Fields = new List<FormField>
                {
                    new() { Key = "employeeName", Label = "Employee Name", Type = FormFieldType.Text, Required = true },
                    new() { Key = "department", Label = "Department", Type = FormFieldType.Text, Required = true },
                    new() { Key = "lastWorkingDay", Label = "Last Working Day", Type = FormFieldType.Date, Required = true },
                    new() { Key = "reason", Label = "Reason for Leaving", Type = FormFieldType.TextArea }
                }
            }
        };

        WorkflowNode ClearanceStep(string name, string assignee, double x, double y) => new()
        {
            Type = NodeType.ApprovalTask,
            Name = name,
            X = x,
            Y = y,
            Assignee = assignee,
            Priority = "High",
            EscalateAfterMinutes = 2880, // 2 days
            EscalateTo = "admin",
            Form = new FormDefinition
            {
                Title = name,
                Fields = new List<FormField>
                {
                    new() { Key = "employeeName", Label = "Employee Name", Type = FormFieldType.Text, ReadOnly = true },
                    new() { Key = "lastWorkingDay", Label = "Last Working Day", Type = FormFieldType.Date, ReadOnly = true },
                    new() { Key = assignee.Replace("-", "") + "Comment", Label = "Comment", Type = FormFieldType.TextArea }
                }
            }
        };

        var itClearance = ClearanceStep("IT Clearance", "it", 460, 100);
        var financeClearance = ClearanceStep("Finance Clearance", "finance", 680, 220);
        var storesClearance = ClearanceStep("Admin / Stores Clearance", "admin-stores", 900, 340);

        var hrSignoff = new WorkflowNode
        {
            Type = NodeType.ApprovalTask,
            Name = "HR Final Sign-off",
            X = 1120,
            Y = 220,
            Assignee = "hr",
            Priority = "Urgent",
            Form = new FormDefinition
            {
                Title = "HR Final Sign-off",
                Fields = new List<FormField> { new() { Key = "hrComment", Label = "Final Comment", Type = FormFieldType.TextArea } }
            }
        };

        var notify = new WorkflowNode
        {
            Type = NodeType.Email,
            Name = "Notify Clearance Complete",
            X = 1340,
            Y = 220,
            EmailSubject = "Your clearance is complete",
            EmailBody = "Hi {{employeeName}}, all departments have signed off on your clearance. Final settlement will follow."
        };

        var end = new WorkflowNode { Type = NodeType.End, Name = "End", X = 1540, Y = 220 };
        var rejectedEnd = new WorkflowNode { Type = NodeType.End, Name = "Clearance Blocked", X = 680, Y = 460 };

        return new WorkflowDefinition
        {
            Name = "Clearance Approval",
            Description = "Employee exit clearance: sequential sign-off from IT, Finance and Admin/Stores, then a final HR approval before the employee is notified.",
            IsPublished = true,
            Nodes = new() { start, request, itClearance, financeClearance, storesClearance, hrSignoff, notify, end, rejectedEnd },
            Edges = new()
            {
                new() { SourceNodeId = start.Id, TargetNodeId = request.Id, Label = "Default" },
                new() { SourceNodeId = request.Id, TargetNodeId = itClearance.Id, Label = "Default" },
                new() { SourceNodeId = itClearance.Id, TargetNodeId = financeClearance.Id, Label = "Approve" },
                new() { SourceNodeId = itClearance.Id, TargetNodeId = rejectedEnd.Id, Label = "Reject" },
                new() { SourceNodeId = financeClearance.Id, TargetNodeId = storesClearance.Id, Label = "Approve" },
                new() { SourceNodeId = financeClearance.Id, TargetNodeId = rejectedEnd.Id, Label = "Reject" },
                new() { SourceNodeId = storesClearance.Id, TargetNodeId = hrSignoff.Id, Label = "Approve" },
                new() { SourceNodeId = storesClearance.Id, TargetNodeId = rejectedEnd.Id, Label = "Reject" },
                new() { SourceNodeId = hrSignoff.Id, TargetNodeId = notify.Id, Label = "Approve" },
                new() { SourceNodeId = hrSignoff.Id, TargetNodeId = rejectedEnd.Id, Label = "Reject" },
                new() { SourceNodeId = notify.Id, TargetNodeId = end.Id, Label = "Default" },
            }
        };
    }

    private static WorkflowDefinition BuildEmployeeTransferApproval()
    {
        var start = new WorkflowNode { Type = NodeType.Start, Name = "Start", X = 40, Y = 240 };

        var request = new WorkflowNode
        {
            Type = NodeType.FormTask,
            Name = "Submit Transfer Request",
            X = 240,
            Y = 240,
            Assignee = "employee",
            Priority = "Normal",
            Form = new FormDefinition
            {
                Title = "Employee Transfer Request",
                Fields = new List<FormField>
                {
                    new() { Key = "employeeName", Label = "Employee Name", Type = FormFieldType.Text, Required = true },
                    new() { Key = "currentDept", Label = "Current Department", Type = FormFieldType.Text, Required = true },
                    new() { Key = "newDept", Label = "New Department", Type = FormFieldType.Text, Required = true },
                    new() { Key = "transferDate", Label = "Requested Transfer Date", Type = FormFieldType.Date, Required = true },
                    new() { Key = "crossLocation", Label = "Cross-Location Move?", Type = FormFieldType.Select, Required = true,
                        Options = new() { new(){Label="Yes",Value="Yes"}, new(){Label="No",Value="No"} } },
                    new() { Key = "reason", Label = "Reason", Type = FormFieldType.TextArea }
                }
            }
        };

        var currentManagerApproval = new WorkflowNode
        {
            Type = NodeType.ApprovalTask,
            Name = "Current Manager Approval",
            X = 460,
            Y = 140,
            Assignee = "manager",
            Priority = "High",
            EscalateAfterMinutes = 1440,
            EscalateTo = "senior-manager",
            Form = new FormDefinition
            {
                Title = "Release Approval",
                Fields = new List<FormField>
                {
                    new() { Key = "employeeName", Label = "Employee Name", Type = FormFieldType.Text, ReadOnly = true },
                    new() { Key = "newDept", Label = "New Department", Type = FormFieldType.Text, ReadOnly = true },
                    new() { Key = "releaseComment", Label = "Comment", Type = FormFieldType.TextArea }
                }
            }
        };

        var newManagerApproval = new WorkflowNode
        {
            Type = NodeType.ApprovalTask,
            Name = "Receiving Manager Approval",
            X = 680,
            Y = 240,
            Assignee = "senior-manager",
            Priority = "High",
            Form = new FormDefinition
            {
                Title = "Acceptance Approval",
                Fields = new List<FormField>
                {
                    new() { Key = "employeeName", Label = "Employee Name", Type = FormFieldType.Text, ReadOnly = true },
                    new() { Key = "acceptComment", Label = "Comment", Type = FormFieldType.TextArea }
                }
            }
        };

        var condition = new WorkflowNode
        {
            Type = NodeType.Condition,
            Name = "Cross-Location?",
            X = 900,
            Y = 240,
            ConditionExpression = "crossLocation == Yes"
        };

        var hrApproval = new WorkflowNode
        {
            Type = NodeType.ApprovalTask,
            Name = "HR Approval (Relocation)",
            X = 1120,
            Y = 120,
            Assignee = "hr",
            Priority = "Normal",
            Form = new FormDefinition
            {
                Title = "HR Relocation Review",
                Fields = new List<FormField> { new() { Key = "hrComment", Label = "Comment", Type = FormFieldType.TextArea } }
            }
        };

        var updateHris = new WorkflowNode
        {
            Type = NodeType.WebhookCall,
            Name = "Update HRIS Record",
            X = 1340,
            Y = 240,
            WebhookMethod = "POST",
            WebhookUrl = "http://localhost:5000/api/demo/action/hris-transfer-update"
        };

        var end = new WorkflowNode { Type = NodeType.End, Name = "End", X = 1560, Y = 240 };
        var rejectedEnd = new WorkflowNode { Type = NodeType.End, Name = "Rejected", X = 680, Y = 460 };

        return new WorkflowDefinition
        {
            Name = "Employee Transfer Approval",
            Description = "Employee requests an internal transfer; needs sign-off from both the current and receiving manager, plus HR approval for cross-location moves, before HRIS is updated.",
            IsPublished = true,
            Nodes = new() { start, request, currentManagerApproval, newManagerApproval, condition, hrApproval, updateHris, end, rejectedEnd },
            Edges = new()
            {
                new() { SourceNodeId = start.Id, TargetNodeId = request.Id, Label = "Default" },
                new() { SourceNodeId = request.Id, TargetNodeId = currentManagerApproval.Id, Label = "Default" },
                new() { SourceNodeId = currentManagerApproval.Id, TargetNodeId = newManagerApproval.Id, Label = "Approve" },
                new() { SourceNodeId = currentManagerApproval.Id, TargetNodeId = rejectedEnd.Id, Label = "Reject" },
                new() { SourceNodeId = newManagerApproval.Id, TargetNodeId = condition.Id, Label = "Approve" },
                new() { SourceNodeId = newManagerApproval.Id, TargetNodeId = rejectedEnd.Id, Label = "Reject" },
                new() { SourceNodeId = condition.Id, TargetNodeId = hrApproval.Id, Label = "True" },
                new() { SourceNodeId = condition.Id, TargetNodeId = updateHris.Id, Label = "False" },
                new() { SourceNodeId = hrApproval.Id, TargetNodeId = updateHris.Id, Label = "Approve" },
                new() { SourceNodeId = hrApproval.Id, TargetNodeId = rejectedEnd.Id, Label = "Reject" },
                new() { SourceNodeId = updateHris.Id, TargetNodeId = end.Id, Label = "Default" },
            }
        };
    }

    private static WorkflowDefinition BuildNewStartWorkApproval()
    {
        var start = new WorkflowNode { Type = NodeType.Start, Name = "Start", X = 40, Y = 260 };

        var request = new WorkflowNode
        {
            Type = NodeType.FormTask,
            Name = "New Hire Onboarding Request",
            X = 240,
            Y = 260,
            Assignee = "hr",
            Priority = "High",
            Form = new FormDefinition
            {
                Title = "New Start Work Request",
                Fields = new List<FormField>
                {
                    new() { Key = "newHireName", Label = "New Hire Name", Type = FormFieldType.Text, Required = true },
                    new() { Key = "position", Label = "Position", Type = FormFieldType.Text, Required = true },
                    new() { Key = "department", Label = "Department", Type = FormFieldType.Text, Required = true },
                    new() { Key = "startDate", Label = "Start Date", Type = FormFieldType.Date, Required = true },
                    new() { Key = "hiringManager", Label = "Hiring Manager", Type = FormFieldType.Text, Required = true }
                }
            }
        };

        var deptHeadApproval = new WorkflowNode
        {
            Type = NodeType.ApprovalTask,
            Name = "Department Head Approval",
            X = 460,
            Y = 260,
            Assignee = "department-head",
            Priority = "High",
            EscalateAfterMinutes = 1440,
            EscalateTo = "admin",
            Form = new FormDefinition
            {
                Title = "Approve New Start",
                Fields = new List<FormField>
                {
                    new() { Key = "newHireName", Label = "New Hire Name", Type = FormFieldType.Text, ReadOnly = true },
                    new() { Key = "position", Label = "Position", Type = FormFieldType.Text, ReadOnly = true },
                    new() { Key = "startDate", Label = "Start Date", Type = FormFieldType.Date, ReadOnly = true },
                    new() { Key = "deptComment", Label = "Comment", Type = FormFieldType.TextArea }
                }
            }
        };

        var split = new WorkflowNode { Type = NodeType.ParallelSplit, Name = "Provisioning Fan-out", X = 680, Y = 260 };

        var itAccounts = new WorkflowNode
        {
            Type = NodeType.WebhookCall,
            Name = "Create IT Accounts",
            X = 900,
            Y = 100,
            WebhookMethod = "POST",
            WebhookUrl = "http://localhost:5000/api/demo/lookup/provision"
        };

        var welcomeKit = new WorkflowNode
        {
            Type = NodeType.FormTask,
            Name = "Prepare Welcome Kit",
            X = 900,
            Y = 260,
            Assignee = "admin-stores",
            Priority = "Normal",
            Form = new FormDefinition
            {
                Title = "Welcome Kit Prep",
                Fields = new List<FormField>
                {
                    new() { Key = "deskLocation", Label = "Desk Location", Type = FormFieldType.Text, Required = true },
                    new() { Key = "equipmentList", Label = "Equipment Provided", Type = FormFieldType.TextArea }
                }
            }
        };

        var notifyFacilities = new WorkflowNode
        {
            Type = NodeType.Email,
            Name = "Notify Facilities",
            X = 900,
            Y = 420,
            EmailSubject = "Workspace setup needed",
            EmailBody = "New hire {{newHireName}} starts {{startDate}} in {{department}}. Please prepare their workspace."
        };

        var join = new WorkflowNode { Type = NodeType.ParallelJoin, Name = "Onboarding Sync", X = 1120, Y = 260 };

        var welcomeEmail = new WorkflowNode
        {
            Type = NodeType.Email,
            Name = "Send Welcome Email",
            X = 1320,
            Y = 260,
            EmailSubject = "Welcome to the team!",
            EmailBody = "Hi {{newHireName}}, we're excited to have you starting {{startDate}}! Everything is set up and ready."
        };

        var end = new WorkflowNode { Type = NodeType.End, Name = "End", X = 1520, Y = 260 };
        var rejectedEnd = new WorkflowNode { Type = NodeType.End, Name = "Not Approved", X = 460, Y = 460 };

        return new WorkflowDefinition
        {
            Name = "New Start Work Approval",
            Description = "HR submits a new-hire onboarding request; the department head approves it; IT accounts, a welcome kit, and facilities setup all run in parallel before a welcome email goes out.",
            IsPublished = true,
            Nodes = new() { start, request, deptHeadApproval, split, itAccounts, welcomeKit, notifyFacilities, join, welcomeEmail, end, rejectedEnd },
            Edges = new()
            {
                new() { SourceNodeId = start.Id, TargetNodeId = request.Id, Label = "Default" },
                new() { SourceNodeId = request.Id, TargetNodeId = deptHeadApproval.Id, Label = "Default" },
                new() { SourceNodeId = deptHeadApproval.Id, TargetNodeId = split.Id, Label = "Approve" },
                new() { SourceNodeId = deptHeadApproval.Id, TargetNodeId = rejectedEnd.Id, Label = "Reject" },
                new() { SourceNodeId = split.Id, TargetNodeId = itAccounts.Id, Label = "Default" },
                new() { SourceNodeId = split.Id, TargetNodeId = welcomeKit.Id, Label = "Default" },
                new() { SourceNodeId = split.Id, TargetNodeId = notifyFacilities.Id, Label = "Default" },
                new() { SourceNodeId = itAccounts.Id, TargetNodeId = join.Id, Label = "Default" },
                new() { SourceNodeId = welcomeKit.Id, TargetNodeId = join.Id, Label = "Default" },
                new() { SourceNodeId = notifyFacilities.Id, TargetNodeId = join.Id, Label = "Default" },
                new() { SourceNodeId = join.Id, TargetNodeId = welcomeEmail.Id, Label = "Default" },
                new() { SourceNodeId = welcomeEmail.Id, TargetNodeId = end.Id, Label = "Default" },
            }
        };
    }

    /// <summary>
    /// Recreated from the uploaded Skelta export "RepIntranetStg_CandidatesRequestWF_1.xml".
    /// Skelta's "Invoke Web API" -> WebhookCall, "Script" -> Automation, "TimerTriggerAction"
    /// -> Timer, "Rule" -> Condition, "Task" (3 custom outcomes) -> ApprovalTask,
    /// "Information" -> Email (terminal notice). The retry loop (call API -> on failure wait
    /// on a Timer -> retry the same call) is preserved structurally via each auto node's
    /// DefaultOutcome; it doesn't really retry against a live API in this demo engine (see
    /// the DefaultOutcome doc comment on WorkflowNode). The original export had no explicit
    /// End activities (Skelta flows can just terminate at an Information screen) and Rule1
    /// only had a wired "True" edge - both End nodes and the "False" branch below were added
    /// so the graph is complete; wire the real condition/API details in the designer.
    /// </summary>
    private static WorkflowDefinition BuildCandidatesRequestFromSkelta()
    {
        var start = new WorkflowNode { Type = NodeType.Start, Name = "Start", X = 40, Y = 260 };

        var initialWait = new WorkflowNode
        {
            Type = NodeType.Timer, Name = "Time Trigger2", X = 240, Y = 260,
            DurationSeconds = 60, DefaultOutcome = "TimeOutWarning7"
        };

        var getCandidateData = new WorkflowNode
        {
            Type = NodeType.WebhookCall, Name = "Invoke Web API1", X = 460, Y = 260,
            WebhookMethod = "GET", WebhookUrl = "http://localhost:5000/api/demo/lookup/candidates",
            DefaultOutcome = "Successful"
        };

        var retryWait = new WorkflowNode
        {
            Type = NodeType.Timer, Name = "Time Trigger1", X = 460, Y = 440,
            DurationSeconds = 300, DefaultOutcome = "TimeOutWarning1"
        };

        var prepScript = new WorkflowNode
        {
            Type = NodeType.Automation, Name = "Script1", X = 680, Y = 260,
            AutomationAction = "script.run", DefaultOutcome = "1"
        };

        var interviewTask = new WorkflowNode
        {
            Type = NodeType.ApprovalTask, Name = "Interview Data Entry", X = 900, Y = 260,
            Assignee = "hr", Priority = "High",
            EscalateAfterMinutes = 4320, EscalateTo = "hr", EscalationMode = "AutoComplete", TimeoutDecision = "Timeout - Action",
            Form = new FormDefinition
            {
                Title = "Interview Evaluation",
                Fields = new List<FormField>
                {
                    new() { Key = "candidateName", Label = "Candidate Name", Type = FormFieldType.Text, Required = true },
                    new() { Key = "position", Label = "Position", Type = FormFieldType.Text, Required = true },
                    new() { Key = "interviewNotes", Label = "Interview Notes", Type = FormFieldType.TextArea, Required = true },
                    new() { Key = "score", Label = "Score", Type = FormFieldType.Number }
                }
            }
        };

        var updateVar = new WorkflowNode { Type = NodeType.Automation, Name = "Update Variable1", X = 1120, Y = 180, AutomationAction = "variable.set", DefaultOutcome = "Updated" };
        var rule = new WorkflowNode { Type = NodeType.Condition, Name = "Rule1", X = 1340, Y = 180, ConditionExpression = "score >= 70" };
        var updateStatus = new WorkflowNode { Type = NodeType.WebhookCall, Name = "UpdateStatus", X = 1120, Y = 420, WebhookMethod = "POST", WebhookUrl = "http://localhost:5000/api/demo/action/candidate-status", DefaultOutcome = "Successful" };

        var suitableNotice = new WorkflowNode { Type = NodeType.Email, Name = "Information1 (Suitable)", X = 1560, Y = 100, EmailSubject = "Candidate is suitable", EmailBody = "{{candidateName}} passed the interview stage." };
        var timeoutNotice = new WorkflowNode { Type = NodeType.Email, Name = "Information3 (Status Updated)", X = 1340, Y = 420, EmailSubject = "Candidate status updated", EmailBody = "No response received in time; status updated automatically." };
        var notSuitableNotice = new WorkflowNode { Type = NodeType.Email, Name = "Not Suitable", X = 1560, Y = 260, EmailSubject = "Candidate not suitable", EmailBody = "{{candidateName}} did not meet the required score." };

        var end1 = new WorkflowNode { Type = NodeType.End, Name = "End", X = 1780, Y = 100 };
        var end2 = new WorkflowNode { Type = NodeType.End, Name = "End", X = 1780, Y = 260 };
        var end3 = new WorkflowNode { Type = NodeType.End, Name = "End", X = 1560, Y = 420 };

        return new WorkflowDefinition
        {
            Name = "Candidates Request (from Skelta)",
            Description = "Recreated from a Skelta export: fetches candidate data via a Web API (with retry-on-failure), routes to an HR interview evaluation task (with a 3-day auto-timeout), then a rule decides suitability.",
            IsPublished = true,
            Nodes = new() { start, initialWait, getCandidateData, retryWait, prepScript, interviewTask, updateVar, rule, updateStatus, suitableNotice, timeoutNotice, notSuitableNotice, end1, end2, end3 },
            Edges = new()
            {
                new() { SourceNodeId = start.Id, TargetNodeId = initialWait.Id, Label = "Default" },
                new() { SourceNodeId = initialWait.Id, TargetNodeId = getCandidateData.Id, Label = "TimeOutWarning7" },
                new() { SourceNodeId = getCandidateData.Id, TargetNodeId = prepScript.Id, Label = "Successful" },
                new() { SourceNodeId = getCandidateData.Id, TargetNodeId = retryWait.Id, Label = "Error Encountered" },
                new() { SourceNodeId = getCandidateData.Id, TargetNodeId = retryWait.Id, Label = "UnSuccessful" },
                new() { SourceNodeId = retryWait.Id, TargetNodeId = getCandidateData.Id, Label = "TimeOutWarning1" },
                new() { SourceNodeId = prepScript.Id, TargetNodeId = retryWait.Id, Label = "0" },
                new() { SourceNodeId = prepScript.Id, TargetNodeId = interviewTask.Id, Label = "1" },
                new() { SourceNodeId = interviewTask.Id, TargetNodeId = updateVar.Id, Label = "Approved" },
                new() { SourceNodeId = interviewTask.Id, TargetNodeId = suitableNotice.Id, Label = "Suitable" },
                new() { SourceNodeId = interviewTask.Id, TargetNodeId = updateStatus.Id, Label = "Timeout - Action" },
                new() { SourceNodeId = updateVar.Id, TargetNodeId = rule.Id, Label = "Updated" },
                new() { SourceNodeId = rule.Id, TargetNodeId = suitableNotice.Id, Label = "True" },
                new() { SourceNodeId = rule.Id, TargetNodeId = notSuitableNotice.Id, Label = "False" },
                new() { SourceNodeId = updateStatus.Id, TargetNodeId = timeoutNotice.Id, Label = "Successful" },
                new() { SourceNodeId = suitableNotice.Id, TargetNodeId = end1.Id, Label = "Default" },
                new() { SourceNodeId = notSuitableNotice.Id, TargetNodeId = end2.Id, Label = "Default" },
                new() { SourceNodeId = timeoutNotice.Id, TargetNodeId = end3.Id, Label = "Default" },
            }
        };
    }

    /// <summary>
    /// Recreated from the uploaded Skelta export "RepIntranetStg_AmbitiousTransferWF_2.xml".
    /// Same mapping convention as BuildCandidatesRequestFromSkelta. This flow chains several
    /// Web-API-lookup -> Script -> Task triples (each "look up who the approver is, then ask
    /// them") which is exactly what my engine's Assignee field would normally do directly
    /// (pick a role/user) - here they're kept as separate WebhookCall/Automation nodes to
    /// stay structurally faithful to the original export; once you're ready you can likely
    /// delete each Get*/Script pair and just set the following Task's Assignee directly.
    /// </summary>
    private static WorkflowDefinition BuildAmbitiousTransferFromSkelta()
    {
        var start = new WorkflowNode { Type = NodeType.Start, Name = "Start", X = 40, Y = 500 };

        var getNewManager = new WorkflowNode { Type = NodeType.WebhookCall, Name = "GetNewManager", X = 260, Y = 500, WebhookMethod = "GET", WebhookUrl = "http://localhost:5000/api/demo/lookup/new-manager", DefaultOutcome = "Successful" };
        var waitNewManager = new WorkflowNode { Type = NodeType.Timer, Name = "Time Trigger3", X = 260, Y = 680, DurationSeconds = 300, DefaultOutcome = "TimeOutWarningNewManager" };
        var scriptNewManager = new WorkflowNode { Type = NodeType.Automation, Name = "Script3", X = 480, Y = 500, AutomationAction = "script.run", DefaultOutcome = "1" };
        var newManagerApproval = new WorkflowNode
        {
            Type = NodeType.ApprovalTask, Name = "New Manager Approval", X = 700, Y = 500, Assignee = "new-manager", Priority = "High",
            EscalateAfterMinutes = 1440, EscalateTo = "senior-manager",
            Form = new FormDefinition { Title = "New Manager Approval", Fields = new List<FormField> {
                new() { Key = "employeeName", Label = "Employee Name", Type = FormFieldType.Text, Required = true },
                new() { Key = "newDept", Label = "New Department", Type = FormFieldType.Text, Required = true },
                new() { Key = "comment", Label = "Comment", Type = FormFieldType.TextArea } } }
        };
        var waitClose = new WorkflowNode { Type = NodeType.Timer, Name = "Time Trigger4", X = 700, Y = 680, DurationSeconds = 300, DefaultOutcome = "Default" };
        var closeRequest = new WorkflowNode { Type = NodeType.WebhookCall, Name = "CloseRequest", X = 700, Y = 840, WebhookMethod = "POST", WebhookUrl = "http://localhost:5000/api/demo/action/close-request", DefaultOutcome = "Default" };
        var canceledNotice = new WorkflowNode { Type = NodeType.Email, Name = "Information3 (Canceled)", X = 920, Y = 680, EmailSubject = "Transfer request canceled", EmailBody = "{{employeeName}}'s transfer request was canceled." };

        var getSecretaryMembers = new WorkflowNode { Type = NodeType.WebhookCall, Name = "GetSecretaryMembers", X = 920, Y = 500, WebhookMethod = "GET", WebhookUrl = "http://localhost:5000/api/demo/lookup/secretary", DefaultOutcome = "Successful" };
        var waitSecretary = new WorkflowNode { Type = NodeType.Timer, Name = "Time Trigger5", X = 920, Y = 320, DurationSeconds = 300, DefaultOutcome = "TimeOutWarningSecretary" };
        var scriptSecretary = new WorkflowNode { Type = NodeType.Automation, Name = "Script4", X = 1140, Y = 500, AutomationAction = "script.run", DefaultOutcome = "1" };
        var secretaryApproval = new WorkflowNode
        {
            Type = NodeType.ApprovalTask, Name = "Secretary Approval", X = 1360, Y = 500, Assignee = "secretary", Priority = "Normal",
            Form = new FormDefinition { Title = "Secretary Approval", Fields = new List<FormField> { new() { Key = "comment", Label = "Comment", Type = FormFieldType.TextArea } } }
        };

        var getAmbitiousMembers = new WorkflowNode { Type = NodeType.WebhookCall, Name = "GetAmbitiousMembers", X = 1580, Y = 500, WebhookMethod = "GET", WebhookUrl = "http://localhost:5000/api/demo/lookup/ambitious", DefaultOutcome = "Successful" };
        var waitMembers = new WorkflowNode { Type = NodeType.Timer, Name = "Time Trigger1", X = 1580, Y = 320, DurationSeconds = 300, DefaultOutcome = "TimeOutWarningMembers" };
        var scriptMembers = new WorkflowNode { Type = NodeType.Automation, Name = "Script1", X = 1800, Y = 500, AutomationAction = "script.run", DefaultOutcome = "1" };
        var ambitiousCommitteeFirst = new WorkflowNode
        {
            Type = NodeType.ApprovalTask, Name = "Ambitious Committee Review", X = 2020, Y = 500, Assignee = "ambitious-committee", Priority = "High",
            Form = new FormDefinition { Title = "Committee Review", Fields = new List<FormField> { new() { Key = "comment", Label = "Comment", Type = FormFieldType.TextArea } } }
        };

        var updateVar1 = new WorkflowNode { Type = NodeType.Automation, Name = "Update Variable1", X = 2240, Y = 400, AutomationAction = "variable.set", DefaultOutcome = "Updated" };
        var updateVar2 = new WorkflowNode { Type = NodeType.Automation, Name = "Update Variable2", X = 2240, Y = 600, AutomationAction = "variable.set", DefaultOutcome = "Updated" };
        var decision = new WorkflowNode { Type = NodeType.Condition, Name = "Decision1", X = 2460, Y = 500, ConditionExpression = "committeeOutcome == Approved" };

        var getOldManager = new WorkflowNode { Type = NodeType.WebhookCall, Name = "GetOldManager", X = 2680, Y = 680, WebhookMethod = "GET", WebhookUrl = "http://localhost:5000/api/demo/lookup/old-manager", DefaultOutcome = "Successful" };
        var waitOldManager = new WorkflowNode { Type = NodeType.Timer, Name = "Time Trigger2", X = 2680, Y = 860, DurationSeconds = 300, DefaultOutcome = "TimeOutWarningManager" };
        var scriptOldManager = new WorkflowNode { Type = NodeType.Automation, Name = "Script2", X = 2900, Y = 680, AutomationAction = "script.run", DefaultOutcome = "1" };
        var oldManagerApproval = new WorkflowNode
        {
            Type = NodeType.ApprovalTask, Name = "Old Manager Approval", X = 3120, Y = 680, Assignee = "manager", Priority = "High",
            Form = new FormDefinition { Title = "Old Manager Approval", Fields = new List<FormField> { new() { Key = "comment", Label = "Comment", Type = FormFieldType.TextArea } } }
        };

        var getCommitteeManager = new WorkflowNode { Type = NodeType.WebhookCall, Name = "GetCommitteeManager", X = 2680, Y = 260, WebhookMethod = "GET", WebhookUrl = "http://localhost:5000/api/demo/lookup/committee-manager", DefaultOutcome = "Successful" };
        var waitCommitteeManager = new WorkflowNode { Type = NodeType.Timer, Name = "Time Trigger6", X = 2680, Y = 80, DurationSeconds = 300, DefaultOutcome = "TimeOutWarningCommitteeManager" };
        var scriptCommitteeManager = new WorkflowNode { Type = NodeType.Automation, Name = "Script5", X = 2900, Y = 260, AutomationAction = "script.run", DefaultOutcome = "1" };
        var committeeManagerApproval = new WorkflowNode
        {
            Type = NodeType.ApprovalTask, Name = "Committee Manager Approval", X = 3120, Y = 260, Assignee = "committee-manager", Priority = "High",
            Form = new FormDefinition { Title = "Committee Manager Approval", Fields = new List<FormField> { new() { Key = "comment", Label = "Comment", Type = FormFieldType.TextArea } } }
        };
        var rejectedNotice2 = new WorkflowNode { Type = NodeType.Email, Name = "Information2 (Rejected)", X = 3340, Y = 100, EmailSubject = "Transfer rejected", EmailBody = "The committee manager rejected the transfer." };

        var getCommitteeManagerLast = new WorkflowNode { Type = NodeType.WebhookCall, Name = "GetCommitteeManagerLast", X = 3340, Y = 500, WebhookMethod = "GET", WebhookUrl = "http://localhost:5000/api/demo/lookup/committee-manager-final", DefaultOutcome = "Successful" };
        var waitCommitteeManagerLast = new WorkflowNode { Type = NodeType.Timer, Name = "Time Trigger7", X = 3340, Y = 320, DurationSeconds = 300, DefaultOutcome = "TimeOutWarningCommitteeManagerLast" };
        var scriptCommitteeManagerLast = new WorkflowNode { Type = NodeType.Automation, Name = "Script6", X = 3560, Y = 500, AutomationAction = "script.run", DefaultOutcome = "1" };
        var committeeManagerLastApproval = new WorkflowNode
        {
            Type = NodeType.ApprovalTask, Name = "Committee Manager Final Approval", X = 3780, Y = 500, Assignee = "committee-manager", Priority = "Urgent",
            Form = new FormDefinition { Title = "Final Approval", Fields = new List<FormField> { new() { Key = "comment", Label = "Comment", Type = FormFieldType.TextArea } } }
        };

        var finalUpdateNotice = new WorkflowNode { Type = NodeType.Email, Name = "Information5 (Update Complete)", X = 4000, Y = 400, EmailSubject = "Transfer approved", EmailBody = "The employee transfer has been fully approved and finalized." };
        var rejectedFinalNotice = new WorkflowNode { Type = NodeType.Email, Name = "Request Rejected", X = 4000, Y = 600, EmailSubject = "Transfer rejected", EmailBody = "The transfer request was rejected." };

        var endApproved = new WorkflowNode { Type = NodeType.End, Name = "End", X = 4220, Y = 400 };
        var endRejected = new WorkflowNode { Type = NodeType.End, Name = "End", X = 4220, Y = 600 };
        var endCanceled = new WorkflowNode { Type = NodeType.End, Name = "End", X = 1140, Y = 680 };
        var endRejected2 = new WorkflowNode { Type = NodeType.End, Name = "End", X = 3340, Y = 100 };

        return new WorkflowDefinition
        {
            Name = "Ambitious Transfer (from Skelta)",
            Description = "Recreated from a Skelta export: an employee's committee-nominated transfer runs through Secretary, Committee, Old Manager, New Manager and Committee Manager approvals (each preceded by a Web-API lookup of who the approver is), before a final Committee Manager sign-off.",
            IsPublished = true,
            Nodes = new() {
                start, getNewManager, waitNewManager, scriptNewManager, newManagerApproval, waitClose, closeRequest, canceledNotice,
                getSecretaryMembers, waitSecretary, scriptSecretary, secretaryApproval,
                getAmbitiousMembers, waitMembers, scriptMembers, ambitiousCommitteeFirst,
                updateVar1, updateVar2, decision,
                getOldManager, waitOldManager, scriptOldManager, oldManagerApproval,
                getCommitteeManager, waitCommitteeManager, scriptCommitteeManager, committeeManagerApproval, rejectedNotice2,
                getCommitteeManagerLast, waitCommitteeManagerLast, scriptCommitteeManagerLast, committeeManagerLastApproval,
                finalUpdateNotice, rejectedFinalNotice, endApproved, endRejected, endCanceled, endRejected2
            },
            Edges = new()
            {
                new() { SourceNodeId = start.Id, TargetNodeId = getNewManager.Id, Label = "Default" },
                new() { SourceNodeId = getNewManager.Id, TargetNodeId = scriptNewManager.Id, Label = "Successful" },
                new() { SourceNodeId = getNewManager.Id, TargetNodeId = waitNewManager.Id, Label = "Error Encountered" },
                new() { SourceNodeId = getNewManager.Id, TargetNodeId = waitNewManager.Id, Label = "UnSuccessful" },
                new() { SourceNodeId = waitNewManager.Id, TargetNodeId = getNewManager.Id, Label = "TimeOutWarningNewManager" },
                new() { SourceNodeId = scriptNewManager.Id, TargetNodeId = waitNewManager.Id, Label = "0" },
                new() { SourceNodeId = scriptNewManager.Id, TargetNodeId = newManagerApproval.Id, Label = "1" },
                new() { SourceNodeId = newManagerApproval.Id, TargetNodeId = getSecretaryMembers.Id, Label = "Approved" },
                new() { SourceNodeId = newManagerApproval.Id, TargetNodeId = endRejected.Id, Label = "Rejected" },
                new() { SourceNodeId = newManagerApproval.Id, TargetNodeId = waitClose.Id, Label = "Timeout Warning - Action" },
                new() { SourceNodeId = newManagerApproval.Id, TargetNodeId = canceledNotice.Id, Label = "Canceled" },
                new() { SourceNodeId = waitClose.Id, TargetNodeId = closeRequest.Id, Label = "Default" },
                new() { SourceNodeId = closeRequest.Id, TargetNodeId = endCanceled.Id, Label = "Default" },
                new() { SourceNodeId = canceledNotice.Id, TargetNodeId = endCanceled.Id, Label = "Default" },

                new() { SourceNodeId = getSecretaryMembers.Id, TargetNodeId = scriptSecretary.Id, Label = "Successful" },
                new() { SourceNodeId = getSecretaryMembers.Id, TargetNodeId = waitSecretary.Id, Label = "Error Encountered" },
                new() { SourceNodeId = getSecretaryMembers.Id, TargetNodeId = waitSecretary.Id, Label = "UnSuccessful" },
                new() { SourceNodeId = waitSecretary.Id, TargetNodeId = getSecretaryMembers.Id, Label = "TimeOutWarningSecretary" },
                new() { SourceNodeId = scriptSecretary.Id, TargetNodeId = secretaryApproval.Id, Label = "1" },
                new() { SourceNodeId = secretaryApproval.Id, TargetNodeId = getAmbitiousMembers.Id, Label = "Approved" },

                new() { SourceNodeId = getAmbitiousMembers.Id, TargetNodeId = scriptMembers.Id, Label = "Successful" },
                new() { SourceNodeId = getAmbitiousMembers.Id, TargetNodeId = waitMembers.Id, Label = "Error Encountered" },
                new() { SourceNodeId = getAmbitiousMembers.Id, TargetNodeId = waitMembers.Id, Label = "UnSuccessful" },
                new() { SourceNodeId = waitMembers.Id, TargetNodeId = getAmbitiousMembers.Id, Label = "TimeOutWarningMembers" },
                new() { SourceNodeId = scriptMembers.Id, TargetNodeId = ambitiousCommitteeFirst.Id, Label = "1" },
                new() { SourceNodeId = ambitiousCommitteeFirst.Id, TargetNodeId = updateVar1.Id, Label = "Approved" },
                new() { SourceNodeId = ambitiousCommitteeFirst.Id, TargetNodeId = updateVar2.Id, Label = "Rejected" },
                new() { SourceNodeId = updateVar1.Id, TargetNodeId = decision.Id, Label = "Updated" },
                new() { SourceNodeId = updateVar2.Id, TargetNodeId = decision.Id, Label = "Updated" },
                new() { SourceNodeId = decision.Id, TargetNodeId = getOldManager.Id, Label = "True" },
                new() { SourceNodeId = decision.Id, TargetNodeId = getCommitteeManager.Id, Label = "False" },

                new() { SourceNodeId = getOldManager.Id, TargetNodeId = scriptOldManager.Id, Label = "Successful" },
                new() { SourceNodeId = getOldManager.Id, TargetNodeId = waitOldManager.Id, Label = "Error Encountered" },
                new() { SourceNodeId = getOldManager.Id, TargetNodeId = waitOldManager.Id, Label = "UnSuccessful" },
                new() { SourceNodeId = waitOldManager.Id, TargetNodeId = getOldManager.Id, Label = "TimeOutWarningManager" },
                new() { SourceNodeId = scriptOldManager.Id, TargetNodeId = oldManagerApproval.Id, Label = "1" },
                new() { SourceNodeId = oldManagerApproval.Id, TargetNodeId = getCommitteeManagerLast.Id, Label = "Approved" },

                new() { SourceNodeId = getCommitteeManager.Id, TargetNodeId = scriptCommitteeManager.Id, Label = "Successful" },
                new() { SourceNodeId = getCommitteeManager.Id, TargetNodeId = waitCommitteeManager.Id, Label = "Error Encountered" },
                new() { SourceNodeId = getCommitteeManager.Id, TargetNodeId = waitCommitteeManager.Id, Label = "UnSuccessful" },
                new() { SourceNodeId = waitCommitteeManager.Id, TargetNodeId = getCommitteeManager.Id, Label = "TimeOutWarningCommitteeManager" },
                new() { SourceNodeId = scriptCommitteeManager.Id, TargetNodeId = committeeManagerApproval.Id, Label = "1" },
                new() { SourceNodeId = committeeManagerApproval.Id, TargetNodeId = getOldManager.Id, Label = "Approved" },
                new() { SourceNodeId = committeeManagerApproval.Id, TargetNodeId = rejectedNotice2.Id, Label = "Rejected" },
                new() { SourceNodeId = rejectedNotice2.Id, TargetNodeId = endRejected2.Id, Label = "Default" },

                new() { SourceNodeId = getCommitteeManagerLast.Id, TargetNodeId = scriptCommitteeManagerLast.Id, Label = "Successful" },
                new() { SourceNodeId = getCommitteeManagerLast.Id, TargetNodeId = waitCommitteeManagerLast.Id, Label = "Error Encountered" },
                new() { SourceNodeId = getCommitteeManagerLast.Id, TargetNodeId = waitCommitteeManagerLast.Id, Label = "UnSuccessful" },
                new() { SourceNodeId = waitCommitteeManagerLast.Id, TargetNodeId = getCommitteeManagerLast.Id, Label = "TimeOutWarningCommitteeManagerLast" },
                new() { SourceNodeId = scriptCommitteeManagerLast.Id, TargetNodeId = committeeManagerLastApproval.Id, Label = "1" },
                new() { SourceNodeId = committeeManagerLastApproval.Id, TargetNodeId = finalUpdateNotice.Id, Label = "UpdateComplate" },
                new() { SourceNodeId = committeeManagerLastApproval.Id, TargetNodeId = rejectedFinalNotice.Id, Label = "Rejected" },
                new() { SourceNodeId = finalUpdateNotice.Id, TargetNodeId = endApproved.Id, Label = "Default" },
                new() { SourceNodeId = rejectedFinalNotice.Id, TargetNodeId = endRejected.Id, Label = "Default" },
            }
        };
    }
}
