# S3Coin (Ticker: S3) - ESP32-S3 Proof-of-Work Blockchain

**S3Coin** là một hệ thống cryptocurrency và blockchain Proof-of-Work (PoW) thật 100%, được thiết kế tối ưu hóa cho vi điều khiển **ESP32-S3** (Dual-Core Xtensa LX7 @ 240MHz) sử dụng thuật toán băm **SHA-256** với khả năng tăng tốc phần cứng thông qua `mbedtls`.

---

## ⚡ Các Nguyên Tắc Cốt Lõi (Strict PoW Rules)
- **Proof-of-Work THẬT**: Không giả lập, không `Math.random()`, không fake hash/nonce.
- **ESP32-S3 Hardware Mining**: ESP32-S3 chạy loop tính SHA-256 brute-force hàng loạt nonce liên tục trên 2 nhân (FreeRTOS) cho đến khi tìm được block thỏa `hash <= target`.
- **Server-Authoritative Verification**: Server **KHÔNG BAO GIỜ** tin hash do client gửi. Server tự ráp canonical header và tự băm lại SHA-256. Nếu sai hash hoặc chưa thỏa target: **REJECT**.
- **Không có Free Coin / Zero Seed**: Mọi tài khoản mới khi đăng ký có số dư chính xác **0.0 S3**. S3Coin chỉ được sinh ra duy nhất từ block PoW hợp lệ được server xác nhận.
- **Không có Transfer**: Không có API chuyển khoản người này sang người khác. Số dư chỉ thay đổi qua Mining Reward hoặc Rút tiền (Withdrawal).
- **Anti-Cheat & Replay Protection**: Chống replay, stale block, duplicate nonce, expired job, tamper difficulty/reward.

---

## 🏗 Kiến Trúc Dự Án

```
s3coin/
├── server.ts                       # Entry point Express.js + Vite middleware
├── src/
│   ├── server/
│   │   ├── database/db.ts          # SQLite database (sql.js Wasm) + JSON Backup & Atomic Transactions
│   │   ├── blockchain/chain.ts     # Blockchain core: SHA-256 header, target 256-bit, halving, retargeting
│   │   ├── mining/jobManager.ts    # Mining jobs, verification logic, anti-cheat, atomic reward payouts
│   │   ├── auth/authController.ts  # Register (0 S3 balance), Login, JWT, Miner Token generator
│   │   ├── withdrawals/            # Balance-locking withdrawals (Bank, MoMo, ZaloPay), refunds on rejection
│   │   └── admin/adminController.ts# Admin metrics, user bans, withdrawal processing, difficulty & rate settings
│   ├── components/                 # React UI components (Dashboard, Explorer, Miner, Admin, Withdrawals)
│   ├── types.ts                    # TypeScript shared interfaces
│   ├── App.tsx                     # Main application layout
│   └── index.css                   # Tailwind CSS modern dark crypto styling
├── esp32/
│   └── S3CoinMiner/
│       └── S3CoinMiner.ino         # Production-ready Arduino C++ firmware for ESP32-S3 (Dual-Core FreeRTOS)
├── test/
│   └── runTests.ts                 # 17 Automated Verification & Security test cases
├── .env.example                    # Environment configuration template
└── README.md                       # Comprehensive guide
```

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Server (Từ Đầu)

### Bước 1: Cài đặt Node.js
Đảm bảo máy của bạn đã cài **Node.js v18+** hoặc v20+:
```bash
node -v
npm -v
```

### Bước 2: Clone & Cài đặt Dependencies
```bash
cd s3coin
npm install
```

### Bước 3: Tạo File Cấu Hình `.env`
Sao chép từ `.env.example`:
```bash
cp .env.example .env
```
Nội dung file `.env`:
```env
PORT=3000
JWT_SECRET=s3coin_super_secure_jwt_secret_key_change_in_prod
DATABASE_PATH=./data/s3coin.sqlite
S3_EXCHANGE_RATE=0.1
MIN_WITHDRAW_VND=100000
BLOCK_TARGET_TIME=120
INITIAL_BLOCK_REWARD=50
HALVING_INTERVAL=1000
JOB_EXPIRY_SECONDS=180
ADMIN_PASSWORD=admin123
```

### Bước 4: Chạy Bộ Test Kiểm Thử Tự Động (Tùy chọn)
Chạy bộ kiểm thử 17 tiêu chuẩn bảo mật và toán học Proof-of-Work:
```bash
npm test
```
*Kết quả sẽ xác nhận: SHA-256 hợp lệ, Genesis block chuẩn, chặn fake hash, chặn duplicate block, tính đúng halving, và chứng minh client không thể tự tạo coin.*

### Bước 5: Khởi Động Server
```bash
# Chế độ phát triển (Dev)
npm run dev

# Hoặc Build & Chạy Production
npm run build
npm start
```
Server sẽ chạy tại `http://localhost:3000` (hoặc IP LAN của máy tính trong mạng WiFi, ví dụ `http://192.168.1.100:3000`).

---

## 💻 Hướng Dẫn Sử Dụng Web Dashboard

1. Mở trình duyệt truy cập: `http://localhost:3000`.
2. Bấm **Register** để tạo tài khoản mới:
   - Tài khoản ban đầu có **0 S3** và **0 blocks mined**.
   - Tài khoản đầu tiên đăng ký sẽ được tự động cấp quyền **Admin**.
3. Vào tab **Miner Setup**:
   - Bạn sẽ thấy **Miner Token** duy nhất của tài khoản mình.
   - Nhấn nút **Copy Token**.
