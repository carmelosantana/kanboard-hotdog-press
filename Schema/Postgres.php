<?php
namespace Kanboard\Plugin\HotDogPress\Schema;

const VERSION = 1;

function version_1($pdo)
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS hotdogpress_zines (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        document TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS hotdogpress_zines_project_idx ON hotdogpress_zines(project_id)');
}
