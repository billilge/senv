-- CreateTable
CREATE TABLE `target_connections` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `config` TEXT NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `target_connections_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_mappings` (
    `id` CHAR(36) NOT NULL,
    `connection_id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `env` ENUM('local', 'development', 'production') NOT NULL,
    `resource_id` VARCHAR(128) NOT NULL,
    `resource_name` VARCHAR(255) NOT NULL,
    `sync_mode` ENUM('auto', 'manual') NOT NULL DEFAULT 'auto',
    `after_sync` ENUM('auto', 'none', 'restart', 'redeploy') NOT NULL DEFAULT 'auto',
    `unmanaged` ENUM('keep', 'delete') NOT NULL DEFAULT 'keep',
    `include` VARCHAR(500) NOT NULL DEFAULT '',
    `exclude` VARCHAR(500) NOT NULL DEFAULT '',
    `options` VARCHAR(2000) NOT NULL DEFAULT '{}',
    `last_synced_hashes` TEXT NULL,
    `last_synced_version` INTEGER NULL,
    `last_synced_shared_version` INTEGER NULL,
    `last_synced_at` DATETIME(3) NULL,
    `drift_keys` TEXT NULL,
    `drift_checked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `target_mappings_project_id_env_idx`(`project_id`, `env`),
    UNIQUE INDEX `target_mappings_connection_id_resource_id_key`(`connection_id`, `resource_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_runs` (
    `id` CHAR(36) NOT NULL,
    `mapping_id` CHAR(36) NOT NULL,
    `trigger` ENUM('publish', 'manual') NOT NULL,
    `status` ENUM('succeeded', 'skipped', 'failed') NOT NULL,
    `version` INTEGER NOT NULL,
    `shared_version` INTEGER NOT NULL,
    `changed_keys` TEXT NOT NULL,
    `action` VARCHAR(16) NULL,
    `provider_ref` VARCHAR(128) NULL,
    `error` VARCHAR(1000) NULL,
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `actor` VARCHAR(64) NULL,
    `started_at` DATETIME(3) NOT NULL,
    `finished_at` DATETIME(3) NOT NULL,

    INDEX `sync_runs_mapping_id_started_at_idx`(`mapping_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` CHAR(36) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `payload` TEXT NOT NULL,
    `dedupe_key` VARCHAR(128) NULL,
    `status` ENUM('pending', 'running', 'done', 'failed') NOT NULL DEFAULT 'pending',
    `run_at` DATETIME(3) NOT NULL,
    `locked_until` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `jobs_status_run_at_idx`(`status`, `run_at`),
    INDEX `jobs_dedupe_key_idx`(`dedupe_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `target_mappings` ADD CONSTRAINT `target_mappings_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `target_connections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_mappings` ADD CONSTRAINT `target_mappings_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sync_runs` ADD CONSTRAINT `sync_runs_mapping_id_fkey` FOREIGN KEY (`mapping_id`) REFERENCES `target_mappings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

