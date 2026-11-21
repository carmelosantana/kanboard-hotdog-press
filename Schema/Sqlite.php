<?php
namespace Kanboard\Plugin\HotDogPress\Schema;

const VERSION = 1;

function version_1($pdo)
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS hotdogpress_zines (
        "id" INTEGER PRIMARY KEY,
        "project_id" INTEGER NOT NULL,
        "title" VARCHAR(255) NOT NULL,
        "document" TEXT NOT NULL,
        "revision" INTEGER NOT NULL DEFAULT 1,
        "created_by" INTEGER NULL,
        "updated_by" INTEGER NULL,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS hotdogpress_zines_project_idx ON hotdogpress_zines(project_id)');
}
