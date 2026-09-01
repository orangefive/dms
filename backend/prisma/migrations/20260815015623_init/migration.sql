-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(64) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `display_name` VARCHAR(128) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `description` VARCHAR(512) NULL,
    `permissions` JSON NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `user_id` VARCHAR(191) NOT NULL,
    `role_id` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `description` TEXT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_tables` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `description` TEXT NULL,
    `table_type` VARCHAR(32) NOT NULL,
    `external_table_name` VARCHAR(128) NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL,

    INDEX `data_tables_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_fields` (
    `id` VARCHAR(191) NOT NULL,
    `table_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `field_key` VARCHAR(128) NOT NULL,
    `field_type` VARCHAR(32) NOT NULL,
    `config` JSON NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_unique` BOOLEAN NOT NULL DEFAULT false,
    `is_indexed` BOOLEAN NOT NULL DEFAULT false,
    `formula_expression` TEXT NULL,
    `formula_ast` JSON NULL,
    `formula_result_type` VARCHAR(16) NULL,
    `formula_version` INTEGER NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL,

    INDEX `data_fields_table_id_sort_order_idx`(`table_id`, `sort_order`),
    UNIQUE INDEX `data_fields_table_id_field_key_key`(`table_id`, `field_key`),
    UNIQUE INDEX `data_fields_table_id_name_key`(`table_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `table_records` (
    `id` VARCHAR(191) NOT NULL,
    `table_id` VARCHAR(191) NOT NULL,
    `data` JSON NOT NULL,
    `formula_errors` JSON NULL,
    `created_by` VARCHAR(64) NULL,
    `updated_by` VARCHAR(64) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL,

    INDEX `table_records_table_id_created_at_idx`(`table_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `unique_constraints` (
    `id` VARCHAR(191) NOT NULL,
    `table_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `fields` JSON NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `unique_constraints_table_id_idx`(`table_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `unique_values` (
    `id` VARCHAR(191) NOT NULL,
    `constraint_id` VARCHAR(191) NOT NULL,
    `record_id` VARCHAR(191) NOT NULL,
    `values_hash` VARCHAR(64) NOT NULL,
    `values` JSON NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `unique_values_record_id_idx`(`record_id`),
    UNIQUE INDEX `unique_values_constraint_id_values_hash_key`(`constraint_id`, `values_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_keys` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `key_hash` VARCHAR(128) NOT NULL,
    `key_prefix` VARCHAR(24) NOT NULL,
    `scopes` JSON NULL,
    `created_by_id` VARCHAR(191) NOT NULL,
    `expires_at` TIMESTAMP(0) NULL,
    `last_used_at` TIMESTAMP(0) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL,

    UNIQUE INDEX `api_keys_key_hash_key`(`key_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `token_hash` VARCHAR(128) NOT NULL,
    `expires_at` TIMESTAMP(0) NOT NULL,
    `revoked_at` TIMESTAMP(0) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `action` VARCHAR(64) NOT NULL,
    `resource_type` VARCHAR(64) NULL,
    `resource_id` VARCHAR(64) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `detail` JSON NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `audit_logs_created_at_idx`(`created_at`),
    INDEX `audit_logs_action_idx`(`action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_tables` ADD CONSTRAINT `data_tables_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_fields` ADD CONSTRAINT `data_fields_table_id_fkey` FOREIGN KEY (`table_id`) REFERENCES `data_tables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `table_records` ADD CONSTRAINT `table_records_table_id_fkey` FOREIGN KEY (`table_id`) REFERENCES `data_tables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `unique_constraints` ADD CONSTRAINT `unique_constraints_table_id_fkey` FOREIGN KEY (`table_id`) REFERENCES `data_tables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `unique_values` ADD CONSTRAINT `unique_values_constraint_id_fkey` FOREIGN KEY (`constraint_id`) REFERENCES `unique_constraints`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `unique_values` ADD CONSTRAINT `unique_values_record_id_fkey` FOREIGN KEY (`record_id`) REFERENCES `table_records`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
