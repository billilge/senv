-- CreateTable
CREATE TABLE `projects` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `display_name` VARCHAR(100) NOT NULL,
    `kind` ENUM('app', 'shared') NOT NULL DEFAULT 'app',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `projects_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `environments` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `name` ENUM('local', 'development', 'production') NOT NULL,

    UNIQUE INDEX `environments_project_id_name_key`(`project_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `environments` ADD CONSTRAINT `environments_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
