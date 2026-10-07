-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `github_id` VARCHAR(20) NOT NULL,
    `login` VARCHAR(39) NOT NULL,
    `name` VARCHAR(255) NULL,
    `avatar_url` VARCHAR(512) NULL,
    `role` ENUM('admin', 'member') NOT NULL DEFAULT 'member',
    `status` ENUM('pending', 'active', 'disabled') NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_login_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_github_id_key`(`github_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
