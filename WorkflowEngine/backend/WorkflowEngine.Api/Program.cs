using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(opts =>
{
    opts.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    opts.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
});

builder.Services.AddEndpointsApiExplorer();

// --- SQL Server via EF Core ---
var connectionString = builder.Configuration.GetConnectionString("WorkflowDb")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:WorkflowDb in appsettings.json.");

builder.Services.AddDbContext<WorkflowDbContext>(options =>
    options.UseSqlServer(connectionString, sql => sql.EnableRetryOnFailure()));

builder.Services.AddScoped<IWorkflowEngineService, WorkflowEngineService>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<IPermissionService, PermissionService>();
builder.Services.AddScoped<ITenantScope, TenantScope>();   // SaaS workspaces (users/companies/branches/instances per tenant)
builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();
builder.Services.AddSingleton<IScriptRunner, ScriptRunner>();
builder.Services.AddSingleton<IActivityFileLogger, ActivityFileLogger>();
builder.Services.AddSingleton<IBusinessHoursCalculator, BusinessHoursCalculator>();
builder.Services.AddHostedService<TaskEscalationHostedService>();

// Used by WorkflowCall nodes to make real HTTP calls (see WorkflowEngineService.CallWebhookAsync).
builder.Services.AddHttpClient("workflow-webhook", client =>
{
    client.Timeout = TimeSpan.FromSeconds(15);
});

// --- JWT auth ---
var jwtSection = builder.Configuration.GetSection("Jwt");
builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtSection["Issuer"],
        ValidAudience = jwtSection["Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSection["Key"]!))
    };
});
builder.Services.AddAuthorization();

const string AngularDevCors = "AngularDevCors";
builder.Services.AddCors(options =>
{
    // Wide open for local development so any static server (the standalone portal in
    // /portal, a "Live Server" extension, python -m http.server, etc) can call this API
    // without a CORS dance. Safe here because auth is a Bearer token in a header, not a
    // cookie - there's no credentialed-request/CSRF exposure the way AllowAnyOrigin would
    // create for cookie-based auth. Tighten this to your real deployed origin(s) before
    // shipping anywhere that isn't localhost.
    options.AddPolicy(AngularDevCors, policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

// Apply pending EF Core migrations on startup, then seed demo users + a sample workflow
// if the DB is empty. (Run `dotnet ef migrations add InitialCreate` once locally first.)
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<WorkflowDbContext>();
    db.Database.Migrate();

    // Admin module + SaaS workspaces: adds Users.Permissions, Users.TenantId and the Tenants /
    // OrgCompanies / OrgBranches tables to an existing database - no migration needed. Idempotent.
    // See README "Admin module" / "SaaS workspaces".
    await SchemaUpgrade.Apply(db);

    // Both seed methods are idempotent (skip anything that already exists by name), so this
    // is safe to run on every startup - existing databases just pick up new templates/users.
    await SeedData.SeedUsers(db);
    await TenantScope.SeedDefaults(db);   // 'default' workspace + demo companies/branches
    await SeedData.SeedWorkflows(db);
    await ErpSeedData.SeedErpWorkflows(db); // ERP business flows used by portal-app / mobile-app
}

app.UseCors(AngularDevCors);
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.MapGet("/", () => Results.Redirect("/api/definitions"));

app.Run();
