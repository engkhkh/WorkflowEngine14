using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Services;

/// <summary>
/// ERP business-process templates (Unicorn-ERP style "one connected flow" instead of
/// Request -> Excel -> Email -> Approval -> Excel -> Finance).
///
/// Every template here starts straight from a Start node with NO requester FormTask: the ERP
/// portal / mobile app collect the business document (header + line items + totals) with
/// their own native forms and pass it as the instance's initialData. That means anyone, in
/// any role, can raise a document, and every later step (approval, PO, goods receipt,
/// invoice, payment, GL posting) reads and enriches the SAME instance data bag.
///
/// Node NAMES matter: the portal/mobile apps map them to ERP stages
/// (Request -> Approval -> Purchase -> Inventory -> Accounting -> Reporting) - see
/// portal-app/src/app/core/erp.config.ts. Rename a node here and update that file too.
///
/// Idempotent by name like SeedData.SeedWorkflows, and needs NO migration - definitions are
/// plain rows with JSON columns, exactly like the existing templates.
/// </summary>
public static class ErpSeedData
{
    public const string ProcureToPay = "ERP · Purchase Requisition (Procure-to-Pay)";
    public const string OrderToCash = "ERP · Sales Order (Order-to-Cash)";
    public const string ExpenseClaim = "ERP · Expense Claim";
    public const string StockTransfer = "ERP · Stock Transfer";
    public const string PaymentVoucher = "ERP · Payment Voucher";

    /// <summary>Privilege needed to raise each ERP document (checked in WorkflowInstancesController.Start).</summary>
    public static string? CreatePermissionFor(string definitionName) => definitionName switch
    {
        ProcureToPay => "purchasing.create",
        OrderToCash => "sales.create",
        StockTransfer => "inventory.create",
        PaymentVoucher or ExpenseClaim => "finance.create",
        _ => null
    };

    public static async Task SeedErpWorkflows(WorkflowDbContext db)
    {
        var builders = new (string Name, Func<WorkflowDefinition> Build)[]
        {
            (ProcureToPay, BuildProcureToPay),
            (OrderToCash, BuildOrderToCash),
            (ExpenseClaim, BuildExpenseClaim),
            (StockTransfer, BuildStockTransfer),
            (PaymentVoucher, BuildPaymentVoucher),
        };

        foreach (var (name, build) in builders)
        {
            if (await db.Definitions.AnyAsync(d => d.Name == name)) continue;
            db.Definitions.Add(build());
        }

        await db.SaveChangesAsync();
    }

    // ---------- shared helpers ----------

    private static List<FormField> DocSummaryFields() => new()
    {
        new() { Key = "docNumber", Label = "Document No.", Type = FormFieldType.Text, ReadOnly = true },
        new() { Key = "party", Label = "Party", Type = FormFieldType.Text, ReadOnly = true },
        new() { Key = "total", Label = "Total (incl. VAT)", Type = FormFieldType.Number, ReadOnly = true },
        new() { Key = "currency", Label = "Currency", Type = FormFieldType.Text, ReadOnly = true },
        new() { Key = "branch", Label = "Branch", Type = FormFieldType.Text, ReadOnly = true },
    };

    private static WorkflowNode Step(string name, string assignee, double x, double y, string priority = "Normal",
        IEnumerable<FormField>? extraFields = null, string? description = null, int? escalateMinutes = 1440, string? escalateTo = "senior-manager")
    {
        var fields = DocSummaryFields();
        if (extraFields != null) fields.AddRange(extraFields);
        return new WorkflowNode
        {
            Type = NodeType.ApprovalTask,
            Name = name,
            X = x,
            Y = y,
            Assignee = assignee,
            Priority = priority,
            Description = description,
            EscalateAfterMinutes = escalateMinutes,
            EscalateTo = escalateTo,
            EscalationMode = escalateMinutes.HasValue ? "Notify" : null,
            UseBusinessHours = escalateMinutes.HasValue,
            Form = new FormDefinition { Title = name, Fields = fields }
        };
    }

    private static WorkflowNode Gl(string message, double x, double y) => new()
    {
        Type = NodeType.Logger,
        Name = "Post to General Ledger",
        X = x,
        Y = y,
        LogMessage = message
    };

    private static WorkflowEdge E(WorkflowNode a, WorkflowNode b, string label = "Default")
        => new() { SourceNodeId = a.Id, TargetNodeId = b.Id, Label = label };

    private static FormFieldOption O(string v) => new() { Label = v, Value = v };

