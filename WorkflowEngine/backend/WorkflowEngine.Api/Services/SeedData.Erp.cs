using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Services;

/// <summary>
/// ERP business-process templates. Each one is an end-to-end flow where every step writes to
/// the same instance data, so the portal/mobile ERP views (dashboard KPIs, module workspaces,
/// reports, assistant) are all computed from one connected record:
///
///   Purchase Requisition (Procure-to-Pay): Request -> Manager -> (Dept head if > 10,000) ->
///       Procurement raises PO -> Warehouse goods receipt -> Finance pays vendor -> GL posting
///   Sales Order (Order-to-Cash): Order entry -> (Sales manager if discount > 10%) ->
///       Warehouse pick &amp; ship -> Finance invoice &amp; collection -> GL posting
///   Stock Transfer: Request -> Stores approval -> Warehouse dispatch/receive -> inventory journal
///   Expense Claim: Claim -> Manager -> (Finance if > 5,000) -> Reimbursement -> GL posting
///   Vendor Registration: Registration -> Procurement review -> Finance verification -> vendor master
///
/// Field keys are deliberately shared across templates (amount, currency, company, branch,
/// item, customer/vendor) - the ERP layer in the apps reads them to build documents and KPIs.
/// The first step is assigned to "{{initiator}}" so whoever starts the request fills it in.
/// Node names follow the stage keywords the apps use (Submit / Approval / Purchase Order /
/// Goods Receipt / Invoice / Payment / Journal) to place each document on the ERP lifecycle.
/// </summary>
public static partial class SeedData
{
    internal const string ErpPurchaseRequisitionName = "Purchase Requisition (Procure-to-Pay)";
    internal const string ErpSalesOrderName = "Sales Order (Order-to-Cash)";
    internal const string ErpStockTransferName = "Stock Transfer Request";
    internal const string ErpExpenseClaimName = "Expense Claim";
    internal const string ErpVendorRegistrationName = "Vendor Registration";

    // ---------- small builders to keep the templates readable ----------

    private static WorkflowNode N(NodeType type, string name, double x, double y = 260, string? assignee = null,
        string? priority = null, FormDefinition? form = null, string? description = null) => new()
    {
        Type = type, Name = name, X = x, Y = y, Assignee = assignee, Priority = priority, Form = form, Description = description
    };

    private static WorkflowEdge E(WorkflowNode from, WorkflowNode to, string label = "Default") =>
        new() { SourceNodeId = from.Id, TargetNodeId = to.Id, Label = label };

    private static FormField F(string key, string label, FormFieldType type, bool required = false, bool readOnly = false, string? placeholder = null, params string[] options) => new()
    {
        Key = key, Label = label, Type = type, Required = required, ReadOnly = readOnly, Placeholder = placeholder,
        Options = options.Select(o => new FormFieldOption { Label = o, Value = o }).ToList()
    };

    private static FormField RO(string key, string label, FormFieldType type = FormFieldType.Text) => F(key, label, type, readOnly: true);

    private static FormField Company() => F("company", "Company", FormFieldType.Select, true, false, null, "Main Company", "Trading Co.");
    private static FormField Branch() => F("branch", "Branch", FormFieldType.Select, true, false, null, "HQ - Riyadh", "Jeddah Branch", "Dammam Branch");
    private static FormField Currency() => F("currency", "Currency", FormFieldType.Select, true, false, null, "SAR", "USD", "EUR");
    private static FormField Warehouse(string key, string label) => F(key, label, FormFieldType.Select, true, false, null, "Main Warehouse - Riyadh", "Jeddah Warehouse", "Dammam Warehouse");

    private static FormDefinition Form(string title, params FormField[] fields) => new() { Title = title, Fields = fields.ToList() };

