-- CreateTable
CREATE TABLE `device_codes` (
    `id` CHAR(36) NOT NULL,
    `device_code_hash` CHAR(64) NOT NULL,
    `user_code` CHAR(8) NOT NULL,
    `status` ENUM('pending', 'approved', 'denied', 'consumed') NOT NULL DEFAULT 'pending',
    `user_id` CHAR(36) NULL,
    `interval_seconds` INTEGER NOT NULL,
    `last_polled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `device_codes_device_code_hash_key`(`device_code_hash`),
    UNIQUE INDEX `device_codes_user_code_key`(`user_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `device_codes` ADD CONSTRAINT `device_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