    // ---------- Procure-to-Pay ----------
    // Request -> Manager -> (high value? Senior Manager) -> Procurement issues PO ->
    // Stores goods receipt -> Finance invoice + payment -> GL posting -> Completed
    private static WorkflowDefinition BuildProcureToPay()
    {
        var start = new WorkflowNode { Type = NodeType.Start, Name = "Start", X = 40, Y = 240 };
        var manager = Step("Manager Approval", "manager", 220, 240, "High",
            new[] { new FormField { Key = "managerComment", Label = "Manager Comment", Type = FormFieldType.TextArea } },
            "Check the business need and budget for this purchase requisition.");
        var highValue = new WorkflowNode { Type = NodeType.Condition, Name = "High Value?", X = 420, Y = 240, ConditionExpression = "total > 50000" };
        var senior = Step("Senior Manager Approval", "senior-manager", 420, 80, "High",
            new[] { new FormField { Key = "seniorComment", Label = "Senior Manager Comment", Type = FormFieldType.TextArea } },
            "Requisitions above 50,000 need senior sign-off.", 1440, "admin");
        var po = Step("Issue Purchase Order", "procurement", 620, 240, "Normal", new[]
        {
            new FormField { Key = "poNumber", Label = "PO Number", Type = FormFieldType.Text, Required = true },
            new FormField { Key = "vendor", Label = "Vendor", Type = FormFieldType.Text, Required = true },
            new FormField { Key = "expectedDelivery", Label = "Expected Delivery", Type = FormFieldType.Date },
        }, "Select the vendor and issue the purchase order.");
        var grn = Step("Goods Receipt", "admin-stores", 820, 240, "Normal", new[]
        {
            new FormField { Key = "grnNumber", Label = "GRN Number", Type = FormFieldType.Text, Required = true },
            new FormField { Key = "warehouse", Label = "Warehouse", Type = FormFieldType.Text, ReadOnly = true },
            new FormField { Key = "receiptNotes", Label = "Receipt Notes (qty / condition)", Type = FormFieldType.TextArea },
        }, "Receive the goods into the warehouse and record the GRN.", 2880, "admin");
        var pay = Step("Vendor Invoice & Payment", "finance", 1020, 240, "Normal", new[]
        {
            new FormField { Key = "invoiceNumber", Label = "Vendor Invoice No.", Type = FormFieldType.Text, Required = true },
            new FormField { Key = "paymentMethod", Label = "Payment Method", Type = FormFieldType.Select, Required = true,
                Options = new() { O("Bank Transfer"), O("Cheque"), O("Cash") } },
            new FormField { Key = "paymentDate", Label = "Payment Date", Type = FormFieldType.Date },
        }, "Match PO + GRN + invoice (3-way match), then pay the vendor.", 2880, "admin");
        var gl = Gl("GL posted for {{docNumber}}: Dr Inventory/Expense {{total}} {{currency}} / Cr Accounts Payable -> Cr Bank (PO {{poNumber}}, GRN {{grnNumber}}, INV {{invoiceNumber}})", 1220, 240);
        var done = new WorkflowNode { Type = NodeType.End, Name = "Completed", X = 1400, Y = 240 };
        var rejected = new WorkflowNode { Type = NodeType.End, Name = "Rejected", X = 620, Y = 440 };

        return new WorkflowDefinition
        {
            Name = ProcureToPay,
            Description = "Purchasing: requisition -> approval (senior above 50k) -> purchase order -> goods receipt -> invoice & payment -> GL. One connected document from request to accounting.",
            IsPublished = true,
            Nodes = new() { start, manager, highValue, senior, po, grn, pay, gl, done, rejected },
            Edges = new()
            {
                E(start, manager),
                E(manager, highValue, "Approve"), E(manager, rejected, "Reject"),
                E(highValue, senior, "True"), E(highValue, po, "False"),
                E(senior, po, "Approve"), E(senior, rejected, "Reject"),
                E(po, grn, "PO Issued"), E(po, rejected, "Reject"),
                E(grn, pay, "Received"), E(grn, rejected, "Return to Vendor"),
                E(pay, gl, "Paid"), E(pay, rejected, "Reject"),
                E(gl, done),
            }
        };
    }

