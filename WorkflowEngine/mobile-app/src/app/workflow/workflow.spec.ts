// generated from desktop-versions/shared/workflow.json - per-node property schema shared by every client
export interface WfProp { key: string; label: string; kind: 'text'|'textarea'|'number'|'bool'|'select'|'assignees'|'assignee1'|'form'|'workflow'; options?: string[]; hint?: string; test?: string; showIf?: { key: string; eq?: string; ne?: string } }
export const WF_PROPS: Record<string, WfProp[]> = {
 "Start": [],
 "End": [],
 "Condition": [
  {
   "key": "conditionExpression",
   "label": "Expression",
   "kind": "text",
   "hint": "e.g. days > 5 && leaveType == Annual. Operators == != > < >= <=, chain with all && or all ||. Outgoing edges are True / False.",
   "test": "condition"
  }
 ],
 "Switch": [
  {
   "key": "switchField",
   "label": "Field to branch on",
   "kind": "text"
  }
 ],
 "ParallelSplit": [],
 "ParallelJoin": [],
 "FormTask": [
  {
   "key": "assignee",
   "label": "Assignees (roles / users)",
   "kind": "assignees",
   "hint": "Multiple targets: whoever acts first completes it for all."
  },
  {
   "key": "priority",
   "label": "Priority",
   "kind": "select",
   "options": [
    "Low",
    "Normal",
    "High",
    "Urgent"
   ]
  },
  {
   "key": "escalateAfterMinutes",
   "label": "Escalate after (minutes)",
   "kind": "number"
  },
  {
   "key": "escalationMode",
   "label": "If it times out",
   "kind": "select",
   "options": [
    "Reassign",
    "AutoComplete",
    "Notify"
   ]
  },
  {
   "key": "useBusinessHours",
   "label": "Count business hours only",
   "kind": "bool"
  },
  {
   "key": "escalateTo",
   "label": "Escalate to",
   "kind": "assignee1",
   "showIf": {
    "key": "escalationMode",
    "ne": "AutoComplete"
   }
  },
  {
   "key": "timeoutDecision",
   "label": "Outcome to auto-fire",
   "kind": "text",
   "showIf": {
    "key": "escalationMode",
    "eq": "AutoComplete"
   },
   "hint": "Must match one of this node's outgoing edge labels."
  },
  {
   "key": "form",
   "label": "Form",
   "kind": "form"
  }
 ],
 "ApprovalTask": [
  {
   "key": "assignee",
   "label": "Assignees (roles / users)",
   "kind": "assignees",
   "hint": "Multiple targets: whoever acts first completes it for all."
  },
  {
   "key": "priority",
   "label": "Priority",
   "kind": "select",
   "options": [
    "Low",
    "Normal",
    "High",
    "Urgent"
   ]
  },
  {
   "key": "escalateAfterMinutes",
   "label": "Escalate after (minutes)",
   "kind": "number"
  },
  {
   "key": "escalationMode",
   "label": "If it times out",
   "kind": "select",
   "options": [
    "Reassign",
    "AutoComplete",
    "Notify"
   ]
  },
  {
   "key": "useBusinessHours",
   "label": "Count business hours only",
   "kind": "bool"
  },
  {
   "key": "escalateTo",
   "label": "Escalate to",
   "kind": "assignee1",
   "showIf": {
    "key": "escalationMode",
    "ne": "AutoComplete"
   }
  },
  {
   "key": "timeoutDecision",
   "label": "Outcome to auto-fire",
   "kind": "text",
   "showIf": {
    "key": "escalationMode",
    "eq": "AutoComplete"
   },
   "hint": "Must match one of this node's outgoing edge labels."
  },
  {
   "key": "form",
   "label": "Form",
   "kind": "form"
  }
 ],
 "WebhookCall": [
  {
   "key": "webhookUrl",
   "label": "URL",
   "kind": "text"
  },
  {
   "key": "webhookMethod",
   "label": "Method",
   "kind": "select",
   "options": [
    "GET",
    "POST",
    "PUT",
    "DELETE"
   ]
  },
  {
   "key": "resultVariable",
   "label": "Store response in data key",
   "kind": "text"
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "InvokeSoapService": [
  {
   "key": "webhookUrl",
   "label": "Service URL",
   "kind": "text"
  },
  {
   "key": "soapAction",
   "label": "SOAPAction",
   "kind": "text"
  },
  {
   "key": "soapEnvelope",
   "label": "SOAP envelope",
   "kind": "textarea"
  },
  {
   "key": "resultVariable",
   "label": "Store response in data key",
   "kind": "text"
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "Automation": [
  {
   "key": "scriptLanguage",
   "label": "Script language",
   "kind": "select",
   "options": [
    "",
    "JavaScript",
    "CSharp"
   ],
   "hint": "JavaScript is sandboxed. C# runs with FULL trust - only publish scripts an admin reviewed. Empty = stub."
  },
  {
   "key": "scriptBody",
   "label": "Script",
   "kind": "textarea",
   "showIf": {
    "key": "scriptLanguage",
    "ne": ""
   }
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "FileOperations": [
  {
   "key": "fileOperation",
   "label": "Operation",
   "kind": "select",
   "options": [
    "Read",
    "Write",
    "Copy",
    "Move",
    "Delete"
   ]
  },
  {
   "key": "filePath",
   "label": "File path",
   "kind": "text"
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "XmlAction": [
  {
   "key": "xmlXPath",
   "label": "XPath",
   "kind": "text"
  },
  {
   "key": "xmlSourceVariable",
   "label": "Source data key",
   "kind": "text"
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "DocumentGeneration": [
  {
   "key": "documentTemplate",
   "label": "Template",
   "kind": "text"
  },
  {
   "key": "documentName",
   "label": "Document name",
   "kind": "text"
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "DatabaseActivity": [
  {
   "key": "databaseConnectionName",
   "label": "Connection name",
   "kind": "text"
  },
  {
   "key": "databaseQuery",
   "label": "Query",
   "kind": "textarea"
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "Logger": [
  {
   "key": "logMessage",
   "label": "Message",
   "kind": "text"
  }
 ],
 "SubWorkflow": [
  {
   "key": "subWorkflowDefinitionId",
   "label": "Workflow to invoke",
   "kind": "workflow"
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "Timer": [
  {
   "key": "durationSeconds",
   "label": "Duration (seconds)",
   "kind": "number"
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "Email": [
  {
   "key": "emailTo",
   "label": "To",
   "kind": "text"
  },
  {
   "key": "emailSubject",
   "label": "Subject",
   "kind": "text"
  },
  {
   "key": "emailBody",
   "label": "Body",
   "kind": "textarea"
  },
  {
   "key": "emailIsHtml",
   "label": "Body is HTML",
   "kind": "bool"
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "Notification": [
  {
   "key": "notificationTo",
   "label": "To",
   "kind": "text"
  },
  {
   "key": "notificationMessage",
   "label": "Message",
   "kind": "textarea"
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "SendSms": [
  {
   "key": "smsTo",
   "label": "To (phone)",
   "kind": "text"
  },
  {
   "key": "smsMessage",
   "label": "Message",
   "kind": "textarea"
  },
  {
   "key": "defaultOutcome",
   "label": "Outcome to take (must match an outgoing edge label)",
   "kind": "text",
   "hint": "Stub nodes cannot judge success, so they always follow the edge with this label."
  }
 ],
 "CancelWorkflow": [
  {
   "key": "cancelReason",
   "label": "Reason",
   "kind": "text"
  }
 ]
};
export const WF_COMMON: WfProp[] = [{"key": "name", "label": "Name", "kind": "text"}, {"key": "description", "label": "Description / instructions", "kind": "textarea"}];
