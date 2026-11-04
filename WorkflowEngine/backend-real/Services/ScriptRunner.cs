using Jint;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;

namespace WorkflowEngine.Api.Services;

public class ScriptResult
{
    public bool Success { get; set; }
    public string? Outcome { get; set; }
    public Dictionary<string, object?>? UpdatedData { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// Executes an Automation node's script for real when ScriptLanguage is set. Two very
/// different trust levels on purpose:
///
///   "JavaScript" - runs on Jint, a pure C# JS interpreter. Jint has NO built-in access to
///   the file system, network, environment variables, or process control - the only things a
///   script can touch are the plain data values explicitly handed to it below. This is the
///   recommended, effectively-sandboxed option for scripts written by anyone other than a
///   fully-trusted admin.
///
///   "CSharp" - runs on Roslyn's scripting API with full .NET/CLR access: File.*, Process.*,
///   HttpClient, reflection, everything. This is NOT sandboxed. Treat it exactly like giving
///   someone shell access to this server, because that's effectively what it is. The only
///   real guardrail in this project is that a workflow must be Published to ever actually run
///   (admin-only - see WorkflowDefinitionsController.Publish), so a C# script can only execute
///   in production if an admin approved that specific flow. Don't loosen that gate without
///   replacing it with something else.
///
/// Both run under a hard timeout so a bad script can't hang a request thread forever, and both
/// let the script set two things back: a string variable/property called `outcome` (which
/// outgoing edge label to follow) and mutations to `data` (merged back into the instance).
/// </summary>
public interface IScriptRunner
{
    Task<ScriptResult> RunAsync(string language, string code, Dictionary<string, object?> data);
}

public class ScriptRunner : IScriptRunner
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    public async Task<ScriptResult> RunAsync(string language, string code, Dictionary<string, object?> data)
    {
        using var cts = new CancellationTokenSource(Timeout);
        try
        {
            return language.Equals("JavaScript", StringComparison.OrdinalIgnoreCase)
                ? await Task.Run(() => RunJavaScript(code, data), cts.Token)
                : language.Equals("CSharp", StringComparison.OrdinalIgnoreCase)
                    ? await RunCSharpAsync(code, data, cts.Token)
                    : new ScriptResult { Success = false, Error = $"Unknown script language '{language}'." };
        }
        catch (OperationCanceledException)
        {
            return new ScriptResult { Success = false, Error = $"Script timed out after {Timeout.TotalSeconds:0}s." };
        }
        catch (Exception ex)
        {
            return new ScriptResult { Success = false, Error = ex.Message };
        }
    }

    private static ScriptResult RunJavaScript(string code, Dictionary<string, object?> data)
    {
        // Deliberately NOT calling .AllowClr() - that's what keeps this sandboxed. Without it,
        // the script has no way to reach .NET types, the file system, or the network at all.
        var engine = new Engine(options => options.TimeoutInterval(Timeout));
        var jsData = new Dictionary<string, object?>(data);
        engine.SetValue("data", jsData);
        engine.SetValue("outcome", "");
        engine.Execute(code);

        var outcome = engine.GetValue("outcome").ToString();
        return new ScriptResult { Success = true, Outcome = outcome, UpdatedData = jsData };
    }

    public class CSharpGlobals
    {
        public Dictionary<string, object?> Data { get; set; } = new();
        public string Outcome { get; set; } = "";
    }

    private static async Task<ScriptResult> RunCSharpAsync(string code, Dictionary<string, object?> data, CancellationToken ct)
    {
        var globals = new CSharpGlobals { Data = new Dictionary<string, object?>(data) };
        var options = ScriptOptions.Default.WithImports("System", "System.Linq", "System.Collections.Generic");
        await CSharpScript.RunAsync(code, options, globals, typeof(CSharpGlobals), ct);
        return new ScriptResult { Success = true, Outcome = globals.Outcome, UpdatedData = globals.Data };
    }
}
