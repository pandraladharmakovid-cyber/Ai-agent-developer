-- ============================================================================
-- AI DEVELOPER AGENT — LEVEL 2
-- PostgreSQL / Aiven Database Schema
--
-- Authentication is intentionally NOT included.
-- ============================================================================

BEGIN;

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================================
-- PROJECTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT NOT NULL,

    description TEXT,

    source_type TEXT NOT NULL DEFAULT 'empty'
        CHECK (
            source_type IN (
                'empty',
                'upload',
                'files',
                'paste',
                'github'
            )
        ),

    source_name TEXT,

    github_owner TEXT,

    github_repo TEXT,

    github_branch TEXT,

    workspace_path TEXT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_projects_updated_at
    ON projects (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_active
    ON projects (is_active);


-- ============================================================================
-- PROJECT FILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    project_id UUID NOT NULL
        REFERENCES projects(id)
        ON DELETE CASCADE,

    file_path TEXT NOT NULL,

    content TEXT,

    file_size BIGINT NOT NULL DEFAULT 0,

    content_hash TEXT,

    is_directory BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (
        project_id,
        file_path
    )
);


CREATE INDEX IF NOT EXISTS idx_project_files_project_id
    ON project_files (project_id);

CREATE INDEX IF NOT EXISTS idx_project_files_path
    ON project_files (
        project_id,
        file_path
    );


-- ============================================================================
-- AGENT TASKS
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    project_id UUID
        REFERENCES projects(id)
        ON DELETE SET NULL,

    task TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (
            status IN (
                'queued',
                'running',
                'testing',
                'verifying',
                'completed',
                'failed',
                'cancelled'
            )
        ),

    current_stage TEXT,

    provider TEXT,

    model TEXT,

    error_message TEXT,

    started_at TIMESTAMPTZ,

    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_agent_tasks_project_id
    ON agent_tasks (project_id);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_status
    ON agent_tasks (status);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at
    ON agent_tasks (created_at DESC);


-- ============================================================================
-- AGENT STEPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    task_id UUID NOT NULL
        REFERENCES agent_tasks(id)
        ON DELETE CASCADE,

    step_number INTEGER NOT NULL,

    stage TEXT NOT NULL,

    action TEXT,

    tool_name TEXT,

    tool_arguments JSONB,

    tool_result JSONB,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'running',
                'completed',
                'failed',
                'skipped'
            )
        ),

    error_message TEXT,

    started_at TIMESTAMPTZ,

    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_agent_steps_task_id
    ON agent_steps (task_id);

CREATE INDEX IF NOT EXISTS idx_agent_steps_task_step
    ON agent_steps (
        task_id,
        step_number
    );


-- ============================================================================
-- TOOL AUDIT LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS tool_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    task_id UUID
        REFERENCES agent_tasks(id)
        ON DELETE SET NULL,

    tool_name TEXT NOT NULL,

    action_type TEXT,

    risk_level TEXT NOT NULL DEFAULT 'low'
        CHECK (
            risk_level IN (
                'low',
                'medium',
                'high',
                'critical'
            )
        ),

    policy_decision TEXT NOT NULL
        CHECK (
            policy_decision IN (
                'allow',
                'deny',
                'approval_required'
            )
        ),

    success BOOLEAN,

    duration_ms INTEGER,

    error_message TEXT,

    metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_tool_audit_task_id
    ON tool_audit_log (task_id);

CREATE INDEX IF NOT EXISTS idx_tool_audit_created_at
    ON tool_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_audit_tool_name
    ON tool_audit_log (tool_name);


-- ============================================================================
-- AGENT ARTIFACTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    task_id UUID NOT NULL
        REFERENCES agent_tasks(id)
        ON DELETE CASCADE,

    project_id UUID
        REFERENCES projects(id)
        ON DELETE SET NULL,

    artifact_type TEXT NOT NULL,

    file_path TEXT,

    name TEXT,

    content TEXT,

    metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_agent_artifacts_task_id
    ON agent_artifacts (task_id);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_project_id
    ON agent_artifacts (project_id);


-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS projects_updated_at
    ON projects;

CREATE TRIGGER projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS project_files_updated_at
    ON project_files;

CREATE TRIGGER project_files_updated_at
BEFORE UPDATE ON project_files
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS agent_tasks_updated_at
    ON agent_tasks;

CREATE TRIGGER agent_tasks_updated_at
BEFORE UPDATE ON agent_tasks
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- COMPLETE
-- ============================================================================

COMMIT;