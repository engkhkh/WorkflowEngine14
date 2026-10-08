namespace WorkflowEngine.Api.Services;

/// <summary>
/// Mirrors a pattern found in the metadata of Skelta_HWS.dll (Skelta.Calendar.BusinessHours.*,
/// Timeout.GetActivityTimeoutDateTime) and Skelta_BAM.dll (HelperClass.GetBuisinessHoursDateTime,
/// ProcessBAM.CalculateBusinessHours): escalation/SLA deadlines computed against configured work
/// hours and work days, not raw wall-clock time, so "escalate after 2 days" doesn't fire in the
/// middle of a weekend or overnight.
///
/// Deliberately simple: one global calendar (no per-region calendars, no holidays, no timezone
/// conversion - everything is UTC). Configure via appsettings.json's "BusinessHours" section.
/// </summary>
public interface IBusinessHoursCalculator
{
    /// <summary>True once at least <paramref name="requiredMinutes"/> of business time has
    /// passed between <paramref name="startUtc"/> and <paramref name="nowUtc"/>.</summary>
    bool HasElapsedBusinessMinutes(DateTime startUtc, DateTime nowUtc, int requiredMinutes);
}

public class BusinessHoursCalculator : IBusinessHoursCalculator
{
    private readonly HashSet<DayOfWeek> _workDays;
    private readonly TimeSpan _startOfDay;
    private readonly TimeSpan _endOfDay;

    public BusinessHoursCalculator(IConfiguration config)
    {
        var section = config.GetSection("BusinessHours");
        var days = section.GetSection("WorkDays").Get<string[]>()
            ?? new[] { "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday" };
        _workDays = days.Select(d => Enum.Parse<DayOfWeek>(d, ignoreCase: true)).ToHashSet();
        _startOfDay = TimeSpan.FromHours(double.Parse(section["StartHour"] ?? "9"));
        _endOfDay = TimeSpan.FromHours(double.Parse(section["EndHour"] ?? "17"));
    }

    public bool HasElapsedBusinessMinutes(DateTime startUtc, DateTime nowUtc, int requiredMinutes)
    {
        if (nowUtc <= startUtc) return false;
        if (_workDays.Count == 0) return false; // no work days configured - never elapses

        double accumulated = 0;
        var cursor = startUtc;

        // Walk day by day - escalation windows are days, not months. Bounded to 3650
        // iterations as a hard safety net against a pathological config.
        for (var i = 0; i < 3650 && cursor.Date <= nowUtc.Date; i++)
        {
            if (_workDays.Contains(cursor.Date.DayOfWeek))
            {
                var dayStart = cursor.Date + _startOfDay;
                var dayEnd = cursor.Date + _endOfDay;

                // First day: count from the later of (task start, start of business).
                // Later days: cursor is midnight, so this is always dayStart.
                var windowStart = cursor > dayStart ? cursor : dayStart;
                var windowEnd = nowUtc < dayEnd ? nowUtc : dayEnd;

                if (windowEnd > windowStart)
                    accumulated += (windowEnd - windowStart).TotalMinutes;

                if (accumulated >= requiredMinutes) return true;
            }

            cursor = cursor.Date.AddDays(1);
        }

        return accumulated >= requiredMinutes;
    }
}
