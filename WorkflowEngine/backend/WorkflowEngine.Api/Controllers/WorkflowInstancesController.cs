using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class StartInstanceRequest
{
    public string DefinitionId { get; set; } = string.Empty;
    public Dictionary<string, object?>? InitialData { get; set; }
}

[ApiController]
[Route("api/instances")]
[Authorize]
public class WorkflowInstancesController : ControllerBase
{
    private readonly IWorkflowEngineService _engine;
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;

    public WorkflowInstancesController(IWorkflowEngineService engine, WorkflowDbContext db, IPermissionService perms, ITenantScope tenant)
    {
        _engine = engine;
        _db = db;
        _perms = perms;
        _tenant = tenant;
    }

    private string Username => User.FindFirstValue(ClaimTypes.Name)!;
    private string Role => User.FindFirstValue(ClaimTypes.Role) ?? string.Empty;

    /// <summary>Everything for users with the documents.viewAll privilege; otherwise only the
    /// instances they started or have (had) a task on.</summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<WorkflowInstance>>> GetAll()
    {
        var visible = await _tenant.VisibleInstanceIds(User);   // only this workspace's documents
        var all = (await _db.Instances.OrderByDescending(i => i.StartedAt).ToListAsync()).Where(i => visible.Contains(i.Id)).ToList();
        if (await _perms.Has(User, Permissions.DocumentsViewAll)) return Ok(all);

        var me = Username;
        var role = Role;
        var taskRows = await _db.Tasks.Where(t => t.AssignedTo != null).Select(t => new { t.InstanceId, t.AssignedTo }).ToListAsync();
        var involved = taskRows.Where(t => t.AssignedTo!.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Any(a => string.Equals(a, me, StringComparison.OrdinalIgnoreCase) || (!string.IsNullOrEmpty(role) && string.Equals(a, role, StringComparison.OrdinalIgnoreCase))))
            .Select(t => t.InstanceId).ToHashSet();
        return Ok(all.Where(i => string.Equals(i.StartedBy, me, StringComparison.OrdinalIgnoreCase) || involved.Contains(i.Id)));
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<WorkflowInstance>> Get(string id)
    {
        if (!await _tenant.OwnsInstance(User, id)) return NotFound();
        var instance = await _engine.GetInstance(id);
        return instance is null ? NotFound() : Ok(instance);
    }

    [HttpPost("start")]
    public async Task<ActionResult<WorkflowInstance>> Start([FromBody] StartInstanceRequest request)
    {
        // ERP documents need the module's "create" privilege (e.g. purchasing.create).
        var defName = await _db.Definitions.Where(d => d.Id == request.DefinitionId).Select(d => d.Name).FirstOrDefaultAsync();
        var needed = defName != null ? ErpSeedData.CreatePermissionFor(defName) : null;
        if (needed != null && !await _perms.Has(User, needed))
            return StatusCode(403, $"You don't have the privilege '{needed}'.");

        try
        {
            var instance = await _engine.StartInstance(request.DefinitionId, Username, request.InitialData);
            return Ok(instance);
        }
        catch (KeyNotFoundException ex) { return NotFound(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(ex.Message); }
    }

    [HttpPost("{id}/cancel")]
    public async Task<ActionResult<WorkflowInstance>> Cancel(string id)
    {
        if (!await _tenant.OwnsInstance(User, id)) return NotFound();
        try
        {
            // documents.cancelAny lets a non-admin role cancel other people's documents too.
            var role = await _perms.Has(User, Permissions.DocumentsCancelAny) ? "admin" : Role;
            var instance = await _engine.CancelInstance(id, Username, role);
            return Ok(instance);
        }
        catch (KeyNotFoundException ex) { return NotFound(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(ex.Message); }
        catch (UnauthorizedAccessException ex) { return StatusCode(403, ex.Message); }
    }

    /// <summary>The persisted activity log for this instance, read straight from the
    /// ActivityLogs DB table rather than the instance's own JSON history blob - proves the
    /// dual DB+file logging is real and durable, independent of the instance row itself.</summary>
    [HttpGet("{id}/activity-log")]
    public async Task<ActionResult<IEnumerable<ActivityLogEntry>>> GetActivityLog(string id)
    {
        if (!await _tenant.OwnsInstance(User, id)) return NotFound();
        return Ok(await _db.ActivityLogs.Where(a => a.InstanceId == id).OrderBy(a => a.Timestamp).ToListAsync());
    }
}