4. *(Tùy chọn)* Thử nghiệm đào ngay trên trình duyệt:
   - Vào tab **Web Miner / Simulator**.
   - Nhấn **Start Web Miner**.
   - Trình duyệt sẽ thực hiện phép tính SHA-256 brute-force thật, gửi block về server để server verify và cộng 50 S3 thật vào tài khoản của bạn!

---

## 🔌 Hướng Dẫn Nạp Firmware Cho ESP32-S3

### 1. Chuẩn bị phần cứng:
- Board **ESP32-S3** (bất kỳ bản ESP32-S3 N8R2, N16R8, WROOM, Zero, v.v.).
- Dây cáp Type-C kết nối máy tính.
- (Tùy chọn) Màn hình OLED SSD1306 0.96 inch I2C (SDA=GPIO 8, SCL=GPIO 9).

### 2. Cài đặt Arduino IDE:
1. Tải và cài đặt **Arduino IDE 2.x**.
2. Thêm ESP32 Board Package trong Board Manager (`esp32` by Espressif Systems).
3. Chọn board: **ESP32S3 Dev Module**.
4. Mở **Library Manager** (Ctrl+Shift+I) và cài đặt:
   - `ArduinoJson` (phiên bản 6 hoặc 7)
   - `Adafruit SSD1306` (nếu dùng màn hình OLED)

### 3. Cấu hình firmware:
Mở file `esp32/S3CoinMiner/S3CoinMiner.ino`:
```cpp
const char* WIFI_SSID     = "Ten_WiFi_Nha_Ban";
const char* WIFI_PASSWORD = "Mat_Khau_WiFi";

// Dán Miner Token từ Web Dashboard vào đây
const char* MINER_TOKEN   = "dán_token_64_ký_tự_từ_web_dashboard";

// Địa chỉ IP của máy tính đang chạy server S3Coin
const char* SERVER_URL    = "http://192.168.1.100:3000";
```

### 4. Nạp code và xem kết quả:
1. Nhấn **Upload** trong Arduino IDE.
2. Mở **Serial Monitor** với tốc độ **115200 baud**.
3. ESP32-S3 sẽ:
   - Kết nối vào mạng WiFi.
   - Gửi yêu cầu `GET /api/miner/job` đến server.
   - Khởi chạy 2 worker:
     - Core 0: Tính các nonce chẵn (0, 2, 4, 6...).
     - Core 1: Tính các nonce lẻ (1, 3, 5, 7...).
   - Tốc độ băm hiển thị thời gian thực (khoảng 25,000 - 45,000 H/s tùy xung nhịp).
   - Khi tìm được block thỏa target (`hash <= target`), ESP32 tự động gửi `POST /api/miner/submit`.
   - Server kiểm tra và xác nhận `status: accepted`, cộng ngay reward vào tài khoản web!

---

## 📡 Danh Sách REST APIs

| Phương Thức | Đường Dẫn | Mô Tả |
|---|---|---|
| `POST` | `/api/auth/register` | Đăng ký tài khoản (balance = 0 S3) |
| `POST` | `/api/auth/login` | Đăng nhập lấy JWT Bearer Token |
| `GET` | `/api/me` | Lấy thông tin cá nhân & miner token |
| `GET` | `/api/balance` | Lấy số dư S3 và giá trị quy đổi VND |
| `POST` | `/api/miner/token/regenerate`| Tạo mới miner token |
| `GET` | `/api/miner/job` | ESP32 lấy block template + difficulty + target |
| `POST` | `/api/miner/submit` | ESP32 gửi block PoW để server verify |
| `GET` | `/api/miner/status` | Xem thống kê thiết bị đào của miner token |
| `GET` | `/api/miner/history` | Xem lịch sử các lần submit block (accepted/rejected) |
| `GET` | `/api/blockchain/stats` | Thống kê toàn mạng: tip, difficulty, target, miners |
| `GET` | `/api/blocks` | Danh sách block trên blockchain (phân trang) |
| `GET` | `/api/blocks/:height` | Chi tiết block theo chiều cao hoặc mã băm |
| `POST` | `/api/withdrawals` | Tạo lệnh rút tiền (khóa số dư tức thì) |
| `GET` | `/api/withdrawals` | Lịch sử rút tiền của tài khoản |
| `GET` | `/api/admin/stats` | Thống kê tổng quan hệ thống (Admin) |
| `POST` | `/api/admin/withdrawals/:id/approve` | Duyệt lệnh rút tiền (Admin) |
| `POST` | `/api/admin/withdrawals/:id/pay` | Xác nhận chi trả thành công (Admin) |
| `POST` | `/api/admin/withdrawals/:id/reject`| Từ chối & hoàn trả S3 về ví user (Admin) |
| `POST` | `/api/admin/settings` | Cập nhật tỷ giá VND, độ khó, phần thưởng (Admin) |
| `POST` | `/api/admin/validate-chain` | Kiểm tra tính toàn vẹn 100% blockchain (Admin) |

---

## 🛡️ Cơ Chế Kinh Tế (Tokenomics)
- Tỷ giá mặc định: **1 S3 = 0.1 VND**.
- Rút tối thiểu: **100,000 VND** (= 1,000,000 S3).
- Phần thưởng ban đầu: **50 S3** / block.
- Halving: Giảm 50% phần thưởng sau mỗi **1,000 blocks** (50 -> 25 -> 12.5 -> ...).
- Genesis Block: Reward = **0 S3**.
