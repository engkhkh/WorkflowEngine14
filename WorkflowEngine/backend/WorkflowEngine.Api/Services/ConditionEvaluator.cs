using System.Globalization;
using System.Text.RegularExpressions;

namespace WorkflowEngine.Api.Services;

public class ConditionClauseResult
{
    public string Clause { get; set; } = string.Empty;
    public bool Result { get; set; }
}

public class ConditionEvalResult
{
    public bool Result { get; set; }
    public List<ConditionClauseResult> Clauses { get; set; } = new();
}

/// <summary>
/// Evaluates simple gateway expressions like "amount > 1000", "status == 'Manager'", against
/// the instance data bag - plus a flat chain of clauses joined by all "&&" (every clause must
/// be true) or all "||" (any clause true). Mixing && and || in the same expression isn't
/// supported (no operator precedence) - split into a Condition -> Condition chain in the
/// designer instead if you need that. Swap for a real expression engine (NCalc, JS eval, etc.)
/// if you need more later.
/// </summary>
public static class ConditionEvaluator
{
    private static readonly Regex ClausePattern = new(
        @"^\s*(?<field>[\w\.]+)\s*(?<op>==|!=|>=|<=|>|<)\s*(?<value>.+?)\s*$",
        RegexOptions.Compiled);

    public static bool Evaluate(string? expression, IDictionary<string, object?> data)
        => EvaluateDetailed(expression, data).Result;

    public static ConditionEvalResult EvaluateDetailed(string? expression, IDictionary<string, object?> data)
    {
        if (string.IsNullOrWhiteSpace(expression))
            return new ConditionEvalResult { Result = true };

        if (expression.Contains("&&"))
        {
            var clauses = expression.Split("&&", StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            var results = clauses.Select(c => new ConditionClauseResult { Clause = c, Result = EvaluateClause(c, data) }).ToList();
            return new ConditionEvalResult { Result = results.All(r => r.Result), Clauses = results };
        }

        if (expression.Contains("||"))
        {
            var clauses = expression.Split("||", StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            var results = clauses.Select(c => new ConditionClauseResult { Clause = c, Result = EvaluateClause(c, data) }).ToList();
            return new ConditionEvalResult { Result = results.Any(r => r.Result), Clauses = results };
        }

        var single = EvaluateClause(expression, data);
        return new ConditionEvalResult
        {
            Result = single,
            Clauses = new List<ConditionClauseResult> { new() { Clause = expression, Result = single } }
        };
    }

    private static bool EvaluateClause(string clause, IDictionary<string, object?> data)
    {
        var match = ClausePattern.Match(clause);
        if (!match.Success) return true; // fail open - unrecognised clauses default to true

        var field = match.Groups["field"].Value;
        var op = match.Groups["op"].Value;
        var rawValue = match.Groups["value"].Value.Trim().Trim('\'', '"');

        data.TryGetValue(field, out var actual);

        // Try numeric comparison first.
        if (double.TryParse(rawValue, NumberStyles.Any, CultureInfo.InvariantCulture, out var numValue)
            && TryToDouble(actual, out var actualNum))
        {
            return op switch
            {
                "==" => Math.Abs(actualNum - numValue) < 0.0000001,
                "!=" => Math.Abs(actualNum - numValue) > 0.0000001,
                ">" => actualNum > numValue,
                "<" => actualNum < numValue,
                ">=" => actualNum >= numValue,
                "<=" => actualNum <= numValue,
                _ => true
            };
        }

        // Fall back to string comparison.
        var actualStr = actual?.ToString() ?? string.Empty;
        return op switch
        {
            "==" => string.Equals(actualStr, rawValue, StringComparison.OrdinalIgnoreCase),
            "!=" => !string.Equals(actualStr, rawValue, StringComparison.OrdinalIgnoreCase),
            _ => true
        };
    }

    private static bool TryToDouble(object? value, out double result)
    {
        result = 0;
        if (value is null) return false;
        return double.TryParse(value.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out result);
    }
}
