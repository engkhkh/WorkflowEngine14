namespace WorkflowEngine.Api.Services;

/// <summary>
/// The caller's own calendar day. The browser / app sends its UTC offset in minutes (header X-Tz-Offset) with every call, so "today",
/// "this month" and overdue checks follow the time zone of the person using the system - the system runs in any country.
/// A caller that sends nothing (an integration) gets UTC.
/// </summary>
public static class ClientClock
{
    private static readonly AsyncLocal<int> Offset = new();
    public static void Set(string? header) => Offset.Value = int.TryParse(header, out var m) && m is >= -840 and <= 840 ? m : 0;
    public static int OffsetMinutes => Offset.Value;
    public static DateTime Now => DateTime.UtcNow.AddMinutes(Offset.Value);
    public static DateTime Today => Now.Date;
}
