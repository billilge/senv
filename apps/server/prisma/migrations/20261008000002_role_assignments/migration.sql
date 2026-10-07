-- CreateTable
CREATE TABLE `role_assignments` (
    `login` VARCHAR(39) NOT NULL,
    `role` ENUM('admin', 'member') NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`login`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

