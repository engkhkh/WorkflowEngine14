"""Usage: python patch.py <backend/WorkflowEngine.Api folder>
Wires the access layer: services + middleware in Program.cs, ITenantOwned on ErpRecord / PosRecord. Idempotent."""
import sys
base = sys.argv[1]
def rw(path, fn):
    s = open(path, encoding='utf-8-sig').read(); n = fn(s)
    if n != s: open(path, 'w', encoding='utf-8').write(n); print('patched  ', path)
    else: print('unchanged', path)

def prog(s):
    if 'AddSecurityLayer' in s: return s
    s = s.replace("using WorkflowEngine.Api.Services;", "using WorkflowEngine.Api.Security;\nusing WorkflowEngine.Api.Services;", 1)
    s = s.replace("builder.Services.AddScoped<ITenantScope, TenantScope>();", "builder.Services.AddScoped<ITenantScope, TenantScope>();\nbuilder.Services.AddSecurityLayer();   // access layer: ICurrentUser, ISecureData, [RequirePermission]", 1)
    s = s.replace("app.UseCors(AngularDevCors);", "app.UseMiddleware<SecurityErrorMiddleware>();\napp.UseCors(AngularDevCors);", 1)
    s = s.replace("app.UseAuthentication();", "app.UseAuthentication();\napp.UseMiddleware<SessionValidationMiddleware>();   // token's user must still exist and be active", 1)
    return s
rw(base + '/Program.cs', prog)

def mark(cls):
    def f(s):
        if 'ITenantOwned' in s: return s
        return s.replace('public class %s\n' % cls, 'public class %s : WorkflowEngine.Api.Security.ITenantOwned\n' % cls, 1)
    return f
rw(base + '/Models/Modules.cs', mark('ErpRecord'))
rw(base + '/Models/Pos.cs', mark('PosRecord'))
