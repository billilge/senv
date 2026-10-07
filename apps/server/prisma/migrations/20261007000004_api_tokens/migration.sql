-- CreateTable
CREATE TABLE `api_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `kind` ENUM('access', 'refresh', 'service') NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `api_tokens_token_hash_key`(`token_hash`),
    INDEX `api_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `api_tokens` ADD CONSTRAINT `api_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
