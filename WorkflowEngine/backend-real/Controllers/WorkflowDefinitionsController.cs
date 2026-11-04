using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

/// <summary>
/// What the client actually sends when creating/editing a flow. Deliberately excludes
/// Id/CreatedAt/UpdatedAt/IsPublished/Version - those are server-owned. Binding straight to
/// the WorkflowDefinition entity used to fail whenever the designer sent an empty-string
/// timestamp for a not-yet-saved flow (System.Text.Json can't parse "" as DateTime).
/// </summary>
public class WorkflowDefinitionInput
{
    public string Name { get; set; } = "Untitled Flow";
    public string Description { get; set; } = string.Empty;
    public List<WorkflowNode> Nodes { get; set; } = new();
    public List<WorkflowEdge> Edges { get; set; } = new();
}

public class TestConditionRequest
{
    public string Expression { get; set; } = string.Empty;
    public Dictionary<string, object?> Data { get; set; } = new();
}

[ApiController]
[Route("api/definitions")]
[Authorize]
public class WorkflowDefinitionsController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly ITenantScope _tenant;
    private readonly IPermissionService _perms;

    public WorkflowDefinitionsController(WorkflowDbContext db, ITenantScope tenant, IPermissionService perms)
    {
        _db = db;
        _tenant = tenant;
        _perms = perms;
    }

    /// <summary>Every flow belongs to one workspace; the designer privileges (wf.design / wf.publish) are set per user in Admin.</summary>
    private async Task<bool> Can(string perm) => await _perms.Has(User, perm);

    [HttpGet]
    public async Task<ActionResult<IEnumerable<WorkflowDefinition>>> GetAll()
    {
        var t = await _tenant.TenantIdOf(User);
        // own flows + the published templates every workspace gets from the platform ("default" workspace); templates are read-only for others
        return Ok(await _db.Definitions.Where(d => d.TenantId == t || (d.TenantId == Tenant.DefaultId && d.IsPublished)).OrderByDescending(d => d.UpdatedAt).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<WorkflowDefinition>> Get(string id)
    {
        var t = await _tenant.TenantIdOf(User);
        var def = await _db.Definitions.FirstOrDefaultAsync(d => d.Id == id && (d.TenantId == t || (d.TenantId == Tenant.DefaultId && d.IsPublished)));
        return def is null ? NotFound() : Ok(def);
    }

    [HttpPost]
    public async Task<ActionResult<WorkflowDefinition>> Create([FromBody] WorkflowDefinitionInput input)
    {
        if (!await Can("wf.design")) return Forbid();
        var definition = new WorkflowDefinition
        {
            TenantId = await _tenant.TenantIdOf(User),
            Name = input.Name,
            Description = input.Description,
            Nodes = input.Nodes,
            Edges = input.Edges,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.Definitions.Add(definition);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = definition.Id }, definition);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<WorkflowDefinition>> Update(string id, [FromBody] WorkflowDefinitionInput input)
    {
        if (!await Can("wf.design")) return Forbid();
        var t = await _tenant.TenantIdOf(User);
        var existing = await _db.Definitions.FirstOrDefaultAsync(d => d.Id == id && d.TenantId == t);
        if (existing is null) return NotFound();

        existing.Name = input.Name;
        existing.Description = input.Description;
        existing.Nodes = input.Nodes;
        existing.Edges = input.Edges;
        existing.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(existing);
    }

    [HttpPost("{id}/publish")]
    public async Task<ActionResult<WorkflowDefinition>> Publish(string id)
    {
        if (!await Can("wf.publish")) return Forbid();
        var t = await _tenant.TenantIdOf(User);
        var def = await _db.Definitions.FirstOrDefaultAsync(d => d.Id == id && d.TenantId == t);
        if (def is null) return NotFound();

        if (def.Nodes.Count(n => n.Type == NodeType.Start) != 1)
            return BadRequest("Workflow must have exactly one Start node.");
        if (!def.Nodes.Any(n => n.Type == NodeType.End))
            return BadRequest("Workflow must have at least one End node.");

        def.IsPublished = true;
        def.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(def);
    }

    /// <summary>Lets the designer show live pass/fail feedback while you type a Condition
    /// node's expression, against sample data you paste in - no need to Test Run a whole
    /// instance just to check one gateway's logic.</summary>
    [HttpPost("test-condition")]
    public ActionResult<ConditionEvalResult> TestCondition([FromBody] TestConditionRequest request)
        => Ok(ConditionEvaluator.EvaluateDetailed(request.Expression, request.Data));

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        if (!await Can("wf.publish")) return Forbid();
        var t = await _tenant.TenantIdOf(User);
        var def = await _db.Definitions.FirstOrDefaultAsync(d => d.Id == id && d.TenantId == t);
        if (def is null) return NotFound();
        _db.Definitions.Remove(def);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
