using WorkflowErp.Services;

namespace WorkflowErp.Pages;

public class DocumentsPage : ListPage
{
    public DocumentsPage() { Title = Loc.T("tab.documents"); }

    protected override async Task Reload()
    {
        var list = await Api.I.Instances();
        Body.Children.Clear();
        Body.Children.Add(Ui.Btn("+ " + Loc.T("docs.new"), async () =>
        {
            var defs = await Api.I.Definitions().ContinueWith(t => t.IsCompletedSuccessfully ? t.Result : new List<WfDefinition>());
            await Navigation.PushAsync(new NewRequestPage(defs));
        }));
        if (list.Count == 0) Body.Children.Add(Ui.Empty(Loc.T("docs.none")));
        foreach (var i in list)
        {
            var inst = i;
            var when = inst.StartedAt.Length >= 16 ? inst.StartedAt[..16].Replace('T', ' ') : inst.StartedAt;
            Body.Children.Add(Ui.Card(new VerticalStackLayout
            {
                Spacing = 4,
                Children = { Ui.Text(inst.DefinitionName, 15, true), Ui.Text(when, 13, false, Ui.Dim), Ui.Chip(inst.Status, Ui.StatusColor(inst.Status)) }
            }, async () =>
            {
                var full = await Api.I.Instance(inst.Id) ?? inst;
                await Navigation.PushAsync(new InstancePage(full));
            }));
        }
    }
}

public class InstancePage : ContentPage
{
    private static View Pad(View v) { v.Margin = new Thickness(14, 0); return v; }
    public InstancePage(WfInstance inst)
    {
        BackgroundColor = Ui.Bg;
        FlowDirection = Loc.Flow;
        Title = inst.DefinitionName;
        var stack = new VerticalStackLayout { Spacing = 2, Padding = new Thickness(0, 12) };
        stack.Children.Add(Pad(Ui.Chip(inst.Status, Ui.StatusColor(inst.Status))));
        stack.Children.Add(new Label { Text = Loc.T("docs.history"), FontAttributes = FontAttributes.Bold, TextColor = Ui.Ink, Margin = new Thickness(14, 12, 14, 0) });
        foreach (var h in inst.History)
        {
            var col = new VerticalStackLayout { Spacing = 2, Children = { Ui.Text($"{h.NodeName} · {h.Action}", 14, true), Ui.Text($"{h.Actor} {h.Timestamp}", 12, false, Ui.Dim) } };
            if (!string.IsNullOrEmpty(h.Comment)) col.Children.Add(Ui.Text(h.Comment!, 13));
            stack.Children.Add(Ui.Card(col));
        }
        if (inst.Status == "Running")
            stack.Children.Add(Ui.Btn(Loc.T("docs.cancel"), async () =>
            {
                if (!await DisplayAlert(Loc.T("docs.cancel"), "", Loc.T("common.yes"), Loc.T("common.no"))) return;
                try { await Api.I.CancelInstance(inst.Id); await Navigation.PopAsync(); }
                catch (Exception e) { await DisplayAlert(Loc.T("common.error"), e.Message, Loc.T("common.ok")); }
            }, danger: true));
        Content = new ScrollView { Content = stack };
    }
}

public class NewRequestPage : ContentPage
{
    public NewRequestPage(List<WfDefinition> defs)
    {
        BackgroundColor = Ui.Bg;
        FlowDirection = Loc.Flow;
        Title = Loc.T("docs.choose");
        WfDefinition? pick = null;
        var cards = new List<Border>();
        var note = new Editor { Placeholder = Loc.T("appr.comment"), AutoSize = EditorAutoSizeOption.TextChanges, TextColor = Ui.Ink };
        var err = new Label { TextColor = Ui.Danger, Margin = new Thickness(14, 4) };
        var stack = new VerticalStackLayout { Spacing = 2, Padding = new Thickness(0, 12) };

        foreach (var d in defs)
        {
            var def = d;
            var col = new VerticalStackLayout { Children = { Ui.Text(def.Name, 15, true) } };
            if (!string.IsNullOrEmpty(def.Description)) col.Children.Add(Ui.Text(def.Description!, 13, false, Ui.Dim));
            Border? card = null;
            card = Ui.Card(col, () =>
            {
                pick = def;
                foreach (var c in cards) c.Stroke = Ui.Line;
                card!.Stroke = Ui.Primary;
            });
            cards.Add(card);
            stack.Children.Add(card);
        }
        stack.Children.Add(Ui.Labeled(Loc.T("appr.comment"), note));
        stack.Children.Add(err);
        stack.Children.Add(Ui.Btn(Loc.T("docs.start"), async () =>
        {
            if (pick == null) return;
            err.Text = "";
            try
            {
                var data = new Dictionary<string, object>();
                if (!string.IsNullOrWhiteSpace(note.Text)) data["note"] = note.Text;
                await Api.I.StartInstance(pick.Id, data);
                await Navigation.PopAsync();
            }
            catch (Exception e) { err.Text = e.Message; }
        }));
        Content = new ScrollView { Content = stack };
    }
}
