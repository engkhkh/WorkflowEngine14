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

    public WorkflowDefinitionsController(WorkflowDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<WorkflowDefinition>>> GetAll()
        => Ok(await _db.Definitions.OrderByDescending(d => d.UpdatedAt).ToListAsync());

    [HttpGet("{id}")]
    public async Task<ActionResult<WorkflowDefinition>> Get(string id)
    {
        var def = await _db.Definitions.FirstOrDefaultAsync(d => d.Id == id);
        return def is null ? NotFound() : Ok(def);
    }

    [HttpPost]
    public async Task<ActionResult<WorkflowDefinition>> Create([FromBody] WorkflowDefinitionInput input)
    {
        var definition = new WorkflowDefinition
        {
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
        var existing = await _db.Definitions.FirstOrDefaultAsync(d => d.Id == id);
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
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<WorkflowDefinition>> Publish(string id)
    {
        var def = await _db.Definitions.FirstOrDefaultAsync(d => d.Id == id);
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
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Delete(string id)
    {
        var def = await _db.Definitions.FirstOrDefaultAsync(d => d.Id == id);
        if (def is null) return NotFound();
        _db.Definitions.Remove(def);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
