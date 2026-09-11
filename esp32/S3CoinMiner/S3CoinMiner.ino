/*
 * S3Coin (S3) Official ESP32-S3 Miner Firmware with Web Server & Live Logs
 * Hardware: ESP32-S3 Dual-Core Xtensa LX7 @ 240MHz
 * PoW Algorithm: Native SHA-256 with mbedtls Hardware Acceleration
 * Multithreading: FreeRTOS Dual-Core (Core 0 & Core 1 Nonce Partitioning)
 * 
 * Features:
 * 1. Dual WiFi: Connects to Home WiFi (STA) + Broadcasts its own AP (192.168.4.1)
 * 2. Embedded Web Server: Access http://192.168.4.1 or the local IP on your phone/PC
 *    to view live hashrate, block height, difficulty, and REAL-TIME MINING LOGS!
 * 3. Web Configuration: Change WiFi or Miner Token directly in your browser.
 * 4. NVS Flash Storage: Remembers your credentials across power cycles.
 * 
 * Required Libraries (Standard Arduino ESP32 Board package):
 * - WiFi.h, WebServer.h, Preferences.h, HTTPClient.h, ArduinoJson.h
 */

#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "mbedtls/sha256.h"
#include "esp_system.h"
#include "esp_task_wdt.h"

// =========================================================================
// DEFAULT CONFIGURATION (Can be changed via Web UI at http://192.168.4.1)
// =========================================================================
const char* DEFAULT_WIFI_SSID     = "YOUR_WIFI_SSID";
const char* DEFAULT_WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* DEFAULT_MINER_TOKEN   = "PASTE_YOUR_MINER_TOKEN_HERE";
const char* DEFAULT_SERVER_URL    = "http://192.168.1.100:3000";

// Access Point Details (Connect your phone/laptop to this WiFi to view logs)
const char* AP_SSID_PREFIX        = "S3Coin-Miner-";
const char* AP_PASSWORD           = "s3coin1234"; // At least 8 characters

// Dynamic configuration stored in flash (NVS)
String wifiSsid;
String wifiPass;
String minerToken;
String serverUrl;
String apSSID;

Preferences preferences;
WebServer server(80);

// =========================================================================
// CIRCULAR LOG BUFFER (For Web Console & Serial)
// =========================================================================
#define MAX_LOG_LINES 50
#define LOG_LINE_MAX_LEN 160

char logBuffer[MAX_LOG_LINES][LOG_LINE_MAX_LEN];
int logHead = 0;
int logCount = 0;
portMUX_TYPE logMux = portMUX_INITIALIZER_UNLOCKED;

void addLog(const char* msg) {
  unsigned long nowSec = millis() / 1000;
  unsigned int hrs = nowSec / 3600;
  unsigned int mins = (nowSec % 3600) / 60;
  unsigned int secs = nowSec % 60;

  char formatted[LOG_LINE_MAX_LEN];
  snprintf(formatted, sizeof(formatted), "[%02u:%02u:%02u] %s", hrs, mins, secs, msg);

  // Print to USB Serial Monitor
  Serial.println(formatted);

  // Store in circular buffer for Web Server
  portENTER_CRITICAL(&logMux);
  strncpy(logBuffer[logHead], formatted, LOG_LINE_MAX_LEN - 1);
  logBuffer[logHead][LOG_LINE_MAX_LEN - 1] = '\0';
  logHead = (logHead + 1) % MAX_LOG_LINES;
  if (logCount < MAX_LOG_LINES) logCount++;
  portEXIT_CRITICAL(&logMux);
}

void logf(const char* format, ...) {
  char temp[LOG_LINE_MAX_LEN - 20];
  va_list args;
  va_start(args, format);
  vsnprintf(temp, sizeof(temp), format, args);
  va_end(args);
  addLog(temp);
}

