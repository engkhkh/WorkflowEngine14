-- Adds the new ActivityLogs table for the persisted execution log feature.
-- Idempotent - safe to run whether or not the table already exists.

USE [WorkflowDb]; -- change if your database is named differently
GO

IF OBJECT_ID(N'[dbo].[ActivityLogs]') IS NULL
BEGIN
    CREATE TABLE [dbo].[ActivityLogs] (
        [Id] bigint IDENTITY(1,1) NOT NULL,
        [InstanceId] nvarchar(450) NOT NULL,
        [DefinitionId] nvarchar(450) NOT NULL,
        [NodeId] nvarchar(450) NOT NULL,
        [NodeName] nvarchar(max) NOT NULL,
        [Action] nvarchar(max) NOT NULL,
        [Actor] nvarchar(max) NULL,
        [Comment] nvarchar(max) NULL,
        [Timestamp] datetime2 NOT NULL,
        CONSTRAINT [PK_ActivityLogs] PRIMARY KEY CLUSTERED ([Id] ASC)
    );

    CREATE INDEX [IX_ActivityLogs_InstanceId] ON [dbo].[ActivityLogs] ([InstanceId]);
    CREATE INDEX [IX_ActivityLogs_Timestamp] ON [dbo].[ActivityLogs] ([Timestamp]);
END
GO

-- Verify
SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ActivityLogs') ORDER BY column_id;
GO
