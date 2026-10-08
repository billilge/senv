-- CreateTable
CREATE TABLE `example_sources` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `installation_id` BIGINT NOT NULL,
    `repo_id` BIGINT NOT NULL,
    `repo_full_name` VARCHAR(200) NOT NULL,
    `path` VARCHAR(512) NOT NULL,
    `last_blob_sha` VARCHAR(64) NULL,
    `last_keys` TEXT NULL,
    `last_added` TEXT NULL,
    `last_removed` TEXT NULL,
    `last_skipped` TEXT NULL,
    `last_result` ENUM('ok', 'not_found', 'no_access', 'too_large', 'error') NULL,
    `last_message` VARCHAR(300) NULL,
    `last_checked_at` DATETIME(3) NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `example_sources_project_id_key`(`project_id`),
    INDEX `example_sources_repo_id_idx`(`repo_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `example_sources` ADD CONSTRAINT `example_sources_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
