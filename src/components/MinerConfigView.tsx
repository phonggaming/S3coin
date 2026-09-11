import React, { useState, useEffect } from 'react';
import { User, MinerDevice } from '../types';
import { apiRequest } from '../apiClient';
import {
  Cpu,
  Key,
  Copy,
  Check,
  RefreshCw,
  Download,
  Wifi,
  ExternalLink,
  ShieldCheck,
  Activity,
  Terminal,
  Radio,
  Sliders,
  CheckCircle2,
  Lock,
} from 'lucide-react';

interface MinerConfigViewProps {
  user: User | null;
  onRefreshUser: () => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
}

export const MinerConfigView: React.FC<MinerConfigViewProps> = ({
  user,
  onRefreshUser,
  onOpenAuth,
}) => {
  const [showToken, setShowToken] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [devices, setDevices] = useState<MinerDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);

  const serverUrl = window.location.origin;

  useEffect(() => {
    if (user?.miner_token) {
      setLoadingDevices(true);
      apiRequest<{ device?: MinerDevice; accepted: number; rejected: number }>(
        '/api/miner/status?miner_token=' + user.miner_token
      )
        .then((res) => {
          if (res.device && res.device.ip_address) {
            setDevices([res.device]);
          } else {
            setDevices([]);
          }
        })
        .catch(() => setDevices([]))
        .finally(() => setLoadingDevices(false));
    }
  }, [user]);

  const handleCopyToken = () => {
    if (!user?.miner_token) return;
    navigator.clipboard.writeText(user.miner_token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const handleRegenerateToken = async () => {
    if (
      !window.confirm(
        'Are you sure you want to regenerate your Miner Token? Existing ESP32 devices running the old token will be disconnected.'
      )
    ) {
      return;
    }
    setRegenerating(true);
    try {
      await apiRequest('/api/miner/token/regenerate', { method: 'POST' });
      onRefreshUser();
    } catch (err: any) {
      alert(err.message || 'Failed to regenerate miner token');
    } finally {
      setRegenerating(false);
    }
  };

  const fullFirmwareCode = `/*
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
const char* DEFAULT_MINER_TOKEN   = "${user?.miner_token || 'PASTE_YOUR_MINER_TOKEN_HERE'}";
const char* DEFAULT_SERVER_URL    = "${serverUrl}";

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

  Serial.println(formatted);

  portENTER_CRITICAL(&logMux);
  strncpy(logBuffer[logHead], formatted, LOG_LINE_MAX_LEN - 1);
  logBuffer[logHead][LOG_LINE_MAX_LEN - 1] = '\\0';
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

void calculateSha256(const char* input, size_t length, char* outputHex) {
  unsigned char hash[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);
  mbedtls_sha256_update(&ctx, (const unsigned char*)input, length);
  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);

  static const char hexChars[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    outputHex[i * 2]     = hexChars[(hash[i] >> 4) & 0x0F];
    outputHex[i * 2 + 1] = hexChars[hash[i] & 0x0F];
  }
  outputHex[64] = '\\0';
}

inline bool satisfiesTarget(const char* hashHex, const char* targetHex) {
  return strcmp(hashHex, targetHex) <= 0;
}

void miningTaskCore0(void* parameter) {
  char headerBuffer[320];
  char hashHex[65];
  uint32_t localNonce = 0;

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
    if ((localNonce & 0x0FFF) == 0) vTaskDelay(1);
  }
}

void miningTaskCore1(void* parameter) {
  char headerBuffer[320];
  char hashHex[65];
  uint32_t localNonce = 1;

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
    if ((localNonce & 0x0FFF) == 1) vTaskDelay(1);
  }
}

const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>S3Coin ESP32-S3 Miner</title>
  <style>
    body { background: #090d16; color: #f1f5f9; font-family: sans-serif; padding: 16px; margin: 0; }
    .container { max-width: 700px; margin: 0 auto; }
    .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
    .val { font-size: 24px; font-family: monospace; font-weight: bold; color: #06b6d4; }
    .logs { height: 260px; overflow-y: auto; background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 10px; font-family: monospace; font-size: 11px; white-space: pre-wrap; color: #38bdf8; }
    input { width: 100%; padding: 8px; margin: 4px 0 12px; background: #020617; border: 1px solid #334155; border-radius: 6px; color: #fff; box-sizing: border-box; }
    button { width: 100%; padding: 10px; background: #06b6d4; color: #020617; font-weight: bold; border: none; border-radius: 6px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="container">
    <h2>S3Coin ESP32-S3 Miner</h2>
    <div class="card">
      <div>Hashrate: <span class="val" id="hr">--</span></div>
      <div>Block Height: <span id="ht" style="color:#10b981; font-weight:bold;">--</span> | Acc: <span id="acc" style="color:#10b981;">0</span> | Rej: <span id="rej" style="color:#f43f5e;">0</span></div>
    </div>
    <div class="card">
      <h4>Real-Time Mining Logs Feed</h4>
      <div class="logs" id="logBox">Loading logs from ESP32...</div>
    </div>
    <div class="card">
      <h4>Device Configuration</h4>
      <form action="/api/config" method="POST">
        <label>WiFi SSID</label><input type="text" name="ssid" id="ssid" required>
        <label>WiFi Password</label><input type="password" name="pass" id="pass">
        <label>Miner Token</label><input type="text" name="token" id="tok" required>
        <label>Server URL</label><input type="text" name="server" id="srv" required>
        <button type="submit">Save & Restart ESP32</button>
      </form>
    </div>
  </div>
  <script>
    async function refresh() {
      try {
        const s = await (await fetch('/api/status')).json();
        document.getElementById('hr').textContent = Math.round(s.hashrate) + ' H/s';
        document.getElementById('ht').textContent = '#' + s.height + ' (Diff ' + s.diff + ')';
        document.getElementById('acc').textContent = s.accepted;
        document.getElementById('rej').textContent = s.rejected;
        if (!document.getElementById('ssid').value && s.ssid) {
          document.getElementById('ssid').value = s.ssid;
          document.getElementById('tok').value = s.token;
          document.getElementById('srv').value = s.server;
        }
        const l = await (await fetch('/api/logs')).json();
        if (l.logs) {
          document.getElementById('logBox').textContent = l.logs.join('\\n');
          document.getElementById('logBox').scrollTop = document.getElementById('logBox').scrollHeight;
        }
      } catch(e){}
    }
    setInterval(refresh, 1500);
    refresh();
  </script>
</body>
</html>
)rawliteral";

void handleRoot() { server.send(200, "text/html", INDEX_HTML); }

void handleStatusApi() {
  uint64_t total = totalHashesCore0 + totalHashesCore1;
  String json = "{";
  json += "\\"hashrate\\":" + String(currentHashrate) + ",";
  json += "\\"height\\":" + String(currentJob.height) + ",";
  json += "\\"diff\\":" + String(currentJob.difficulty) + ",";
  json += "\\"accepted\\":" + String(acceptedBlocks) + ",";
  json += "\\"rejected\\":" + String(rejectedBlocks) + ",";
  json += "\\"totalHashes\\":" + String((unsigned long)total) + ",";
  json += "\\"uptime\\":" + String(millis() / 1000) + ",";
  json += "\\"ssid\\":\\"" + wifiSsid + "\\",";
  json += "\\"token\\":\\"" + minerToken + "\\",";
  json += "\\"server\\":\\"" + serverUrl + "\\"";
  json += "}";
  server.send(200, "application/json", json);
}

void handleLogsApi() {
  portENTER_CRITICAL(&logMux);
  String json = "{\\"logs\\":[";
  int start = (logCount < MAX_LOG_LINES) ? 0 : logHead;
  for (int i = 0; i < logCount; i++) {
    int idx = (start + i) % MAX_LOG_LINES;
    if (i > 0) json += ",";
    json += "\\"";
    String s = String(logBuffer[idx]);
    s.replace("\\"", "\\\\\\\"");
    json += s;
    json += "\\"";
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
    server.send(200, "text/html", "<h3>Saved! Restarting ESP32...</h3>");
    delay(1000);
    ESP.restart();
  } else {
    server.send(400, "text/plain", "Bad Request");
  }
}

bool fetchJob() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(serverUrl + "/api/miner/job");
  http.addHeader("X-Miner-Token", minerToken);
  http.setTimeout(8000);
  int code = http.GET();
  if (code == 200) {
    DynamicJsonDocument doc(1024);
    if (!deserializeJson(doc, http.getString())) {
      portENTER_CRITICAL(&jobMux);
      strncpy((char*)currentJob.job_id, doc["job_id"] | "", 64);
      currentJob.height     = doc["height"] | 0;
      strncpy((char*)currentJob.previous_hash, doc["previous_hash"] | "", 65);
      currentJob.timestamp  = doc["timestamp"] | 0;
      currentJob.difficulty = doc["difficulty"] | 1;
      strncpy((char*)currentJob.target, doc["target"] | "", 65);
      currentJob.version    = doc["version"] | 1;
      strncpy((char*)currentJob.merkle_root, doc["merkle_root"] | "", 65);
      currentJob.reward     = doc["reward"] | 50.0;
      currentJob.active     = true;
      blockFound            = false;
      portEXIT_CRITICAL(&jobMux);
      logf("[Miner] Got Job: Block #%u | Target: %.8s...", currentJob.height, currentJob.target);
      http.end();
      return true;
    }
  }
  http.end();
  return false;
}

bool submitBlock() {
  if (WiFi.status() != WL_CONNECTED) return false;
  logf("[Miner] Submitting Block #%u (Nonce: %u)...", winningHeight, winningNonce);
  HTTPClient http;
  http.begin(serverUrl + "/api/miner/submit");
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
  int code = http.POST(body);
  if (code == 200 || code == 201) {
    DynamicJsonDocument resDoc(512);
    deserializeJson(resDoc, http.getString());
    if (resDoc["success"] == true) {
      acceptedBlocks++;
      logf("[ACCEPTED] >>> BLOCK #%u ACCEPTED! <<< +%.2f S3", winningHeight, (float)resDoc["reward"]);
      http.end();
      return true;
    } else {
      rejectedBlocks++;
      logf("[REJECTED] Block #%u rejected: %s", winningHeight, (const char*)resDoc["reason"]);
    }
  } else {
    rejectedBlocks++;
  }
  http.end();
  return false;
}

void setup() {
  Serial.begin(115200);
  preferences.begin("s3coin", false);
  wifiSsid   = preferences.getString("ssid", DEFAULT_WIFI_SSID);
  wifiPass   = preferences.getString("pass", DEFAULT_WIFI_PASS);
  minerToken = preferences.getString("token", DEFAULT_MINER_TOKEN);
  serverUrl  = preferences.getString("server", DEFAULT_SERVER_URL);

  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char apSuffix[10];
  snprintf(apSuffix, sizeof(apSuffix), "%02X%02X", mac[4], mac[5]);
  apSSID = String(AP_SSID_PREFIX) + String(apSuffix);

  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(apSSID.c_str(), AP_PASSWORD);
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());

  logf("[WiFi AP] SSID: %s | Web IP: http://%s", apSSID.c_str(), WiFi.softAPIP().toString().c_str());

  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/status", HTTP_GET, handleStatusApi);
  server.on("/api/logs", HTTP_GET, handleLogsApi);
  server.on("/api/config", HTTP_POST, handleConfigApi);
  server.begin();

  xTaskCreatePinnedToCore(miningTaskCore0, "MinerCore0", 8192, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(miningTaskCore1, "MinerCore1", 8192, NULL, 1, NULL, 1);
  lastHashrateCalcTime = millis();
}

void loop() {
  server.handleClient();
  unsigned long now = millis();
  if (now - lastHashrateCalcTime >= 2000) {
    uint64_t currentHashes = totalHashesCore0 + totalHashesCore1;
    uint64_t delta = currentHashes - lastTotalHashes;
    currentHashrate = delta / ((now - lastHashrateCalcTime) / 1000.0f);
    lastTotalHashes = currentHashes;
    lastHashrateCalcTime = now;
  }
  if (blockFound) {
    submitBlock();
    fetchJob();
  }
  if (!currentJob.active && WiFi.status() == WL_CONNECTED) {
    fetchJob();
    delay(1000);
  }
  delay(5);
}`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(fullFirmwareCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleDownloadIno = () => {
    const element = document.createElement('a');
    const file = new Blob([fullFirmwareCode], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = 'S3CoinMiner.ino';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  if (!user) {
    return (
      <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center mx-auto text-cyan-400">
          <Cpu className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white">ESP32-S3 Miner Configuration</h2>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Please log in or register to receive your unique 64-character Miner Token and download pre-configured firmware.
        </p>
        <button
          onClick={() => onOpenAuth('login')}
          className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 cursor-pointer"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Strict Hardware Mining Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/40 via-cyan-950/30 to-slate-900 border border-amber-800/40 flex items-start gap-3">
        <Lock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <div className="font-bold text-amber-300">
            Hardware-Only Proof-of-Work Mining Enforced
          </div>
          <p className="text-slate-300 leading-relaxed">
            To preserve economic scarcity and prevent unfair coin accumulation, browser/web mining is permanently disabled.
            All S3Coin blocks must be mined by physical <strong>ESP32-S3 microcontrollers</strong> performing real dual-core SHA-256 computation with elevated target difficulty.
          </p>
        </div>
      </div>

      {/* Miner Token Box */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800/60 text-cyan-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Your Personal Miner Token</h2>
              <p className="text-xs text-slate-400">
                Flash this token onto your ESP32-S3 boards so every validated block reward credits straight to your wallet.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRegenerateToken}
              disabled={regenerating}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
              <span>Regenerate</span>
            </button>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
          <div className="font-mono text-xs text-emerald-400 truncate select-all">
            {showToken ? user.miner_token : user.miner_token.slice(0, 8) + '•'.repeat(48) + user.miner_token.slice(-8)}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowToken(!showToken)}
              className="px-2.5 py-1 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
            >
              {showToken ? 'Hide' : 'Reveal'}
            </button>
            <button
              onClick={handleCopyToken}
              className="px-3 py-1 rounded-lg text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1 cursor-pointer"
            >
              {copiedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedToken ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ESP32 WiFi Web Server & Live Log Viewing Instructions */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center gap-2 text-cyan-400 font-bold text-base">
          <Radio className="w-5 h-5 text-cyan-400" />
          <span>ESP32 WiFi Web Server & Live Mining Log Viewer</span>
        </div>
        <p className="text-xs text-slate-400">
          The ESP32-S3 runs an embedded HTTP Web Server directly on port 80. You can view live mining logs, real-time hashrate, and configure WiFi from any phone or PC:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 font-bold text-cyan-300">
              <span className="w-5 h-5 rounded-full bg-cyan-950 text-cyan-400 flex items-center justify-center text-[11px]">1</span>
              <span>Connect to Miner WiFi</span>
            </div>
            <p className="text-slate-400">
              ESP32 automatically broadcasts an Access Point named <code className="text-emerald-400">S3Coin-Miner-XXXX</code>. Connect your phone or laptop (Password: <code className="text-cyan-300">s3coin1234</code>).
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 font-bold text-cyan-300">
              <span className="w-5 h-5 rounded-full bg-cyan-950 text-cyan-400 flex items-center justify-center text-[11px]">2</span>
              <span>Open Web Console</span>
            </div>
            <p className="text-slate-400">
              Open your mobile or desktop web browser and navigate to <strong className="text-white">http://192.168.4.1</strong> (or its local home WiFi IP).
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 font-bold text-cyan-300">
              <span className="w-5 h-5 rounded-full bg-cyan-950 text-cyan-400 flex items-center justify-center text-[11px]">3</span>
              <span>Watch Live PoW Stream</span>
            </div>
            <p className="text-slate-400">
              Inspect real-time dual-core SHA-256 logs, tested nonces, current target, block submissions, and accepted/rejected notifications.
            </p>
          </div>
        </div>
      </div>

      {/* Connected Hardware Telemetry */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-white text-base">Your Active ESP32-S3 Miners</h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {devices.length} {devices.length === 1 ? 'Device' : 'Devices'} Online
          </span>
        </div>

        {devices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400 font-medium">
                <tr>
                  <th className="pb-2">Device Name</th>
                  <th className="pb-2">IP Address</th>
                  <th className="pb-2">Reported Hashrate</th>
                  <th className="pb-2 text-right">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {devices.map((d, i) => (
                  <tr key={i}>
                    <td className="py-2.5 text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      {d.device_name || 'ESP32-S3 Hardware'}
                    </td>
                    <td className="py-2.5 text-slate-300">{d.ip_address}</td>
                    <td className="py-2.5 text-cyan-400 font-bold">{d.hashrate.toLocaleString()} H/s</td>
                    <td className="py-2.5 text-right text-slate-400 font-sans">
                      {new Date(d.last_seen).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800/80 text-center space-y-2">
            <Cpu className="w-8 h-8 text-slate-600 mx-auto" />
            <div className="text-xs text-slate-300 font-medium">No active ESP32-S3 devices reported yet</div>
            <p className="text-[11px] text-slate-500 max-w-md mx-auto">
              Download the pre-configured firmware below and flash it to your ESP32-S3 board. Once connected to WiFi, it will poll jobs and submit valid blocks automatically.
            </p>
          </div>
        )}
      </div>

      {/* Firmware Code Card */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <Cpu className="w-5 h-5 text-cyan-400" />
              <span>Pre-Configured ESP32-S3 Firmware (S3CoinMiner.ino)</span>
            </h3>
            <p className="text-xs text-slate-400">
              Includes Web Server, WiFi AP+STA mode, live log streaming, and dual-core FreeRTOS mbedtls PoW.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyCode}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCode ? 'Code Copied' : 'Copy All Code'}</span>
            </button>
            <button
              onClick={handleDownloadIno}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download S3CoinMiner.ino</span>
            </button>
          </div>
        </div>

        <div className="relative rounded-xl bg-slate-950 border border-slate-800 overflow-hidden font-mono text-xs text-slate-300">
          <pre className="p-4 overflow-x-auto max-h-80">{fullFirmwareCode}</pre>
        </div>
      </div>
    </div>
  );
};
