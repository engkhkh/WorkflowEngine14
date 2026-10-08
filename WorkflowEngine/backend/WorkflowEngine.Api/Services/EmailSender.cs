using System.Net;
using System.Net.Mail;

namespace WorkflowEngine.Api.Services;

public interface IEmailSender
{
    /// <summary>True if Smtp:Host is configured in appsettings - lets callers fall back to
    /// the old stub behavior (auto-complete via DefaultOutcome) when nothing's set up yet.</summary>
    bool IsConfigured { get; }

    Task<bool> SendAsync(string to, string subject, string body, bool isHtml);
}

public class SmtpEmailSender : IEmailSender
{
    private readonly IConfiguration _config;
    private readonly ILogger<SmtpEmailSender> _logger;

    public SmtpEmailSender(IConfiguration config, ILogger<SmtpEmailSender> logger)
    {
        _config = config;
        _logger = logger;
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_config["Smtp:Host"]);

    public async Task<bool> SendAsync(string to, string subject, string body, bool isHtml)
    {
        if (!IsConfigured)
        {
            _logger.LogWarning("Email node fired but Smtp:Host isn't configured in appsettings.json - see README's 'Sending real email' section. Skipping actual send.");
            return false;
        }

        try
        {
            var host = _config["Smtp:Host"]!;
            var port = int.Parse(_config["Smtp:Port"] ?? "587");
            var username = _config["Smtp:Username"];
            var password = _config["Smtp:Password"];
            var from = _config["Smtp:FromAddress"] ?? username ?? "no-reply@example.com";
            var fromName = _config["Smtp:FromName"] ?? "WorkflowEngine";
            var enableSsl = bool.Parse(_config["Smtp:EnableSsl"] ?? "true");

            using var client = new SmtpClient(host, port)
            {
                EnableSsl = enableSsl,
                Credentials = string.IsNullOrEmpty(username) ? null : new NetworkCredential(username, password)
            };

            using var message = new MailMessage
            {
                From = new MailAddress(from, fromName),
                Subject = subject,
                Body = body,
                IsBodyHtml = isHtml
            };
            foreach (var addr in to.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                message.To.Add(addr);

            await client.SendMailAsync(message);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send email to {To} with subject {Subject}", to, subject);
            return false;
        }
    }
}
