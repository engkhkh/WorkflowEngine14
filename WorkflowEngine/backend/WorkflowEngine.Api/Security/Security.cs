using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Security;

// ======================================================================================================================
//  ACCESS LAYER
//  Controller  ->  ICurrentUser / [RequirePermission] / ISecureData  ->  services  ->  database
//  Who is calling, which workspace they belong to, what they may do and which rows they may touch is decided here, once,
//  instead of being repeated in every controller. Old controllers keep working; new / migrated ones use this layer.
// ======================================================================================================================

/// <summary>Thrown by <see cref="ICurrentUser.RequireAsync"/>; the <see cref="SecurityErrorMiddleware"/> turns it into a 403.</summary>
public class AccessDeniedException : Exception
{
    public string[] Required { get; }
    public AccessDeniedException(params string[] required) : base("You do not have permission for this action.") { Required = required; }
}

/// <summary>An entity that belongs to one workspace (tenant). Rows are only ever read / written through <see cref="ISecureData"/> with the caller's workspace.</summary>
public interface ITenantOwned { string TenantId { get; set; } }

/// <summary>The signed-in user of the current request: identity, workspace and privileges (read from the database once per request, so an admin's change applies on the next call).</summary>
public interface ICurrentUser
{
    bool IsAuthenticated { get; }
    string Username { get; }
    string Role { get; }
    ClaimsPrincipal Principal { get; }
    Task<string> TenantIdAsync();
    Task<IReadOnlyList<string>> PermissionsAsync();
    Task<bool> HasAsync(string permission);
    Task<bool> HasAnyAsync(params string[] permissions);
    /// <summary>Passes when the user holds ANY of the privileges, otherwise throws <see cref="AccessDeniedException"/>.</summary>
    Task RequireAsync(params string[] anyOf);
}

public class CurrentUser : ICurrentUser
{
    private readonly IHttpContextAccessor _http;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;
    private string? _tenantId;
    private List<string>? _permissions;

    public CurrentUser(IHttpContextAccessor http, IPermissionService perms, ITenantScope tenant) { _http = http; _perms = perms; _tenant = tenant; }

    public ClaimsPrincipal Principal => _http.HttpContext?.User ?? new ClaimsPrincipal();
    public bool IsAuthenticated => Principal.Identity?.IsAuthenticated == true;
    public string Username => Principal.FindFirstValue(ClaimTypes.Name) ?? string.Empty;
    public string Role => Principal.FindFirstValue(ClaimTypes.Role) ?? string.Empty;

    public async Task<string> TenantIdAsync()
    {
        if (_tenantId == null) _tenantId = await _tenant.TenantIdOf(Principal);
        return _tenantId;
    }

    public async Task<IReadOnlyList<string>> PermissionsAsync()
    {
        if (_permissions == null) _permissions = await _perms.EffectiveFor(Principal);
        return _permissions;
    }

    public async Task<bool> HasAsync(string permission)
        => (await PermissionsAsync()).Contains(permission, StringComparer.OrdinalIgnoreCase);

    public async Task<bool> HasAnyAsync(params string[] permissions)
    {
        if (permissions.Length == 0) return IsAuthenticated;
        var mine = await PermissionsAsync();
        return permissions.Any(p => mine.Contains(p, StringComparer.OrdinalIgnoreCase));
    }

    public async Task RequireAsync(params string[] anyOf)
    {
        if (!IsAuthenticated || !await HasAnyAsync(anyOf)) throw new AccessDeniedException(anyOf);
    }
}

/// <summary>
/// Declarative privilege check for a controller or action: <c>[RequirePermission("crm.leads.manage")]</c> or, for "any of", <c>[RequirePermission("hr.view", "hr.self")]</c>.
/// Several attributes must ALL pass. A refusal is answered with 403 and written to the log (user, privilege, path).
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public sealed class RequirePermissionAttribute : Attribute, IAsyncAuthorizationFilter
{
    public string[] AnyOf { get; }
    public RequirePermissionAttribute(params string[] anyOf) { AnyOf = anyOf; }

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var sp = context.HttpContext.RequestServices;
        var user = (ICurrentUser)sp.GetService(typeof(ICurrentUser))!;
        if (!user.IsAuthenticated) { context.Result = new UnauthorizedResult(); return; }
        if (await user.HasAnyAsync(AnyOf)) return;
        var log = (ILoggerFactory)sp.GetService(typeof(ILoggerFactory))!;
        log.CreateLogger("Security").LogWarning("Access denied: {User} needs one of [{Needs}] for {Method} {Path}", user.Username, string.Join(", ", AnyOf), context.HttpContext.Request.Method, context.HttpContext.Request.Path);
        context.Result = new ObjectResult(new { message = "You do not have permission for this action." }) { StatusCode = StatusCodes.Status403Forbidden };
    }
}

