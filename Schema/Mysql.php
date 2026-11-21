<?php
namespace Kanboard\Plugin\HotDogPress\Schema;

const VERSION = 1;

function version_1($pdo)
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS hotdogpress_zines (
        id INT NOT NULL AUTO_INCREMENT,
        project_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        document MEDIUMTEXT NOT NULL,
        revision INT NOT NULL DEFAULT 1,
        created_by INT NULL,
        updated_by INT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY(id),
        INDEX hotdogpress_zines_project_idx (project_id),
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB CHARSET=utf8mb4');
}
