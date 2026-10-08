using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace WorkflowEngine.Api.Controllers;

/// <summary>
/// A tiny self-contained "external system" for WebhookCall nodes to hit during local testing,
/// so you can see real HTTP branching (Successful/UnSuccessful/Error Encountered) and the
/// retry-via-Timer loop work end to end without wiring up an actual external API first.
/// Anonymous on purpose - this is the engine calling itself over loopback, not a user request.
/// Point a WebhookCall node's URL at one of these, e.g. http://localhost:5000/api/demo/lookup/new-manager
/// Swap these for your real endpoints whenever you're ready; nothing else in the engine
/// needs to change (see WorkflowEngineService.CallWebhookAsync).
/// </summary>
[ApiController]
[Route("api/demo")]
[AllowAnonymous]
public class DemoController : ControllerBase
{
    // Maps a lookup key (whatever you name the URL's last segment) to a resolved user - stands
    // in for the "Invoke Web API" calls in the recreated Skelta flows (GetNewManager, etc).
    private static readonly Dictionary<string, object> Lookups = new(StringComparer.OrdinalIgnoreCase)
    {
        ["new-manager"] = new { resolvedUsername = "new-manager", resolvedName = "Nadia New-Manager" },
        ["old-manager"] = new { resolvedUsername = "manager", resolvedName = "Mike Manager" },
        ["committee-manager"] = new { resolvedUsername = "committee-manager", resolvedName = "Cody Committee-Manager" },
        ["committee-manager-final"] = new { resolvedUsername = "committee-manager", resolvedName = "Cody Committee-Manager" },
        ["secretary"] = new { resolvedUsername = "secretary", resolvedName = "Sally Secretary" },
        ["ambitious"] = new { resolvedUsername = "ambitious-committee", resolvedName = "Amira Committee-Member" },
        ["candidates"] = new { candidateName = "Jordan Candidate", position = "Software Engineer" },
        ["employees"] = new { resolvedUsername = "employee", resolvedName = "Emma Employee" },
        ["provision"] = new { provisioned = true, accountId = "IT-" + Guid.NewGuid().ToString("N")[..8] },
    };

    private static readonly Random Rng = new();

    /// <summary>
    /// GET /api/demo/lookup/{key} - deliberately flaky (~25% chance of a 503) so recreated
    /// flows that route Error/UnSuccessful into a retry Timer actually get exercised when you
    /// test them, instead of always taking the happy path on the first try.
    /// </summary>
    [HttpGet("lookup/{key}")]
    public IActionResult Lookup(string key)
    {
        if (Rng.NextDouble() < 0.25)
            return StatusCode(503, new { error = "Simulated transient failure - try again shortly." });

        var body = Lookups.TryGetValue(key, out var value)
            ? value
            : new { note = $"No canned lookup for '{key}' - add one in DemoController.Lookups, or point this node at your real endpoint." };

        return Ok(body);
    }

    /// <summary>
    /// POST/PUT /api/demo/action/{key} - always succeeds; echoes back whatever the instance's
    /// data looked like at call time (stands in for "UpdateStatus", "CloseRequest", etc).
    /// </summary>
    [HttpPost("action/{key}")]
    [HttpPut("action/{key}")]
    public async Task<IActionResult> Action(string key)
    {
        using var reader = new StreamReader(Request.Body);
        var received = await reader.ReadToEndAsync();
        return Ok(new { status = "ok", action = key, receivedAt = DateTime.UtcNow, echo = received });
    }

    /// <summary>
    /// POST /api/demo/soap - a minimal mock SOAP endpoint for InvokeSoapService nodes to test
    /// against. Echoes back a canned SOAP envelope; doesn't actually parse the request body
    /// (a real SOAP service obviously would) - this is purely so you can see the real HTTP
    /// round-trip and ResultVariable storage work before wiring up an actual WSDL endpoint.
    /// </summary>
    [HttpPost("soap")]
    public IActionResult Soap()
    {
        const string envelope = """
            <?xml version="1.0" encoding="utf-8"?>
            <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
              <soap:Body>
                <LookupResponse>
                  <Status>OK</Status>
                  <Value>demo-soap-result</Value>
                </LookupResponse>
              </soap:Body>
            </soap:Envelope>
            """;
        return Content(envelope, "text/xml");
    }
}
