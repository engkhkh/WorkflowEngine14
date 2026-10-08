namespace WorkflowEngine.Api.Models;

public enum FormFieldType
{
    Text,
    TextArea,
    Number,
    Date,
    Select,
    Checkbox,
    Email
}

public class FormFieldOption
{
    public string Label { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
}

public class FormField
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Key { get; set; } = string.Empty;   // data key the value is stored under
    public string Label { get; set; } = string.Empty;
    public FormFieldType Type { get; set; } = FormFieldType.Text;
    public bool Required { get; set; }
    public string? Placeholder { get; set; }
    public List<FormFieldOption> Options { get; set; } = new(); // for Select
    public bool ReadOnly { get; set; } // e.g. show data collected earlier in the flow
}

public class FormDefinition
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Title { get; set; } = string.Empty;
    public List<FormField> Fields { get; set; } = new();
}
