-- CreateTable
CREATE TABLE `agent_devices` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `last_seen_at` DATETIME(3) NULL,

    INDEX `agent_devices_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `local_links` (
    `id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `path` VARCHAR(512) NOT NULL,
    `status` ENUM('pending', 'active', 'paused') NOT NULL DEFAULT 'pending',
    `approved_at` DATETIME(3) NULL,
    `last_written_version` INTEGER NULL,
    `last_written_shared_version` INTEGER NULL,
    `last_written_at` DATETIME(3) NULL,
    `last_state` ENUM('ok', 'no_config', 'project_mismatch', 'not_ignored', 'symlink', 'modified', 'exposure', 'error') NULL,
    `last_message` VARCHAR(300) NULL,
    `last_state_at` DATETIME(3) NULL,
    `overwrite_requested_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `local_links_project_id_idx`(`project_id`),
    UNIQUE INDEX `local_links_device_id_path_key`(`device_id`, `path`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_devices` ADD CONSTRAINT `agent_devices_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `local_links` ADD CONSTRAINT `local_links_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `agent_devices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `local_links` ADD CONSTRAINT `local_links_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

