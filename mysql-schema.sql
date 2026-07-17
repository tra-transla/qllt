-- MySQL Database Schema for "Hệ thống quản lý lịch công tác tuần"
-- Optimized for standard MySQL (e.g., Hostinger MySQL, phpMyAdmin)
-- Character set: utf8mb4 (supports Vietnamese characters fully)

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `schedule_participants`;
DROP TABLE IF EXISTS `schedules`;
DROP TABLE IF EXISTS `leaders`;
DROP TABLE IF EXISTS `profiles`;
SET FOREIGN_KEY_CHECKS = 1;

-- 1. Create table `leaders` (Danh sách Lãnh đạo)
CREATE TABLE `leaders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL COMMENT 'Họ và tên lãnh đạo',
  `position` VARCHAR(255) NOT NULL COMMENT 'Chức vụ',
  `department` VARCHAR(255) NULL COMMENT 'Đơn vị công tác',
  `phone` VARCHAR(50) NULL COMMENT 'Số điện thoại',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Create table `schedules` (Danh sách lịch công tác)
CREATE TABLE `schedules` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `date` DATE NOT NULL COMMENT 'Ngày công tác',
  `time` TIME NOT NULL COMMENT 'Giờ công tác',
  `content` TEXT NOT NULL COMMENT 'Nội dung công việc',
  `program_document` VARCHAR(512) NULL COMMENT 'File chương trình/tài liệu đính kèm',
  `preparation` VARCHAR(512) NULL COMMENT 'Yêu cầu chuẩn bị',
  `location` VARCHAR(255) NOT NULL COMMENT 'Địa điểm',
  `host` VARCHAR(255) NULL COMMENT 'Chủ trì cuộc họp/sự kiện',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Create table `schedule_participants` (Bảng liên kết Lãnh đạo tham gia sự kiện - Quan hệ N-N)
CREATE TABLE `schedule_participants` (
  `schedule_id` INT NOT NULL,
  `leader_id` INT NOT NULL,
  PRIMARY KEY (`schedule_id`, `leader_id`),
  CONSTRAINT `fk_participant_schedule` FOREIGN KEY (`schedule_id`) REFERENCES `schedules` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_participant_leader` FOREIGN KEY (`leader_id`) REFERENCES `leaders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Create table `profiles` (Tài khoản người dùng hệ thống)
CREATE TABLE `profiles` (
  `id` VARCHAR(255) NOT NULL PRIMARY KEY,
  `username` VARCHAR(255) NOT NULL UNIQUE COMMENT 'Tên đăng nhập',
  `password` VARCHAR(255) NOT NULL COMMENT 'Mật khẩu đã mã hóa dạng salt:hash',
  `role` VARCHAR(50) NOT NULL DEFAULT 'editor' COMMENT 'Quyền hạn: admin hoặc editor',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- SEED DATA - DỮ LIỆU MẪU BAN ĐẦU (Tùy chọn)
-- -----------------------------------------------------------------------------

-- Chèn dữ liệu mẫu cho Lãnh đạo
INSERT INTO `leaders` (`id`, `name`, `position`, `department`, `phone`) VALUES
(1, 'Đ/c Nguyễn Hữu Đông', 'Bí thư Tỉnh ủy', 'Tỉnh ủy', '0912.345.678'),
(2, 'Đ/c Lò Minh Hùng', 'Phó Bí thư Thường trực', 'Tỉnh ủy', '0983.456.789'),
(3, 'Đ/c Nguyễn Thái Hưng', 'Chủ tịch HĐND Tỉnh', 'HĐND Tỉnh', '0945.123.456'),
(4, 'Đ/c Hoàng Quốc Khánh', 'Chủ tịch UBND Tỉnh', 'UBND Tỉnh', '0903.987.654');

-- Chèn tài khoản quản trị mặc định (Tên đăng nhập: admin / Mật khẩu mặc định: Sonla@2026##)
-- Chuỗi mật khẩu dưới đây đã được mã hóa bằng thuật toán PBKDF2 tương thích với hệ thống backend Node.js
INSERT INTO `profiles` (`id`, `username`, `password`, `role`) VALUES
('default-admin-uuid-0000-1111-2222', 'admin', '9122f6eda0962737cbfef7d573e9da04:193a7ea8180c6948ea4f573b06ba8671901742721370f724db659580c0cb731c6a3a997d1342bab24f44099cb650e28d2d31ff56f8234599ba3deb2b2b9b10b4', 'admin');