    // ======================================================================================
    // 1. Purchase Requisition - Procure-to-Pay
    // ======================================================================================
    private static WorkflowDefinition BuildPurchaseRequisitionP2P()
    {
        var start = N(NodeType.Start, "Start", 40);
        var request = N(NodeType.FormTask, "Submit Purchase Requisition", 220, assignee: "{{initiator}}", priority: "Normal",
            description: "Describe what you need. Requests over 10,000 also go to the department head.",
            form: Form("Purchase Requisition",
                Company(), Branch(),
                F("department", "Department", FormFieldType.Select, true, false, null, "Operations", "IT", "Finance", "HR", "Sales", "Administration"),
                F("item", "Item / Service", FormFieldType.Text, true),
                F("category", "Category", FormFieldType.Select, true, false, null, "IT Equipment", "Office Supplies", "Raw Materials", "Services", "Furniture", "Spare Parts"),
                F("quantity", "Quantity", FormFieldType.Number, true),
                F("amount", "Estimated Total Amount", FormFieldType.Number, true),
                Currency(),
                F("neededBy", "Needed By", FormFieldType.Date, true),
                F("costCenter", "Cost Center", FormFieldType.Text),
                F("justification", "Business Justification", FormFieldType.TextArea, true)));

        var manager = N(NodeType.ApprovalTask, "Manager Approval", 420, assignee: "manager", priority: "High",
            form: Form("Review Purchase Requisition",
                RO("item", "Item / Service"), RO("category", "Category"), RO("quantity", "Quantity", FormFieldType.Number),
                RO("amount", "Estimated Total Amount", FormFieldType.Number), RO("currency", "Currency"), RO("branch", "Branch"),
                RO("justification", "Business Justification", FormFieldType.TextArea),
                F("managerComment", "Manager Comment", FormFieldType.TextArea)));
        manager.EscalateAfterMinutes = 1440;
        manager.EscalateTo = "senior-manager";

        var bigSpend = N(NodeType.Condition, "Amount over 10,000?", 600);
        bigSpend.ConditionExpression = "amount > 10000";

        var deptHead = N(NodeType.ApprovalTask, "Department Head Approval", 600, 100, assignee: "department-head", priority: "High",
            form: Form("High-value Purchase Approval",
                RO("item", "Item / Service"), RO("amount", "Estimated Total Amount", FormFieldType.Number), RO("currency", "Currency"),
                RO("managerComment", "Manager Comment", FormFieldType.TextArea),
                F("budgetLine", "Budget Line", FormFieldType.Text)));

        var po = N(NodeType.FormTask, "Create Purchase Order", 800, assignee: "procurement", priority: "Normal",
            description: "Source the vendor and issue the PO. The PO total replaces the estimate.",
            form: Form("Purchase Order",
                RO("item", "Item / Service"), RO("quantity", "Quantity", FormFieldType.Number),
                F("vendor", "Vendor", FormFieldType.Text, true),
                F("poNumber", "PO Number", FormFieldType.Text, true, false, "PO-2026-0001"),
                F("unitPrice", "Unit Price", FormFieldType.Number, true),
                F("amount", "PO Total Amount", FormFieldType.Number, true),
                Currency(),
                F("deliveryDate", "Expected Delivery", FormFieldType.Date, true),
                F("paymentTerms", "Payment Terms", FormFieldType.Select, true, false, null, "Net 30", "Net 60", "Advance", "On Delivery")));

        var grn = N(NodeType.FormTask, "Goods Receipt (GRN)", 1000, assignee: "warehouse", priority: "Normal",
            form: Form("Goods Receipt Note",
                RO("poNumber", "PO Number"), RO("vendor", "Vendor"), RO("item", "Item / Service"), RO("quantity", "Ordered Quantity", FormFieldType.Number),
                F("grnNumber", "GRN Number", FormFieldType.Text, true),
                F("receivedQty", "Received Quantity", FormFieldType.Number, true),
                Warehouse("warehouseLocation", "Received Into"),
                F("receiptCondition", "Condition", FormFieldType.Select, true, false, null, "Good", "Partial", "Damaged")));

        var pay = N(NodeType.FormTask, "Vendor Invoice & Payment", 1200, assignee: "finance", priority: "Normal",
            form: Form("Vendor Invoice & Payment",
                RO("vendor", "Vendor"), RO("poNumber", "PO Number"), RO("grnNumber", "GRN Number"),
                RO("amount", "PO Total Amount", FormFieldType.Number), RO("currency", "Currency"),
                F("invoiceNumber", "Vendor Invoice Number", FormFieldType.Text, true),
                F("paymentMethod", "Payment Method", FormFieldType.Select, true, false, null, "Bank Transfer", "Cheque", "Cash"),
                F("paymentDate", "Payment Date", FormFieldType.Date, true),
                F("paymentReference", "Payment Reference", FormFieldType.Text)));

        var gl = N(NodeType.Logger, "Post Journal Entry (GL)", 1400);
        gl.LogMessage = "GL posted - Dr Inventory/Expense {{amount}} {{currency}} | Cr Accounts Payable - PO {{poNumber}}, vendor {{vendor}}, invoice {{invoiceNumber}}; paid by {{paymentMethod}} ({{paymentReference}}).";

        var notify = N(NodeType.Notification, "Notify Requester", 1580);
        notify.NotificationTo = "{{initiator}}";
        notify.NotificationMessage = "Your purchase requisition for {{item}} is complete (PO {{poNumber}}).";
        notify.DefaultOutcome = "Default";

        var end = N(NodeType.End, "Closed", 1760);
        var rejected = N(NodeType.End, "Rejected", 420, 460);

        return new WorkflowDefinition
        {
            Name = ErpPurchaseRequisitionName,
            Description = "End-to-end procurement: employee request, manager approval (department head above 10,000), purchase order, goods receipt, vendor payment and automatic journal posting.",
            IsPublished = true,
            Nodes = new() { start, request, manager, bigSpend, deptHead, po, grn, pay, gl, notify, end, rejected },
            Edges = new()
            {
                E(start, request), E(request, manager, "Submit"),
                E(manager, bigSpend, "Approve"), E(manager, rejected, "Reject"),
                E(bigSpend, deptHead, "True"), E(bigSpend, po, "False"),
                E(deptHead, po, "Approve"), E(deptHead, rejected, "Reject"),
                E(po, grn, "Submit"), E(grn, pay, "Submit"), E(pay, gl, "Pay"),
                E(gl, notify), E(notify, end),
            }
        };
    }