    // ---------- Order-to-Cash ----------
    // Order -> (discount > 10%? Sales Manager) -> Finance credit check -> Stores delivery ->
    // Finance invoice & collection -> GL posting -> Completed
    private static WorkflowDefinition BuildOrderToCash()
    {
        var start = new WorkflowNode { Type = NodeType.Start, Name = "Start", X = 40, Y = 240 };
        var discount = new WorkflowNode { Type = NodeType.Condition, Name = "Discount Above Limit?", X = 220, Y = 240, ConditionExpression = "discountPct > 10" };
        var salesMgr = Step("Sales Manager Approval", "manager", 220, 80, "High",
            new[] { new FormField { Key = "discountPct", Label = "Discount %", Type = FormFieldType.Number, ReadOnly = true },
                    new FormField { Key = "salesManagerComment", Label = "Comment", Type = FormFieldType.TextArea } },
            "Discount exceeds the 10% limit - approve or reject the price.");
        var credit = Step("Credit Check", "finance", 420, 240, "High",
            new[] { new FormField { Key = "creditLimitOk", Label = "Within customer credit limit", Type = FormFieldType.Checkbox } },
            "Verify the customer's credit limit and outstanding receivables.");
        var deliver = Step("Deliver Goods", "admin-stores", 620, 240, "Normal", new[]
        {
            new FormField { Key = "deliveryNote", Label = "Delivery Note No.", Type = FormFieldType.Text, Required = true },
            new FormField { Key = "warehouse", Label = "Warehouse", Type = FormFieldType.Text, ReadOnly = true },
        }, "Pick, pack and deliver; stock is reduced from the selected warehouse.", 2880, "admin");
        var invoice = Step("Invoice & Collect Payment", "finance", 820, 240, "Normal", new[]
        {
            new FormField { Key = "salesInvoiceNumber", Label = "Sales Invoice No.", Type = FormFieldType.Text, Required = true },
            new FormField { Key = "receiptMethod", Label = "Receipt Method", Type = FormFieldType.Select,
                Options = new() { O("Bank Transfer"), O("Cash"), O("Card"), O("Credit (30 days)") } },
        }, "Issue the tax invoice and record the customer receipt.", 4320, "admin");
        var gl = Gl("GL posted for {{docNumber}}: Dr Accounts Receivable/Bank {{total}} {{currency}} / Cr Sales Revenue + Cr VAT Output (INV {{salesInvoiceNumber}})", 1020, 240);
        var done = new WorkflowNode { Type = NodeType.End, Name = "Completed", X = 1200, Y = 240 };
        var rejected = new WorkflowNode { Type = NodeType.End, Name = "Rejected", X = 520, Y = 440 };

        return new WorkflowDefinition
        {
            Name = OrderToCash,
            Description = "Sales: order -> discount approval (above 10%) -> credit check -> delivery -> invoice & collection -> GL.",
            IsPublished = true,
            Nodes = new() { start, discount, salesMgr, credit, deliver, invoice, gl, done, rejected },
            Edges = new()
            {
                E(start, discount),
                E(discount, salesMgr, "True"), E(discount, credit, "False"),
                E(salesMgr, credit, "Approve"), E(salesMgr, rejected, "Reject"),
                E(credit, deliver, "Approve Credit"), E(credit, rejected, "Reject"),
                E(deliver, invoice, "Delivered"), E(deliver, rejected, "Out of Stock"),
                E(invoice, gl, "Collected"),
                E(gl, done),
            }
        };
    }

    // ---------- Expense Claim ----------
    private static WorkflowDefinition BuildExpenseClaim()
    {
        var start = new WorkflowNode { Type = NodeType.Start, Name = "Start", X = 40, Y = 200 };
        var manager = Step("Manager Approval", "manager", 240, 200, "Normal",
            new[] { new FormField { Key = "managerComment", Label = "Manager Comment", Type = FormFieldType.TextArea } },
            "Confirm the expenses are business-related and within policy.");
        var pay = Step("Finance Review & Payment", "finance", 460, 200, "Normal", new[]
        {
            new FormField { Key = "paymentMethod", Label = "Payment Method", Type = FormFieldType.Select, Required = true,
                Options = new() { O("Payroll"), O("Bank Transfer"), O("Cash") } },
        }, "Check receipts, then reimburse the employee.", 2880, "admin");
        var gl = Gl("GL posted for {{docNumber}}: Dr Expenses {{total}} {{currency}} / Cr Bank ({{paymentMethod}})", 680, 200);
        var done = new WorkflowNode { Type = NodeType.End, Name = "Completed", X = 860, Y = 200 };
        var rejected = new WorkflowNode { Type = NodeType.End, Name = "Rejected", X = 460, Y = 380 };

        return new WorkflowDefinition
        {
            Name = ExpenseClaim,
            Description = "Finance: employee expense claim -> manager approval -> finance reimbursement -> GL.",
            IsPublished = true,
            Nodes = new() { start, manager, pay, gl, done, rejected },
            Edges = new()
            {
                E(start, manager),
                E(manager, pay, "Approve"), E(manager, rejected, "Reject"),
                E(pay, gl, "Pay"), E(pay, rejected, "Reject"),
                E(gl, done),
            }
        };
    }

