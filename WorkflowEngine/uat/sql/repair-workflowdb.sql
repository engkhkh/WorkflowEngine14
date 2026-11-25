-- Run in SSMS on INTRANET-DEV01\SQL2016, connected as sa, in the "master" database. It looks at WorkflowDb and applies the matching fix itself.
USE master;
DECLARE @s nvarchar(60), @a nvarchar(60);
SELECT @s = state_desc, @a = user_access_desc FROM sys.databases WHERE name = N'WorkflowDb';
PRINT 'Before: state=' + ISNULL(@s, 'NOT FOUND') + ', access=' + ISNULL(@a, '-');

IF @s IS NULL            PRINT 'WorkflowDb does not exist on this server - nothing to repair (tell Claude).';
ELSE IF @s = 'RESTORING' RESTORE DATABASE [WorkflowDb] WITH RECOVERY;
ELSE IF @s = 'OFFLINE'   ALTER DATABASE [WorkflowDb] SET ONLINE;
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'WorkflowDb' AND state_desc = 'ONLINE' AND user_access_desc <> 'MULTI_USER')
    ALTER DATABASE [WorkflowDb] SET MULTI_USER WITH ROLLBACK IMMEDIATE;

SELECT name, state_desc, user_access_desc, is_read_committed_snapshot_on FROM sys.databases WHERE name = N'WorkflowDb';   -- expect ONLINE / MULTI_USER