    // ======================================================================================
    // 2. Sales Order - Order-to-Cash
    // ======================================================================================
    private static WorkflowDefinition BuildSalesOrderO2C()
    {
        var start = N(NodeType.Start, "Start", 40);
        var order = N(NodeType.FormTask, "Submit Sales Order", 220, assignee: "{{initiator}}", priority: "Normal",
            description: "Discounts above 10% need the sales manager's approval.",
            form: Form("Sales Order",
                Company(), Branch(),
                F("customer", "Customer", FormFieldType.Text, true),
                F("customerEmail", "Customer Email", FormFieldType.Email),
                F("item", "Product", FormFieldType.Text, true),
                F("quantity", "Quantity", FormFieldType.Number, true),
                F("amount", "Order Total", FormFieldType.Number, true),
                Currency(),
                F("discountPercent", "Discount %", FormFieldType.Number, true, false, "0"),
                F("paymentTerms", "Payment Terms", FormFieldType.Select, true, false, null, "Cash", "Net 30", "Net 60"),
                F("deliveryDate", "Requested Delivery", FormFieldType.Date, true),
                F("notes", "Notes", FormFieldType.TextArea)));

        var discount = N(NodeType.Condition, "Discount over 10%?", 420);
        discount.ConditionExpression = "discountPercent > 10";

        var salesMgr = N(NodeType.ApprovalTask, "Sales Manager Approval", 420, 100, assignee: "manager", priority: "High",
            form: Form("Approve Discount",
                RO("customer", "Customer"), RO("item", "Product"), RO("amount", "Order Total", FormFieldType.Number),
                RO("currency", "Currency"), RO("discountPercent", "Discount %", FormFieldType.Number),
                F("approvalNote", "Note", FormFieldType.TextArea)));

        var ship = N(NodeType.FormTask, "Pick & Ship Goods", 640, assignee: "warehouse", priority: "Normal",
            form: Form("Delivery",
                RO("customer", "Customer"), RO("item", "Product"), RO("quantity", "Ordered Quantity", FormFieldType.Number),
                Warehouse("shipFrom", "Ship From"),
                F("deliveryNote", "Delivery Note #", FormFieldType.Text, true),
                F("shippedQty", "Shipped Quantity", FormFieldType.Number, true),
                F("shipDate", "Ship Date", FormFieldType.Date, true)));

        var invoice = N(NodeType.FormTask, "Customer Invoice & Collection", 860, assignee: "finance", priority: "Normal",
            form: Form("Invoice & Collection",
                RO("customer", "Customer"), RO("amount", "Order Total", FormFieldType.Number), RO("currency", "Currency"), RO("deliveryNote", "Delivery Note #"),
                F("invoiceNumber", "Invoice Number", FormFieldType.Text, true),
                F("collectedAmount", "Amount Collected", FormFieldType.Number, true),
                F("collectionMethod", "Collection Method", FormFieldType.Select, true, false, null, "Bank Transfer", "Card", "Cash", "Cheque")));

        var gl = N(NodeType.Logger, "Post Revenue Journal (GL)", 1060);
        gl.LogMessage = "GL posted - Dr Cash/Accounts Receivable {{collectedAmount}} {{currency}} | Cr Sales Revenue {{amount}} - invoice {{invoiceNumber}}, customer {{customer}}.";

        var end = N(NodeType.End, "Closed", 1240);
        var rejected = N(NodeType.End, "Rejected", 420, 460);

        return new WorkflowDefinition
        {
            Name = ErpSalesOrderName,
            Description = "Order-to-cash: sales order entry, discount approval above 10%, warehouse pick & ship, customer invoicing and collection, and revenue posting.",
            IsPublished = true,
            Nodes = new() { start, order, discount, salesMgr, ship, invoice, gl, end, rejected },
            Edges = new()
            {
                E(start, order), E(order, discount, "Submit"),
                E(discount, salesMgr, "True"), E(discount, ship, "False"),
                E(salesMgr, ship, "Approve"), E(salesMgr, rejected, "Reject"),
                E(ship, invoice, "Submit"), E(invoice, gl, "Collected"), E(gl, end),
            }
        };
    }

