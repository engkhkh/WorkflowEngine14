namespace WorkflowEngine.Api.Models;

/// <summary>
/// A website designed in the portal (Wix / Odoo Website style). The design is JSON (pages -> blocks); on publish the portal renders it to ONE html document
/// (all pages, hash navigation, shop cart) which is stored here and served from /s/{slug}.
/// </summary>
public class WebSite
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string TenantId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;            // unique across the server: the public address /s/{slug}
    public string DraftJson { get; set; } = "{}";                // the design being edited
    public string? PublishedHtml { get; set; }                   // what visitors get
    public string ProductsJson { get; set; } = "[]";            // price list frozen at publish time: [{ sku, name, price }]
    public string Currency { get; set; } = "SAR";
    public bool Published { get; set; }
    public DateTime? PublishedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>An order placed in the shop of a site, or a message sent from its contact form.</summary>
public class WebSubmission
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string TenantId { get; set; } = string.Empty;
    public string SiteId { get; set; } = string.Empty;
    public string Kind { get; set; } = "order";                  // order | message
    public string Number { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Address { get; set; }
    public string? Note { get; set; }
    public string LinesJson { get; set; } = "[]";                // [{ sku, name, qty, price }]
    public decimal Total { get; set; }
    public string Currency { get; set; } = "SAR";
    public string Status { get; set; } = "new";                  // new | confirmed | shipped | done | cancelled
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
