-- AlterTable
ALTER TABLE `environments` ADD COLUMN `current_version` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `env_versions` (
    `id` CHAR(36) NOT NULL,
    `environment_id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `env_versions_environment_id_version_key`(`environment_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `env_versions` ADD CONSTRAINT `env_versions_environment_id_fkey` FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