    // ======================================================================================
    // 3. Stock Transfer
    // ======================================================================================
    private static WorkflowDefinition BuildStockTransfer()
    {
        var start = N(NodeType.Start, "Start", 40);
        var request = N(NodeType.FormTask, "Submit Stock Transfer Request", 220, assignee: "{{initiator}}", priority: "Normal",
            form: Form("Stock Transfer",
                Company(), Branch(),
                F("item", "Item", FormFieldType.Text, true),
                F("quantity", "Quantity", FormFieldType.Number, true),
                F("amount", "Stock Value", FormFieldType.Number),
                Currency(),
                Warehouse("fromWarehouse", "From Warehouse"),
                Warehouse("toWarehouse", "To Warehouse"),
                F("reason", "Reason", FormFieldType.TextArea, true)));

        var stores = N(NodeType.ApprovalTask, "Stores Approval", 420, assignee: "admin-stores", priority: "Normal",
            form: Form("Approve Transfer",
                RO("item", "Item"), RO("quantity", "Quantity", FormFieldType.Number), RO("fromWarehouse", "From"), RO("toWarehouse", "To"),
                RO("reason", "Reason", FormFieldType.TextArea), F("storesComment", "Comment", FormFieldType.TextArea)));

        var move = N(NodeType.FormTask, "Dispatch & Receive Stock", 620, assignee: "warehouse", priority: "Normal",
            form: Form("Stock Movement",
                RO("item", "Item"), RO("quantity", "Requested Quantity", FormFieldType.Number), RO("fromWarehouse", "From"), RO("toWarehouse", "To"),
                F("transferNote", "Transfer Note #", FormFieldType.Text, true),
                F("receivedQty", "Received Quantity", FormFieldType.Number, true),
                F("receivedDate", "Received Date", FormFieldType.Date, true)));

        var gl = N(NodeType.Logger, "Post Inventory Journal (GL)", 820);
        gl.LogMessage = "Inventory moved - {{receivedQty}} x {{item}} from {{fromWarehouse}} to {{toWarehouse}} (note {{transferNote}}).";

        var end = N(NodeType.End, "Closed", 1000);
        var rejected = N(NodeType.End, "Rejected", 420, 460);

        return new WorkflowDefinition
        {
            Name = ErpStockTransferName,
            Description = "Move stock between warehouses: request, stores approval, dispatch & receipt, and inventory journal.",
            IsPublished = true,
            Nodes = new() { start, request, stores, move, gl, end, rejected },
            Edges = new()
            {
                E(start, request), E(request, stores, "Submit"),
                E(stores, move, "Approve"), E(stores, rejected, "Reject"),
                E(move, gl, "Submit"), E(gl, end),
            }
        };
    }

