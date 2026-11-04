using System.Collections.Concurrent;

namespace WorkflowEngine.Api.Services;

/// <summary>
/// Serialises "draw the next number -> save the record" per workspace and kind, so two people creating at the same
/// moment never draw the same auto number. One lock per key, held only for the short draw-and-save.
/// </summary>
public static class NumberingLock
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new();

    private sealed class Releaser : IDisposable
    {
        private SemaphoreSlim? _s;
        public Releaser(SemaphoreSlim s) { _s = s; }
        public void Dispose() { Interlocked.Exchange(ref _s, null)?.Release(); }
    }

    public static async Task<IDisposable> Enter(string key)
    {
        var s = Locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await s.WaitAsync();
        return new Releaser(s);
    }
}
