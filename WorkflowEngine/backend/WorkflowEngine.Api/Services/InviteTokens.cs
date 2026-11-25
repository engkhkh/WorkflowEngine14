using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Services;

/// <summary>
/// Invitation links (like Odoo's "invite by e-mail"): a signed, 7-day token that names the user. The invited person opens the link, picks a password and is signed in.
/// Stateless - nothing is stored; a token only works while the account still has no password, so it can be used once.
/// </summary>
public static class InviteTokens
{
    private const string Audience = "invite";

    private static SymmetricSecurityKey Key(IConfiguration cfg) => new(Encoding.UTF8.GetBytes(cfg.GetSection("Jwt")["Key"]!));

    public static string Create(IConfiguration cfg, User user)
    {
        var token = new JwtSecurityToken(
            issuer: cfg.GetSection("Jwt")["Issuer"], audience: Audience,
            claims: new[] { new Claim("uid", user.Id), new Claim("purpose", "invite") },
            expires: DateTime.UtcNow.AddDays(7),
            signingCredentials: new SigningCredentials(Key(cfg), SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>The user id inside a valid, unexpired invitation token; null for anything else.</summary>
    public static string? ReadUserId(IConfiguration cfg, string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        try
        {
            var p = new JwtSecurityTokenHandler().ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuer = true, ValidIssuer = cfg.GetSection("Jwt")["Issuer"],
                ValidateAudience = true, ValidAudience = Audience,
                ValidateLifetime = true, ClockSkew = TimeSpan.FromMinutes(1),
                ValidateIssuerSigningKey = true, IssuerSigningKey = Key(cfg)
            }, out _);
            return p.FindFirst("purpose")?.Value == "invite" ? p.FindFirst("uid")?.Value : null;
        }
        catch { return null; }
    }
}