    // ======================================================================================
    // 4. Expense Claim
    // ======================================================================================
    private static WorkflowDefinition BuildExpenseClaim()
    {
        var start = N(NodeType.Start, "Start", 40);
        var claim = N(NodeType.FormTask, "Submit Expense Claim", 220, assignee: "{{initiator}}", priority: "Normal",
            form: Form("Expense Claim",
                Company(), Branch(),
                F("expenseType", "Expense Type", FormFieldType.Select, true, false, null, "Travel", "Meals", "Accommodation", "Training", "Fuel", "Other"),
                F("expenseDate", "Expense Date", FormFieldType.Date, true),
                F("amount", "Amount", FormFieldType.Number, true),
                Currency(),
                F("description", "Description", FormFieldType.TextArea, true)));

        var manager = N(NodeType.ApprovalTask, "Manager Approval", 420, assignee: "manager", priority: "Normal",
            form: Form("Review Expense",
                RO("expenseType", "Expense Type"), RO("expenseDate", "Expense Date", FormFieldType.Date), RO("amount", "Amount", FormFieldType.Number),
                RO("currency", "Currency"), RO("description", "Description", FormFieldType.TextArea), F("managerComment", "Comment", FormFieldType.TextArea)));

        var big = N(NodeType.Condition, "Amount over 5,000?", 600);
        big.ConditionExpression = "amount > 5000";

        var finance = N(NodeType.ApprovalTask, "Finance Review", 600, 100, assignee: "finance", priority: "High",
            form: Form("Finance Review",
                RO("expenseType", "Expense Type"), RO("amount", "Amount", FormFieldType.Number), RO("currency", "Currency"),
                RO("managerComment", "Manager Comment", FormFieldType.TextArea), F("financeComment", "Comment", FormFieldType.TextArea)));

        var pay = N(NodeType.FormTask, "Reimbursement Payment", 800, assignee: "finance", priority: "Normal",
            form: Form("Reimbursement",
                RO("amount", "Amount", FormFieldType.Number), RO("currency", "Currency"),
                F("paymentReference", "Payment Reference", FormFieldType.Text, true),
                F("paymentDate", "Payment Date", FormFieldType.Date, true)));

        var gl = N(NodeType.Logger, "Post Expense Journal (GL)", 1000);
        gl.LogMessage = "GL posted - Dr {{expenseType}} Expense {{amount}} {{currency}} | Cr Cash/Bank - ref {{paymentReference}}.";

        var end = N(NodeType.End, "Closed", 1180);
        var rejected = N(NodeType.End, "Rejected", 420, 460);

        return new WorkflowDefinition
        {
            Name = ErpExpenseClaimName,
            Description = "Employee expense reimbursement: claim, manager approval, finance review above 5,000, payment and journal posting.",
            IsPublished = true,
            Nodes = new() { start, claim, manager, big, finance, pay, gl, end, rejected },
            Edges = new()
            {
                E(start, claim), E(claim, manager, "Submit"),
                E(manager, big, "Approve"), E(manager, rejected, "Reject"),
                E(big, finance, "True"), E(big, pay, "False"),
                E(finance, pay, "Approve"), E(finance, rejected, "Reject"),
                E(pay, gl, "Pay"), E(gl, end),
            }
        };
    }

    // ======================================================================================
    // 5. Vendor Registration
    // ======================================================================================
    private static WorkflowDefinition BuildVendorRegistration()
    {
        var start = N(NodeType.Start, "Start", 40);
        var reg = N(NodeType.FormTask, "Submit Vendor Registration", 220, assignee: "{{initiator}}", priority: "Normal",
            form: Form("Vendor Registration",
                Company(),
                F("vendorName", "Vendor Name", FormFieldType.Text, true),
                F("crNumber", "Commercial Registration #", FormFieldType.Text, true),
                F("vatNumber", "VAT Number", FormFieldType.Text, true),
                F("category", "Supply Category", FormFieldType.Select, true, false, null, "IT Equipment", "Office Supplies", "Raw Materials", "Services", "Logistics"),
                F("contactEmail", "Contact Email", FormFieldType.Email, true),
                F("bankIban", "Bank IBAN", FormFieldType.Text, true)));

        var proc = N(NodeType.ApprovalTask, "Procurement Review", 420, assignee: "procurement", priority: "Normal",
            form: Form("Vendor Review",
                RO("vendorName", "Vendor Name"), RO("crNumber", "CR #"), RO("category", "Supply Category"),
                F("procurementRating", "Rating", FormFieldType.Select, true, false, null, "Preferred", "Approved", "Conditional")));

        var fin = N(NodeType.ApprovalTask, "Finance Verification", 620, assignee: "finance", priority: "Normal",
            form: Form("Bank & Tax Verification",
                RO("vendorName", "Vendor Name"), RO("vatNumber", "VAT Number"), RO("bankIban", "Bank IBAN"),
                F("bankVerified", "Bank details verified", FormFieldType.Checkbox, true)));

        var master = N(NodeType.Logger, "Create Vendor Master", 820);
        master.LogMessage = "Vendor master created - {{vendorName}} (CR {{crNumber}}, VAT {{vatNumber}}), rating {{procurementRating}}.";

        var end = N(NodeType.End, "Closed", 1000);
        var rejected = N(NodeType.End, "Rejected", 520, 460);

        return new WorkflowDefinition
        {
            Name = ErpVendorRegistrationName,
            Description = "Onboard a new supplier: registration, procurement review, finance bank/VAT verification and vendor master creation.",
            IsPublished = true,
            Nodes = new() { start, reg, proc, fin, master, end, rejected },
            Edges = new()
            {
                E(start, reg), E(reg, proc, "Submit"),
                E(proc, fin, "Approve"), E(proc, rejected, "Reject"),
                E(fin, master, "Approve"), E(fin, rejected, "Reject"),
                E(master, end),
            }
        };
    }
}