// =========================================================================
// MINING STRUCTURES & STATE
// =========================================================================
struct MiningJob {
  char job_id[64];
  uint32_t height;
  char previous_hash[65];
  uint32_t timestamp;
  uint32_t difficulty;
  char target[65];
  uint32_t version;
  char merkle_root[65];
  float reward;
  uint32_t expires_at;
  bool active;
};

volatile MiningJob currentJob;
portMUX_TYPE jobMux = portMUX_INITIALIZER_UNLOCKED;

// Telemetry
volatile uint64_t totalHashesCore0 = 0;
volatile uint64_t totalHashesCore1 = 0;
volatile uint32_t acceptedBlocks = 0;
volatile uint32_t rejectedBlocks = 0;
volatile bool blockFound = false;

volatile uint32_t winningNonce = 0;
char winningHash[65];
char winningJobId[64];
uint32_t winningHeight = 0;

unsigned long lastHashrateCalcTime = 0;
uint64_t lastTotalHashes = 0;
float currentHashrate = 0.0;

// =========================================================================
// HARDWARE SHA-256 (mbedtls)
// =========================================================================
void calculateSha256(const char* input, size_t length, char* outputHex) {
  unsigned char hash[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0); // 0 = SHA-256
  mbedtls_sha256_update(&ctx, (const unsigned char*)input, length);
  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);

  static const char hexChars[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    outputHex[i * 2]     = hexChars[(hash[i] >> 4) & 0x0F];
    outputHex[i * 2 + 1] = hexChars[hash[i] & 0x0F];
  }
  outputHex[64] = '\0';
}

inline bool satisfiesTarget(const char* hashHex, const char* targetHex) {
  return strcmp(hashHex, targetHex) <= 0;
}

// =========================================================================
// FREERTOS MINING WORKERS (DUAL-CORE)
// =========================================================================
void miningTaskCore0(void* parameter) {
  char headerBuffer[320];
  char hashHex[65];
  uint32_t localNonce = 0; // Even nonces: 0, 2, 4, 6...

  while (true) {
    if (!currentJob.active || blockFound) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    portENTER_CRITICAL(&jobMux);
    int len = snprintf(headerBuffer, sizeof(headerBuffer),
                       "%u:%s:%s:%u:%u:%u",
                       currentJob.version,
                       currentJob.previous_hash,
                       currentJob.merkle_root,
                       currentJob.timestamp,
                       currentJob.difficulty,
                       localNonce);
    char localTarget[65];
    strncpy(localTarget, (const char*)currentJob.target, 65);
    portEXIT_CRITICAL(&jobMux);

    calculateSha256(headerBuffer, len, hashHex);
    totalHashesCore0++;

    if (satisfiesTarget(hashHex, localTarget)) {
      portENTER_CRITICAL(&jobMux);
      if (!blockFound) {
        blockFound = true;
        winningNonce = localNonce;
        strncpy(winningHash, hashHex, 65);
        strncpy(winningJobId, (const char*)currentJob.job_id, 64);
        winningHeight = currentJob.height;
      }
      portEXIT_CRITICAL(&jobMux);
      vTaskDelay(pdMS_TO_TICKS(10));
    }

    localNonce += 2;
    if ((localNonce & 0x0FFF) == 0) {
      vTaskDelay(1); // Yield to prevent WDT trigger
    }
  }
}

void miningTaskCore1(void* parameter) {
  char headerBuffer[320];
  char hashHex[65];
  uint32_t localNonce = 1; // Odd nonces: 1, 3, 5, 7...

  while (true) {
    if (!currentJob.active || blockFound) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    portENTER_CRITICAL(&jobMux);
    int len = snprintf(headerBuffer, sizeof(headerBuffer),
                       "%u:%s:%s:%u:%u:%u",
                       currentJob.version,
                       currentJob.previous_hash,
                       currentJob.merkle_root,
                       currentJob.timestamp,
                       currentJob.difficulty,
                       localNonce);
    char localTarget[65];
    strncpy(localTarget, (const char*)currentJob.target, 65);
    portEXIT_CRITICAL(&jobMux);

    calculateSha256(headerBuffer, len, hashHex);
    totalHashesCore1++;

    if (satisfiesTarget(hashHex, localTarget)) {
      portENTER_CRITICAL(&jobMux);
      if (!blockFound) {
        blockFound = true;
        winningNonce = localNonce;
        strncpy(winningHash, hashHex, 65);
        strncpy(winningJobId, (const char*)currentJob.job_id, 64);
        winningHeight = currentJob.height;
      }
      portEXIT_CRITICAL(&jobMux);
      vTaskDelay(pdMS_TO_TICKS(10));
    }

    localNonce += 2;
    if ((localNonce & 0x0FFF) == 1) {
      vTaskDelay(1); // Yield to prevent WDT trigger
    }
  }
}

