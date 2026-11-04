using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class CompleteTaskRequest
{
    public string Decision { get; set; } = string.Empty;
    public Dictionary<string, object?>? FormData { get; set; }
    public string? Comment { get; set; }
}

[ApiController]
[Route("api/tasks")]
[Authorize]
public class TasksController : ControllerBase
{
    private readonly IWorkflowEngineService _engine;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;
    private readonly WorkflowDbContext _db;

    public TasksController(IWorkflowEngineService engine, IPermissionService perms, ITenantScope tenant, WorkflowDbContext db)
    {
        _engine = engine;
        _perms = perms;
        _tenant = tenant;
        _db = db;
    }

    private string Username => User.FindFirstValue(ClaimTypes.Name)!;
    private string Role => User.FindFirstValue(ClaimTypes.Role) ?? string.Empty;

    /// <summary>
    /// Always scoped to the logged-in caller: returns tasks assigned directly to their
    /// username OR to their role (e.g. a node assigned to "manager" reaches every user
    /// whose Role is "manager"). GET /api/tasks?includeCompleted=false
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<WorkflowTask>>> GetAll([FromQuery] bool includeCompleted = false)
    {
        // A role-assigned task (e.g. "manager") must only reach people of the SAME workspace as the document's requester.
        var tasks = await _engine.GetTasksFor(Username, Role, includeCompleted);
        var visible = await _tenant.VisibleInstanceIds(User);
        return Ok(tasks.Where(t => visible.Contains(t.InstanceId)).ToList());
    }

    [HttpPost("{id}/complete")]
    public async Task<ActionResult<WorkflowTask>> Complete(string id, [FromBody] CompleteTaskRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Decision))
            return BadRequest("Decision is required.");
        if (!await _perms.Has(User, Permissions.TasksAct))
            return StatusCode(403, "You don't have the privilege to act on tasks.");

        var taskInstanceId = await _db.Tasks.Where(t => t.Id == id).Select(t => t.InstanceId).FirstOrDefaultAsync();
        if (taskInstanceId != null && !await _tenant.OwnsInstance(User, taskInstanceId)) return NotFound();

        try
        {
            var task = await _engine.CompleteTask(id, request.Decision, request.FormData, request.Comment, Username, Role);
            return Ok(task);
        }
        catch (KeyNotFoundException ex) { return NotFound(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(ex.Message); }
        catch (UnauthorizedAccessException ex) { return StatusCode(403, ex.Message); }
    }
}