/// <summary>
/// The only door from controllers / services to workspace data. Reads are filtered to the caller's workspace, and new rows are stamped
/// with it (whatever the client sent is overwritten), so one workspace can never see or create rows in another.
/// </summary>
public interface ISecureData
{
    /// <summary>Read-only query limited to the caller's workspace.</summary>
    Task<IQueryable<T>> ReadAsync<T>() where T : class, ITenantOwned;
    /// <summary>Tracked query (for update / delete) limited to the caller's workspace.</summary>
    Task<IQueryable<T>> WriteAsync<T>() where T : class, ITenantOwned;
    /// <summary>Adds a row, stamping it with the caller's workspace.</summary>
    Task<T> AddAsync<T>(T entity) where T : class, ITenantOwned;
    void Remove<T>(T entity) where T : class, ITenantOwned;
    Task<int> SaveAsync();
}

public class SecureData : ISecureData
{
    private readonly WorkflowDbContext _db;
    private readonly ICurrentUser _user;
    public SecureData(WorkflowDbContext db, ICurrentUser user) { _db = db; _user = user; }

    public async Task<IQueryable<T>> ReadAsync<T>() where T : class, ITenantOwned
    {
        var t = await _user.TenantIdAsync();
        return _db.Set<T>().AsNoTracking().Where(x => x.TenantId == t);
    }
    public async Task<IQueryable<T>> WriteAsync<T>() where T : class, ITenantOwned
    {
        var t = await _user.TenantIdAsync();
        return _db.Set<T>().Where(x => x.TenantId == t);
    }
    public async Task<T> AddAsync<T>(T entity) where T : class, ITenantOwned
    {
        entity.TenantId = await _user.TenantIdAsync();
        _db.Set<T>().Add(entity);
        return entity;
    }
    public void Remove<T>(T entity) where T : class, ITenantOwned => _db.Set<T>().Remove(entity);
    public Task<int> SaveAsync() => _db.SaveChangesAsync();
}

/// <summary>Answers an <see cref="AccessDeniedException"/> with 403 JSON ({ message }) wherever in the pipeline it is thrown.</summary>
public class SecurityErrorMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<SecurityErrorMiddleware> _log;
    public SecurityErrorMiddleware(RequestDelegate next, ILogger<SecurityErrorMiddleware> log) { _next = next; _log = log; }

    public async Task InvokeAsync(HttpContext ctx)
    {
        try { await _next(ctx); }
        catch (AccessDeniedException ex) when (!ctx.Response.HasStarted)
        {
            _log.LogWarning("Access denied: {User} needs one of [{Needs}] for {Method} {Path}", ctx.User.Identity?.Name ?? "?", string.Join(", ", ex.Required), ctx.Request.Method, ctx.Request.Path);
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            await ctx.Response.WriteAsJsonAsync(new { message = ex.Message });
        }
    }
}

/// <summary>
/// Authentication check on every request after the token itself was validated: the account must still exist and be active
/// (a deactivated or deleted user's token stops working immediately instead of at expiry). The answer is cached for 20 seconds.
/// </summary>
public class SessionValidationMiddleware
{
    private readonly RequestDelegate _next;
    public SessionValidationMiddleware(RequestDelegate next) { _next = next; }

    public async Task InvokeAsync(HttpContext ctx, WorkflowDbContext db, IMemoryCache cache)
    {
        var name = ctx.User.Identity?.IsAuthenticated == true ? ctx.User.FindFirstValue(ClaimTypes.Name) : null;
        if (!string.IsNullOrEmpty(name))
        {
            var key = "session-active:" + name;
            if (!cache.TryGetValue(key, out bool active))
            {
                active = await db.Users.AsNoTracking().AnyAsync(u => u.Username == name && u.IsActive);
                cache.Set(key, active, TimeSpan.FromSeconds(20));
            }
            if (!active)
            {
                ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await ctx.Response.WriteAsJsonAsync(new { message = "Your account is no longer active." });
                return;
            }
        }
        await _next(ctx);
    }
}

public static class SecurityLayerExtensions
{
    public static IServiceCollection AddSecurityLayer(this IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.AddMemoryCache();
        services.AddScoped<ICurrentUser, CurrentUser>();
        services.AddScoped<ISecureData, SecureData>();
        return services;
    }
}