// =========================================================================
// EMBEDDED WEB SERVER HTML & APIS
// =========================================================================
const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>S3Coin ESP32-S3 Miner</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #0f172a;
      --border: #1e293b;
      --text: #f1f5f9;
      --cyan: #06b6d4;
      --green: #10b981;
      --amber: #f59e0b;
      --rose: #f43f5e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 16px;
      line-height: 1.5;
    }
    .container { max-width: 800px; margin: 0 auto; }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .brand { font-size: 20px; font-weight: 800; color: var(--text); }
    .brand span { color: var(--cyan); }
    .badge {
      font-size: 11px;
      font-family: monospace;
      padding: 4px 8px;
      background: #164e63;
      color: #a5f3fc;
      border-radius: 6px;
      font-weight: 600;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
    }
    .card-title { font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; margin-bottom: 4px; }
    .card-val { font-size: 22px; font-family: monospace; font-weight: 700; color: #fff; }
    .card-sub { font-size: 11px; color: #64748b; margin-top: 4px; }
    .terminal {
      background: #020617;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 20px;
    }
    .term-title {
      font-size: 12px;
      font-weight: 700;
      color: #38bdf8;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .term-logs {
      height: 260px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 11px;
      color: #cbd5e1;
      white-space: pre-wrap;
      line-height: 1.6;
    }
    .log-line { border-bottom: 1px solid #0f172a; padding: 2px 0; }
    .log-acc { color: var(--green); font-weight: bold; }
    .log-rej { color: var(--rose); font-weight: bold; }
    .log-warn { color: var(--amber); }
    .config-box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
    }
    .config-title { font-size: 14px; font-weight: 700; margin-bottom: 12px; }
    .form-group { margin-bottom: 12px; }
    label { display: block; font-size: 11px; font-weight: 600; color: #94a3b8; margin-bottom: 4px; }
    input {
      width: 100%;
      padding: 8px 12px;
      background: #020617;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: #fff;
      font-family: monospace;
      font-size: 12px;
    }
    button {
      padding: 10px 16px;
      background: var(--cyan);
      color: #082f49;
      font-weight: 700;
      font-size: 12px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      width: 100%;
    }
    button:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">S3Coin <span>ESP32-S3 Miner</span></div>
      <div class="badge" id="statusBadge">ONLINE</div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">Real Hashrate</div>
        <div class="card-val" style="color: var(--cyan);" id="hashrate">-- H/s</div>
        <div class="card-sub" id="hashrateKh">Dual-Core SHA-256</div>
      </div>
      <div class="card">
        <div class="card-title">Block Height</div>
        <div class="card-val" style="color: var(--green);" id="height">#--</div>
        <div class="card-sub" id="diff">Diff: --</div>
      </div>
      <div class="card">
        <div class="card-title">Accepted Blocks</div>
        <div class="card-val" style="color: var(--green);" id="accepted">0</div>
        <div class="card-sub" id="rejected" style="color: var(--rose);">0 Rejected</div>
      </div>
      <div class="card">
        <div class="card-title">Total Hashes</div>
        <div class="card-val" id="totalHashes">0</div>
        <div class="card-sub" id="uptime">Up: 0s</div>
      </div>
    </div>

    <!-- Live Mining Logs Console -->
    <div class="terminal">
      <div class="term-title">
        <span>⚡ Real-Time Proof-of-Work Logs (Live Feed)</span>
      </div>
      <div class="term-logs" id="logsBox">Connecting to ESP32 log stream...</div>
    </div>

    <!-- Device Configuration -->
    <div class="config-box">
      <div class="config-title">Device & Network Configuration</div>
      <form action="/api/config" method="POST">
        <div class="form-group">
          <label>WiFi SSID</label>
          <input type="text" name="ssid" id="cfg_ssid" required>
        </div>
        <div class="form-group">
          <label>WiFi Password</label>
          <input type="password" name="pass" id="cfg_pass">
        </div>
        <div class="form-group">
          <label>Miner Token (From Web Dashboard)</label>
          <input type="text" name="token" id="cfg_token" required>
        </div>
        <div class="form-group">
          <label>S3Coin Server URL</label>
          <input type="text" name="server" id="cfg_server" required>
        </div>
        <button type="submit">Save & Restart ESP32</button>
      </form>
    </div>
  </div>

  <script>
    async function updateData() {
      try {
        const res = await fetch('/api/status');
        const d = await res.json();
        document.getElementById('hashrate').textContent = (d.hashrate >= 1000 ? (d.hashrate/1000).toFixed(1) + ' k' : Math.round(d.hashrate)) + ' H/s';
        document.getElementById('height').textContent = '#' + d.height;
        document.getElementById('diff').textContent = 'Diff: ' + d.diff;
        document.getElementById('accepted').textContent = d.accepted;
        document.getElementById('rejected').textContent = d.rejected + ' Rejected';
        document.getElementById('totalHashes').textContent = Number(d.totalHashes).toLocaleString();
        document.getElementById('uptime').textContent = 'Up: ' + Math.floor(d.uptime) + 's';

        // Pre-fill config if empty
        if (!document.getElementById('cfg_ssid').value && d.ssid) {
          document.getElementById('cfg_ssid').value = d.ssid;
          document.getElementById('cfg_token').value = d.token;
          document.getElementById('cfg_server').value = d.server;
        }
      } catch (e) {}
    }

    async function fetchLogs() {
      try {
        const res = await fetch('/api/logs');
        const d = await res.json();
        const box = document.getElementById('logsBox');
        if (d.logs && d.logs.length > 0) {
          box.innerHTML = d.logs.map(l => {
            let cls = 'log-line';
            if (l.includes('ACCEPTED') || l.includes('REWARD')) cls += ' log-acc';
            else if (l.includes('REJECTED') || l.includes('FAIL')) cls += ' log-rej';
            else if (l.includes('Job') || l.includes('BLOCK')) cls += ' log-warn';
            return `<div class="${cls}">${l}</div>`;
          }).join('');
          box.scrollTop = box.scrollHeight;
        }
      } catch (e) {}
    }

    setInterval(updateData, 1500);
    setInterval(fetchLogs, 1500);
    updateData();
    fetchLogs();
  </script>
</body>
</html>
)rawliteral";

void handleRoot() {
  server.send(200, "text/html", INDEX_HTML);
}

void handleStatusApi() {
  uint64_t total = totalHashesCore0 + totalHashesCore1;
  String json = "{";
  json += "\"hashrate\":" + String(currentHashrate) + ",";
  json += "\"height\":" + String(currentJob.height) + ",";
  json += "\"diff\":" + String(currentJob.difficulty) + ",";
  json += "\"accepted\":" + String(acceptedBlocks) + ",";
  json += "\"rejected\":" + String(rejectedBlocks) + ",";
  json += "\"totalHashes\":" + String((unsigned long)total) + ",";
  json += "\"uptime\":" + String(millis() / 1000) + ",";
  json += "\"ssid\":\"" + wifiSsid + "\",";
  json += "\"token\":\"" + minerToken + "\",";
  json += "\"server\":\"" + serverUrl + "\"";
  json += "}";
  server.send(200, "application/json", json);
}

void handleLogsApi() {
  portENTER_CRITICAL(&logMux);
  String json = "{\"logs\":[";
  int start = (logCount < MAX_LOG_LINES) ? 0 : logHead;
  for (int i = 0; i < logCount; i++) {
    int idx = (start + i) % MAX_LOG_LINES;
    if (i > 0) json += ",";
    json += "\"";
    // Escape quotes
    String s = String(logBuffer[idx]);
    s.replace("\"", "\\\"");
    json += s;
    json += "\"";
  }
  json += "]}";
  portEXIT_CRITICAL(&logMux);
  server.send(200, "application/json", json);
}

void handleConfigApi() {
  if (server.hasArg("ssid")) {
    preferences.putString("ssid", server.arg("ssid"));
    preferences.putString("pass", server.arg("pass"));
    preferences.putString("token", server.arg("token"));
    preferences.putString("server", server.arg("server"));

    logf("[Config] Updated from Web UI. Rebooting ESP32...");
    server.send(200, "text/html", "<h3>Configuration saved! ESP32 is restarting... Reconnect in 10s.</h3>");
    delay(1000);
    ESP.restart();
  } else {
    server.send(400, "text/plain", "Bad Request");
  }
}

// =========================================================================
// MINING PROTOCOL HTTP CLIENT (GET JOB & SUBMIT BLOCK)
// =========================================================================
bool fetchJob() {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = serverUrl + "/api/miner/job";
  http.begin(url);
  http.addHeader("X-Miner-Token", minerToken);
  http.setTimeout(8000);

  int httpCode = http.GET();
  if (httpCode == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, payload);

    if (!error) {
      portENTER_CRITICAL(&jobMux);
      strncpy((char*)currentJob.job_id, doc["job_id"] | "", 64);
      currentJob.height        = doc["height"] | 0;
      strncpy((char*)currentJob.previous_hash, doc["previous_hash"] | "", 65);
      currentJob.timestamp     = doc["timestamp"] | 0;
      currentJob.difficulty    = doc["difficulty"] | 1;
      strncpy((char*)currentJob.target, doc["target"] | "", 65);
      currentJob.version       = doc["version"] | 1;
      strncpy((char*)currentJob.merkle_root, doc["merkle_root"] | "", 65);
      currentJob.reward        = doc["reward"] | 50.0;
      currentJob.expires_at    = doc["expires_at"] | 0;
      currentJob.active        = true;
      blockFound               = false;
      portEXIT_CRITICAL(&jobMux);

      logf("[Miner] Got Job: Block #%u | Diff: %u | Target: %.10s...",
           currentJob.height, currentJob.difficulty, currentJob.target);
      http.end();
      return true;
    }
  } else {
    logf("[Miner] Failed to fetch job. HTTP Code: %d", httpCode);
  }

  http.end();
  return false;
}

bool submitBlock() {
  if (WiFi.status() != WL_CONNECTED) return false;

  logf("[Miner] Submitting Block #%u to server (Nonce: %u)...", winningHeight, winningNonce);

  HTTPClient http;
  String url = serverUrl + "/api/miner/submit";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  DynamicJsonDocument doc(512);
  doc["miner_token"] = minerToken;
  doc["job_id"]      = winningJobId;
  doc["height"]      = winningHeight;
  doc["nonce"]       = winningNonce;
  doc["hash"]        = winningHash;
  doc["device_name"] = "ESP32-S3 Hardware";
  doc["hashrate"]    = (int)currentHashrate;

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  if (httpCode == 200 || httpCode == 201) {
    String response = http.getString();
    DynamicJsonDocument resDoc(512);
    deserializeJson(resDoc, response);

    if (resDoc["success"] == true) {
      acceptedBlocks++;
      float reward = resDoc["reward"] | 0.0;
      logf("[ACCEPTED] >>> BLOCK #%u ACCEPTED! <<< +%.2f S3 Reward credited!", winningHeight, reward);
      http.end();
      return true;
    } else {
      rejectedBlocks++;
      const char* reason = resDoc["reason"] | "Unknown error";
      logf("[REJECTED] Server rejected Block #%u: %s", winningHeight, reason);
    }
  } else {
    rejectedBlocks++;
    logf("[FAIL] Server error during submit. HTTP: %d", httpCode);
  }

  http.end();
  return false;
}

// =========================================================================
// SETUP & MAIN LOOP
// =========================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  logf("==================================================");
  logf("  S3Coin (S3) ESP32-S3 Hardware PoW Miner");
  logf("==================================================");

  // Load preferences from NVS Flash
  preferences.begin("s3coin", false);
  wifiSsid   = preferences.getString("ssid", DEFAULT_WIFI_SSID);
  wifiPass   = preferences.getString("pass", DEFAULT_WIFI_PASS);
  minerToken = preferences.getString("token", DEFAULT_MINER_TOKEN);
  serverUrl  = preferences.getString("server", DEFAULT_SERVER_URL);

  // Generate unique AP SSID based on MAC address
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char apSuffix[10];
  snprintf(apSuffix, sizeof(apSuffix), "%02X%02X", mac[4], mac[5]);
  apSSID = String(AP_SSID_PREFIX) + String(apSuffix);

  // Start Dual WiFi: Station (Home WiFi) + Access Point (For phone/laptop log viewer)
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(apSSID.c_str(), AP_PASSWORD);
  logf("[WiFi AP] Broadcast: %s (Pass: %s)", apSSID.c_str(), AP_PASSWORD);
  logf("[WiFi AP] Web Server IP: http://%s", WiFi.softAPIP().toString().c_str());

  // Connect to Home WiFi
  logf("[WiFi STA] Connecting to %s...", wifiSsid.c_str());
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 15) {
    delay(500);
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    logf("[WiFi STA] Connected! Local IP: http://%s", WiFi.localIP().toString().c_str());
  } else {
    logf("[WiFi STA] Not connected. Connect to AP '%s' to configure WiFi.", apSSID.c_str());
  }

  // Setup Web Server Routes
  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/status", HTTP_GET, handleStatusApi);
  server.on("/api/logs", HTTP_GET, handleLogsApi);
  server.on("/api/config", HTTP_POST, handleConfigApi);
  server.begin();
  logf("[Web Server] HTTP server started on port 80.");

  // Launch Dual-Core FreeRTOS Mining Tasks
  logf("[PoW] Launching FreeRTOS Mining Tasks (Core 0 & Core 1)...");
  xTaskCreatePinnedToCore(miningTaskCore0, "MinerCore0", 8192, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(miningTaskCore1, "MinerCore1", 8192, NULL, 1, NULL, 1);

  lastHashrateCalcTime = millis();
}

void loop() {
  // Handle incoming HTTP requests on Web Server (serves dashboard & live logs)
  server.handleClient();

  // Periodic hashrate calculation every 2 seconds
  unsigned long now = millis();
  if (now - lastHashrateCalcTime >= 2000) {
    uint64_t currentHashes = totalHashesCore0 + totalHashesCore1;
    uint64_t delta = currentHashes - lastTotalHashes;
    float seconds = (now - lastHashrateCalcTime) / 1000.0f;
    currentHashrate = delta / seconds;

    lastTotalHashes = currentHashes;
    lastHashrateCalcTime = now;

    if (currentJob.active) {
      logf("[Status] Rate: %.0f H/s | Block #%u | Nonces tried: %llu",
           currentHashrate, currentJob.height, currentHashes);
    }
  }

  // If a winning block is discovered by Core 0 or Core 1
  if (blockFound) {
    submitBlock();
    fetchJob(); // Fetch next block template
  }

  // If no job is active, fetch one
  if (!currentJob.active && WiFi.status() == WL_CONNECTED) {
    fetchJob();
    delay(1000);
  }

  delay(5);
}
