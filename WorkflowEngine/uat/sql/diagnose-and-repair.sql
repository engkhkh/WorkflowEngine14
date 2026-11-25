-- Run in SSMS connected to INTRANET-DEV01\SQL2016 (check: SELECT @@SERVERNAME). Step 1: look.
SELECT name, state_desc, user_access_desc, is_read_committed_snapshot_on FROM sys.databases;   -- is WorkflowDb listed? ONLINE? MULTI_USER?
-- Step 2 (only if WorkflowDb is SINGLE_USER or RESTRICTED_USER): put it back
-- USE master; ALTER DATABASE [WorkflowDb] SET MULTI_USER WITH ROLLBACK IMMEDIATE;
-- Step 2b (only if state_desc is OFFLINE):  ALTER DATABASE [WorkflowDb] SET ONLINE;
-- Step 2c (only if state_desc is RESTORING): RESTORE DATABASE [WorkflowDb] WITH RECOVERY;
-- Step 3: check the login can use it
-- USE [WorkflowDb]; SELECT USER_NAME(), IS_SRVROLEMEMBER('sysadmin');
