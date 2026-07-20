# HƯỚNG DẪN KẾT NỐI CƠ SỞ DỮ LIỆU MYSQL HOSTINGER (THAY THẾ SUPABASE)

Ứng dụng của bạn hiện tại đã **loại bỏ hoàn toàn Supabase** và chuyển sang cơ chế quản lý dữ liệu lai (Hybrid Database):
1. **Hostinger MySQL Database (Chính)**: Lưu trữ dữ liệu tập trung, bảo mật và đồng nhất cho môi trường sản xuất (production) trên Hostinger.
2. **Local JSON Database (`db.json` - Dự phòng)**: Tự động kích hoạt khi chạy local (Preview) hoặc khi thông tin MySQL chưa được thiết lập/lỗi kết nối, giúp hệ thống luôn hoạt động mượt mà không bị lỗi.

---

## 1. Cấu hình biến môi trường trên Hostinger

Khi triển khai ứng dụng lên Hostinger (Sử dụng Node.js App / Phusion Passenger), bạn cần thiết lập các biến môi trường sau trong bảng điều khiển Hostinger (hoặc tạo file `.env` ở thư mục gốc của dự án trên Hostinger):

```env
# Thông tin kết nối MySQL của Hostinger
MYSQL_HOST="localhost"            # Thường là localhost hoặc IP máy chủ cơ sở dữ liệu của Hostinger
MYSQL_PORT="3306"                 # Cổng mặc định của MySQL
MYSQL_USER="u123456789_admin"     # Tên người dùng MySQL tạo từ hPanel
MYSQL_PASSWORD="MatKhauBaoMat##"  # Mật khẩu người dùng MySQL
MYSQL_DATABASE="u123456789_db"    # Tên cơ sở dữ liệu MySQL tạo từ hPanel
```

> **Lưu ý**: Bạn cần tạo Cơ sở dữ liệu MySQL và Người dùng MySQL tương ứng trong mục **Databases -> MySQL Databases** trên hPanel của Hostinger trước, sau đó điền các thông tin này vào.

---

## 2. Tính năng tự động tạo bảng (Zero-Config Migration)

Bạn **không cần** mất thời gian xuất (export) hay nhập (import) thủ công bất kỳ file `.sql` nào vào phpMyAdmin! 

Ngay khi ứng dụng khởi chạy lần đầu tiên và kết nối thành công tới MySQL của Hostinger, hệ thống sẽ **tự động kiểm tra và tạo đầy đủ 4 bảng dữ liệu** cần thiết:
*   `leaders`: Danh sách lãnh đạo.
*   `schedules`: Lịch công tác.
*   `schedule_participants`: Bảng liên kết lãnh đạo tham gia cuộc họp.
*   `profiles`: Quản lý tài khoản đăng nhập và phân quyền.

Đồng thời, hệ thống sẽ tự động tạo sẵn một tài khoản Admin mặc định nếu bảng `profiles` chưa có tài khoản nào:
*   **Tên đăng nhập (Username)**: `admin`
*   **Mật khẩu mặc định**: `Sonla@2026##`

---

## 3. Giải thích lỗi "Unexpected token '<', '<!DOCTYPE '..." và cách giải quyết

Khi chạy thử trên Hostinger trước đây, bạn gặp lỗi này vì hai nguyên nhân chính:
1. **Lỗi cổng kết nối (Port Socket Path) của Node.js**: Phusion Passenger trên Hostinger truyền tham số cổng `process.env.PORT` dưới dạng một chuỗi văn bản (String). Khi Express khởi chạy `app.listen(PORT)` với tham số chuỗi, Node.js sẽ hiểu nhầm đó là một file socket UNIX chứ không phải cổng mạng TCP, khiến máy chủ không khởi chạy thực sự được. Lúc này, Apache/Passenger trả về trang lỗi HTML mặc định của hệ thống. Client (Vite) cố gắng parse JSON từ trang lỗi HTML này nên tạo ra lỗi `Unexpected token '<'`.
2. **Thời gian chờ kết nối database quá lâu**: Nếu cấu hình MySQL sai, kết nối sẽ bị treo và không khởi động kịp cổng mạng, làm Passenger báo lỗi 502/504 bằng trang HTML.

### Cách chúng tôi đã khắc phục hoàn toàn cho bạn:
1. **Xử lý chuỗi cổng thông minh**: Chúng tôi đã cập nhật mã nguồn khởi chạy mạng trong `server.ts`. Hệ thống tự động kiểm tra xem `PORT` có phải là dạng số (Numeric string) hay không để ép kiểu thành Number trước khi gọi `app.listen()`. Điều này giải quyết triệt để lỗi cổng của Phusion Passenger trên Hostinger!
2. **Ghi lỗi (Debug Log) chi tiết**: Tạo file `server-debug.log` ở thư mục gốc của ứng dụng. Mọi tiến trình khởi động, kết nối MySQL thành công hay thất bại, và bất kỳ lỗi phát sinh nào đều được ghi lại thời gian chi tiết. Bạn có thể mở file này trực tiếp trong **File Manager** của Hostinger để xem lỗi nếu có!

---

## 4. Kiểm tra hoạt động của máy chủ (Debug)

Nếu bạn muốn kiểm tra máy chủ có đang chạy tốt hay không, hãy truy cập đường dẫn sau trên trình duyệt (thay bằng tên miền của bạn):
`https://ten-mien-cua-ban.com/api/health`

Nếu kết quả trả về là `{"status":"ok"}` thì hệ thống backend đã hoạt động hoàn toàn chính xác!
