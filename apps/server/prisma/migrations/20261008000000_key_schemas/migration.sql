-- AlterTable
ALTER TABLE `projects` ADD COLUMN `public_prefixes` VARCHAR(200) NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE `key_schemas` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `type` ENUM('string', 'url', 'number', 'boolean', 'json') NOT NULL DEFAULT 'string',
    `visibility` ENUM('secret', 'public') NOT NULL DEFAULT 'secret',
    `required` BOOLEAN NOT NULL DEFAULT false,
    `optional_in` VARCHAR(64) NOT NULL DEFAULT '',
    `build_time` BOOLEAN NOT NULL DEFAULT false,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` VARCHAR(64) NOT NULL,

    UNIQUE INDEX `key_schemas_project_id_key_key`(`project_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `key_schemas` ADD CONSTRAINT `key_schemas_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