    // ---------- Stock Transfer ----------
    private static WorkflowDefinition BuildStockTransfer()
    {
        var start = new WorkflowNode { Type = NodeType.Start, Name = "Start", X = 40, Y = 220 };
        var wh = Step("Warehouse Approval", "admin-stores", 240, 220, "Normal",
            new[] { new FormField { Key = "warehouse", Label = "From Warehouse", Type = FormFieldType.Text, ReadOnly = true },
                    new FormField { Key = "toWarehouse", Label = "To Warehouse", Type = FormFieldType.Text, ReadOnly = true } },
            "Confirm stock is available for transfer.");
        var highValue = new WorkflowNode { Type = NodeType.Condition, Name = "High Value?", X = 440, Y = 220, ConditionExpression = "total > 20000" };
        var fin = Step("Finance Approval", "finance", 440, 60, "Normal", null, "High-value stock movement - finance confirms the valuation.");
        var dispatch = Step("Dispatch & Receive", "admin-stores", 640, 220, "Normal", new[]
        {
            new FormField { Key = "transferNote", Label = "Transfer Note No.", Type = FormFieldType.Text, Required = true },
        }, "Dispatch from the source warehouse and confirm receipt at the destination.", 2880, "admin");
        var gl = Gl("Inventory moved for {{docNumber}}: {{warehouse}} -> {{toWarehouse}}, value {{total}} {{currency}}", 840, 220);
        var done = new WorkflowNode { Type = NodeType.End, Name = "Completed", X = 1020, Y = 220 };
        var rejected = new WorkflowNode { Type = NodeType.End, Name = "Rejected", X = 440, Y = 400 };

        return new WorkflowDefinition
        {
            Name = StockTransfer,
            Description = "Inventory: transfer stock between warehouses/branches -> warehouse approval -> finance (above 20k) -> dispatch & receive.",
            IsPublished = true,
            Nodes = new() { start, wh, highValue, fin, dispatch, gl, done, rejected },
            Edges = new()
            {
                E(start, wh),
                E(wh, highValue, "Approve"), E(wh, rejected, "Reject"),
                E(highValue, fin, "True"), E(highValue, dispatch, "False"),
                E(fin, dispatch, "Approve"), E(fin, rejected, "Reject"),
                E(dispatch, gl, "Completed"),
                E(gl, done),
            }
        };
    }

    // ---------- Payment Voucher ----------
    private static WorkflowDefinition BuildPaymentVoucher()
    {
        var start = new WorkflowNode { Type = NodeType.Start, Name = "Start", X = 40, Y = 220 };
        var manager = Step("Manager Approval", "manager", 240, 220, "High",
            new[] { new FormField { Key = "managerComment", Label = "Manager Comment", Type = FormFieldType.TextArea } },
            "Approve the payment to the supplier / payee.");
        var highValue = new WorkflowNode { Type = NodeType.Condition, Name = "High Value?", X = 440, Y = 220, ConditionExpression = "total > 100000" };
        var senior = Step("Senior Manager Approval", "senior-manager", 440, 60, "Urgent", null, "Payments above 100,000 need senior sign-off.", 1440, "admin");
        var pay = Step("Finance Payment", "finance", 640, 220, "High", new[]
        {
            new FormField { Key = "paymentMethod", Label = "Payment Method", Type = FormFieldType.Select, Required = true,
                Options = new() { O("Bank Transfer"), O("Cheque"), O("Cash") } },
            new FormField { Key = "bankReference", Label = "Bank Reference", Type = FormFieldType.Text },
        }, "Release the payment and record the bank reference.", 2880, "admin");
        var gl = Gl("GL posted for {{docNumber}}: Dr Accounts Payable {{total}} {{currency}} / Cr Bank (ref {{bankReference}})", 840, 220);
        var done = new WorkflowNode { Type = NodeType.End, Name = "Completed", X = 1020, Y = 220 };
        var rejected = new WorkflowNode { Type = NodeType.End, Name = "Rejected", X = 440, Y = 400 };

        return new WorkflowDefinition
        {
            Name = PaymentVoucher,
            Description = "Finance: payment voucher -> manager -> senior manager (above 100k) -> finance releases payment -> GL.",
            IsPublished = true,
            Nodes = new() { start, manager, highValue, senior, pay, gl, done, rejected },
            Edges = new()
            {
                E(start, manager),
                E(manager, highValue, "Approve"), E(manager, rejected, "Reject"),
                E(highValue, senior, "True"), E(highValue, pay, "False"),
                E(senior, pay, "Approve"), E(senior, rejected, "Reject"),
                E(pay, gl, "Paid"), E(pay, rejected, "Reject"),
                E(gl, done),
            }
        };
    }
}
