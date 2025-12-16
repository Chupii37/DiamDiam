/**
 * =================================================
 * DIAM TESTNET AUTO BOT - FINAL VERSION
 * - Auto Faucet (cek dulu, 403 aman)
 * - Auto Send 1% per Wallet (Round-Robin)
 * - Delay setiap send (Human-like)
 * - Proxy Support + Rotation
 * - 24/7 Safe Runner (State Persisted)
 * =================================================
 */

import axios from "axios";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

/* ================== CONFIG ================== */
const API_BASE = "https://campapi.diamante.io/api/v1";
const STATE_FILE = "./state.json";

const CHECK_INTERVAL = 60 * 1000;              // loop utama
const FAUCET_INTERVAL = 24 * 60 * 60 * 1000;   // 24 jam
const SEND_PERCENT = 0.01;                     // 1% per wallet
const MIN_SEND = 0.0001;                       // batas aman kirim

// Delay acak (ms)
const DELAY = {
  short: [3000, 7000],
  medium: [8000, 15000],
  long: [20000, 40000]
};
/* ============================================ */

/* ================= STATE ================= */
let state = {
  wallet: "",
  userId: "",
  accessToken: "",
  lastFaucet: 0,
  targetIndex: 0
};
/* ========================================= */

const log = (m) => console.log(`[${new Date().toLocaleString()}] ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = ([a, b]) => Math.floor(Math.random() * (b - a + 1)) + a;

const readLines = (f) =>
  fs.existsSync(f)
    ? fs.readFileSync(f, "utf8").split("\n").map(v => v.trim()).filter(Boolean)
    : [];

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  }
}
function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ================= PROXY ================= */
function createAgent(proxy) {
  if (!proxy) return null;
  return proxy.startsWith("socks")
    ? new SocksProxyAgent(proxy)
    : new HttpsProxyAgent(proxy);
}
const pick = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;

/* ================= API ================= */
async function api(method, url, proxy, data = null, headers = {}) {
  const agent = createAgent(proxy);
  return axios({
    method,
    url,
    data,
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      ...headers
    },
    ...(agent ? { httpsAgent: agent, httpAgent: agent } : {})
  });
}

/* ================= LOGIN ================= */
async function login(wallet, proxy) {
  log(`Login wallet ${wallet}`);
  const res = await api(
    "post",
    `${API_BASE}/user/connect-wallet`,
    proxy,
    {
      address: wallet,
      deviceId: "AUTO_SAFE",
      deviceSource: "web_app",
      deviceType: "Windows",
      browser: "Chrome"
    }
  );

  if (!res.data?.success) throw new Error("Login gagal");

  const token = res.headers["set-cookie"]?.[0]?.match(/access_token=([^;]+)/)?.[1];
  if (!token) throw new Error("Access token tidak ditemukan");

  state.wallet = wallet;
  state.userId = res.data.data.userId;
  state.accessToken = token;
  saveState();

  log("Login sukses");
}

/* ================= BALANCE ================= */
async function getBalance(proxy) {
  const res = await api(
    "get",
    `${API_BASE}/transaction/get-balance/${state.userId}`,
    proxy,
    null,
    { Cookie: `access_token=${state.accessToken}` }
  );
  return res.data?.data?.balance || 0;
}

/* ================= FAUCET (SAFE) ================= */
async function claimFaucet(proxy) {
  const now = Date.now();
  if (now - state.lastFaucet < FAUCET_INTERVAL) return;

  log("Cek faucet...");
  try {
    const res = await api(
      "get",
      `${API_BASE}/transaction/fund-wallet/${state.userId}`,
      proxy,
      null,
      { Cookie: `access_token=${state.accessToken}` }
    );

    if (res.data?.success) {
      state.lastFaucet = now;
      saveState();
      log(`Faucet sukses: ${res.data.data.fundedAmount} DIAM`);
      return;
    }

    if (res.data?.message?.toLowerCase().includes("once per day")) {
      state.lastFaucet = now;
      saveState();
      log("Faucet sudah diclaim hari ini");
    }
  } catch (e) {
    if (e.response?.status === 403) {
      state.lastFaucet = now;
      saveState();
      log("Faucet sudah diclaim (403)");
      return;
    }
    throw e;
  }
}

/* ================= TARGET (ROUND-ROBIN) ================= */
function getNextTarget(targets) {
  const t = targets[state.targetIndex % targets.length];
  state.targetIndex++;
  saveState();
  return t;
}

/* ================= SEND ================= */
async function sendDiam(target, amount, proxy) {
  log(`Kirim ${amount} DIAM → ${target}`);
  const res = await api(
    "post",
    `${API_BASE}/transaction/transfer`,
    proxy,
    {
      userId: state.userId,
      toAddress: target,
      amount: Number(amount.toFixed(4))
    },
    {
      Cookie: `access_token=${state.accessToken}`,
      "Content-Type": "application/json"
    }
  );

  if (res.data?.success) {
    log("Transfer sukses");
  } else {
    log(`Transfer gagal: ${res.data?.message}`);
  }
}

/* ================= MAIN ================= */
async function main() {
  const users = readLines("user.txt");
  const targets = readLines("wallet.txt");
  const proxies = readLines("proxy.txt");

  if (!users.length) throw new Error("user.txt kosong");
  if (!targets.length) throw new Error("wallet.txt kosong");

  const wallet = users[0];
  loadState();

  if (!state.accessToken || state.wallet !== wallet) {
    await login(wallet, pick(proxies));
    await sleep(rand(DELAY.medium));
  }

  while (true) {
    const proxy = pick(proxies);
    try {
      await claimFaucet(proxy);
      await sleep(rand(DELAY.short));

      let balance = await getBalance(proxy);
      log(`Balance: ${balance} DIAM`);

      // Kirim 1% per wallet selama saldo masih cukup
      while (balance * SEND_PERCENT >= MIN_SEND) {
        const sendAmount = balance * SEND_PERCENT;
        const target = getNextTarget(targets);

        await sleep(rand(DELAY.medium));
        await sendDiam(target, sendAmount, proxy);

        await sleep(rand(DELAY.short));
        balance = await getBalance(proxy);
        log(`Sisa balance: ${balance} DIAM`);
      }

    } catch (e) {
      log(`Error: ${e.message}`);
      state.accessToken = "";
      saveState();
      await sleep(rand(DELAY.long));
      await login(wallet, pick(proxies));
    }

    await sleep(CHECK_INTERVAL + rand([2000, 8000]));
  }
}

main().catch(e => log(e.message));
