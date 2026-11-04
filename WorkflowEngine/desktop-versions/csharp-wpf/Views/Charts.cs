using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Small drawn charts for the dashboard and reports. They lay themselves out for right-to-left languages (their own FlowDirection stays left-to-right).</summary>
public static class Charts
{
    public static readonly Brush DimB = new SolidColorBrush(Color.FromRgb(0x64, 0x74, 0x8B));
    public static readonly Pen LinePen = new(new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0)), 1);
    public static Brush Hex(string h) => (Brush)new BrushConverter().ConvertFromString(h)!;

    public static string Compact(double v)
    {
        var a = Math.Abs(v);
        if (a >= 1e6) return (v / 1e6).ToString("0.0", CultureInfo.InvariantCulture) + "M";
        if (a >= 1e3) return (v / 1e3).ToString("0.0", CultureInfo.InvariantCulture) + "k";
        return Math.Round(v).ToString(CultureInfo.InvariantCulture);
    }

    public static FormattedText Ft(Visual v, string text, double size, Brush brush, bool bold = false)
        => new(text ?? "", CultureInfo.CurrentUICulture, Loc.Rtl ? FlowDirection.RightToLeft : FlowDirection.LeftToRight,
               new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, bold ? FontWeights.Bold : FontWeights.Normal, FontStretches.Normal), size, brush, VisualTreeHelper.GetDpi(v).PixelsPerDip);

    public static void Centered(DrawingContext dc, Visual v, string text, double size, Brush brush, double x, double y, double w, bool bold = false)
    {
        var f = Ft(v, text, size, brush, bold);
        f.MaxTextWidth = Math.Max(1, w); f.MaxLineCount = 1; f.Trimming = TextTrimming.CharacterEllipsis;
        dc.DrawText(f, new Point(x + Math.Max(0, (w - f.Width) / 2), y));
    }

    /// <summary>A KPI tile with a coloured edge.</summary>
    public sealed class KpiCard : Border
    {
        private readonly TextBlock _val = new() { Text = "–", FontSize = 22, FontWeight = FontWeights.Bold };
        private readonly TextBlock _hint = new() { FontSize = 11, Foreground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)), TextWrapping = TextWrapping.Wrap };
        public KpiCard(string label, string color, Action? click)
        {
            Background = Brushes.White; BorderBrush = LinePen.Brush; BorderThickness = new Thickness(1); CornerRadius = new CornerRadius(10);
            Padding = new Thickness(14, 8, 10, 8); Margin = new Thickness(0, 0, 10, 10);
            var edge = Hex(color);
            _val.Foreground = edge;
            var st = new StackPanel { Margin = new Thickness(6, 0, 0, 0) };
            st.Children.Add(new TextBlock { Text = label, FontSize = 12, Foreground = DimB });
            st.Children.Add(_val); st.Children.Add(_hint);
            // the coloured edge sits at the start side (left, or right in right-to-left layouts: WPF mirrors HorizontalAlignment.Left)
            var grid = new Grid();
            grid.Children.Add(new Border { Width = 4, Background = edge, CornerRadius = new CornerRadius(2), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(-10, 0, 0, 0) });
            grid.Children.Add(st);
            Child = grid;
            if (click != null) { Cursor = Cursors.Hand; MouseLeftButtonUp += (_, _) => click(); }
        }
        public void Set(string value, string hint = "") { _val.Text = value; _hint.Text = hint; }
        public string Value => _val.Text;
    }

    public sealed record FlowItem(string Key, string Label, string Value, int Count);

    /// <summary>Request > Approval > Purchase > Inventory > Accounting > Reporting with the open documents per stage; click a stage to pick it.</summary>
    public sealed class FlowStrip : FrameworkElement
    {
        private List<FlowItem> _data = new();
        private string _active = "";
        public event Action<string>? Picked;
        public FlowStrip() { Height = 100; FlowDirection = FlowDirection.LeftToRight; Cursor = Cursors.Hand; MinWidth = 300; }
        public void Set(List<FlowItem> d) { _data = d; InvalidateVisual(); }
        public void Click(double px)
        {
            if (_data.Count == 0 || ActualWidth <= 0) return;
            var w = ActualWidth / _data.Count;
            var i = (int)((Loc.Rtl ? ActualWidth - px : px) / w);
            if (i < 0 || i >= _data.Count) return;
            _active = _active == _data[i].Key ? "" : _data[i].Key;
            Picked?.Invoke(_active); InvalidateVisual();
        }
        protected override void OnMouseLeftButtonUp(MouseButtonEventArgs e) { Click(e.GetPosition(this).X); base.OnMouseLeftButtonUp(e); }
        protected override void OnRender(DrawingContext dc)
        {
            dc.DrawRectangle(Brushes.Transparent, null, new Rect(0, 0, ActualWidth, ActualHeight));
            var n = _data.Count; if (n == 0) return;
            var w = ActualWidth / n;
            for (var i = 0; i < n; i++)
            {
                var it = _data[i];
                var x = Loc.Rtl ? ActualWidth - (i + 1) * w : i * w;
                var on = it.Key == _active;
                dc.DrawRoundedRectangle(on ? Hex("#EFF6FF") : Brushes.White, new Pen(on ? Hex("#2563EB") : LinePen.Brush, 1.5), new Rect(x + 4, 4, Math.Max(1, w - 8), ActualHeight - 8), 10, 10);
                Centered(dc, this, it.Count.ToString(CultureInfo.InvariantCulture), 20, Ui.Ink, x + 4, 8, w - 8, true);
                Centered(dc, this, it.Label, 12, DimB, x + 4, 40, w - 8);
                Centered(dc, this, it.Value, 12, DimB, x + 4, 60, w - 8);
            }
        }
    }

    /// <summary>Grouped bars: sales vs purchases per month.</summary>
    public sealed class TrendChart : FrameworkElement
    {
        private List<Bi.Month> _pts = new();
        private readonly string _a, _b;
        private static readonly string[] En = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
        private static readonly string[] Ar = { "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر" };
        public TrendChart(string a, string b) { _a = a; _b = b; Height = 200; FlowDirection = FlowDirection.LeftToRight; }
        public void Set(List<Bi.Month> p) { _pts = p; InvalidateVisual(); }
        protected override void OnRender(DrawingContext dc)
        {
            double W = ActualWidth, H = ActualHeight, L = 46, R = 8, T = 22, B = 26;
            double mx = 1; foreach (var q in _pts) mx = Math.Max(mx, Math.Max(q.Sales, q.Purchases));
            for (var k = 0; k < 5; k++)
            {
                var y = T + (H - T - B) * (1 - k / 4.0);
                dc.DrawLine(LinePen, new Point(L, y), new Point(W - R, y));
                var f = Ft(this, Compact(mx * k / 4), 11, DimB);
                dc.DrawText(f, new Point(L - 6 - f.Width, y - f.Height / 2));
            }
            var n = Math.Max(_pts.Count, 1); var slot = (W - L - R) / n;
            var cols = new[] { Hex("#0EA5E9"), Hex("#8B5CF6") };
            for (var i = 0; i < _pts.Count; i++)
            {
                var q = _pts[i]; var j = Loc.Rtl ? n - 1 - i : i;
                var x0 = L + j * slot; var bw = slot * 0.32;
                var v = new[] { q.Sales, q.Purchases };
                for (var k = 0; k < 2; k++)
                {
                    var h = (H - T - B) * v[k] / mx;
                    dc.DrawRoundedRectangle(cols[k], null, new Rect(x0 + slot * 0.15 + k * (bw + 2), H - B - h, Math.Max(1, bw), Math.Max(0, h)), 3, 3);
                }
                Centered(dc, this, (Loc.Rtl ? Ar : En)[q.Mon - 1], 11, DimB, x0, H - B + 4, slot);
            }
            var lx = Loc.Rtl ? L + 4 : W - R - 250;
            var labs = new[] { _a, _b };
            for (var k = 0; k < 2; k++)
            {
                dc.DrawRoundedRectangle(cols[k], null, new Rect(lx, 5, 10, 10), 2, 2);
                dc.DrawText(Ft(this, labs[k], 11, DimB), new Point(lx + 14, 2));
                lx += 125;
            }
        }
    }

    public sealed record BarRow(string Label, double Value, string Color, string Text);

    /// <summary>Horizontal bars with a label at the start and a value at the end.</summary>
    public sealed class HBars : FrameworkElement
    {
        private List<BarRow> _rows = new();
        public HBars() { Height = 40; FlowDirection = FlowDirection.LeftToRight; }
        public void Set(List<BarRow> r) { _rows = r; Height = Math.Max(40, 26 * r.Count + 8); InvalidateVisual(); }
        protected override void OnRender(DrawingContext dc)
        {
            dc.DrawRectangle(Brushes.Transparent, null, new Rect(0, 0, ActualWidth, ActualHeight));
            if (_rows.Count == 0) { Centered(dc, this, Loc.T("common.noData"), 13, DimB, 0, ActualHeight / 2 - 9, ActualWidth); return; }
            var mx = _rows.Max(r => r.Value); if (mx <= 0) mx = 1;
            var lw = Math.Min(150, ActualWidth * 0.34); var rtl = Loc.Rtl;
            for (var i = 0; i < _rows.Count; i++)
            {
                var r = _rows[i]; var y = 4 + i * 26;
                var lf = Ft(this, r.Label, 12, Ui.Ink); lf.MaxTextWidth = Math.Max(1, lw - 10); lf.MaxLineCount = 1; lf.Trimming = TextTrimming.CharacterEllipsis;
                dc.DrawText(lf, new Point(rtl ? ActualWidth - lw + 2 : lw - 8 - lf.Width, y + 1));
                var span = ActualWidth - lw - 70; var bw = Math.Max(3, span * r.Value / mx); var x = rtl ? ActualWidth - lw - bw : lw;
                dc.DrawRoundedRectangle(Hex(r.Color), null, new Rect(x, y + 3, bw, 14), 4, 4);
                var vf = Ft(this, r.Text, 12, DimB);
                dc.DrawText(vf, new Point(rtl ? x - 6 - vf.Width : x + bw + 6, y + 1));
            }
        }
    }
}
