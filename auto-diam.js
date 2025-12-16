/**
 * ============================================
 * DIAM TESTNET AUTO BOT
 * Auto Faucet 24h + Auto Send DIAM
 * user.txt | wallet.txt | proxy.txt
 * ============================================
 */

import axios from "axios";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

// ================= CONFIG =================
const API_BASE = "https://campapi.diamante.io/api/v1";
const CHECK_INTERVAL = 60 * 1000;            // 1 menit
const FAUCET_INTERVAL = 24 * 60 * 60 * 1000; // 24 jam
const STATE_FILE = "./state.json";

// =========================================

let state = {
  lastFaucet: 0,
  accessToken: "",
  userId: "",
  wallet: ""
};

// ---------- UTIL ----------
const log = msg =>
  console.log(`[${new Date().toLocaleString()}] ${msg}`);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const readLines = file =>
  fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n").map(v => v.trim()).filter(Boolean)
    : [];

// ---------- PROXY ----------
function createAgent(proxy) {
  if (!proxy) return null;
  return proxy.startsWith("socks")
    ? new SocksProxyAgent(proxy)
    : new HttpsProxyAgent(proxy);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- STATE ----------
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  }
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------- LOGIN ----------
async function login(wallet, proxy) {
  log(`Login wallet ${wallet}`);
  const agent = createAgent(proxy);

  const res = await axios.post(
    `${API_BASE}/user/connect-wallet`,
    {
      address: wallet,
      deviceId: "AUTO_BOT",
      deviceSource: "web_app",
      deviceType: "Windows",
      browser: "Chrome"
    },
    agent ? { httpsAgent: agent, httpAgent: agent } : {}
  );

  if (!res.data.success) throw new Error("Login gagal");

  state.userId = res.data.data.userId;
  state.wallet = wallet;

  const cookies = res.headers["set-cookie"];
  const token = cookies?.[0]?.match(/access_token=([^;]+)/)?.[1];
  if (!token) throw new Error("Access token tidak ditemukan");

  state.accessToken = token;
  saveState();

  log("Login sukses");
}

// ---------- BALANCE ----------
async function getBalance(proxy) {
  const agent = createAgent(proxy);
  const res = await axios.get(
    `${API_BASE}/transaction/get-balance/${state.userId}`,
    {
      headers: { Cookie: `access_token=${state.accessToken}` },
      ...(agent ? { httpsAgent: agent, httpAgent: agent } : {})
    }
  );
  return res.data.data.balance || 0;
}

// ---------- FAUCET ----------
async function claimFaucet(proxy) {
  const now = Date.now();
  if (now - state.lastFaucet < FAUCET_INTERVAL) return;

  log("Claim faucet...");
  const agent = createAgent(proxy);

  try {
    const res = await axios.get(
      `${API_BASE}/transaction/fund-wallet/${state.userId}`,
      {
        headers: { Cookie: `access_token=${state.accessToken}` },
        ...(agent ? { httpsAgent: agent, httpAgent: agent } : {})
      }
    );

    if (res.data.success) {
      state.lastFaucet = now;
      saveState();
      log(`Faucet success: ${res.data.data.fundedAmount} DIAM`);
    } else {
      log(`Faucet response: ${res.data.message}`);
    }
  } catch {
    log("Faucet gagal / sudah claim hari ini");
  }
}

// ---------- SEND ----------
async function sendDiam(target, amount, proxy) {
  const agent = createAgent(proxy);
  log(`Send ${amount} DIAM → ${target}`);

  const res = await axios.post(
    `${API_BASE}/transaction/transfer`,
    {
      userId: state.userId,
      toAddress: target,
      amount: Number(amount.toFixed(4))
    },
    {
      headers: {
        Cookie: `access_token=${state.accessToken}`,
        "Content-Type": "application/json"
      },
      ...(agent ? { httpsAgent: agent, httpAgent: agent } : {})
    }
  );

  if (res.data.success) {
    log("Transfer sukses");
  } else {
    log(`Transfer gagal: ${res.data.message}`);
  }
}

// ---------- MAIN ----------
async function main() {
  const users = readLines("user.txt");
  const targets = readLines("wallet.txt");
  const proxies = readLines("proxy.txt");

  if (!users.length) throw new Error("user.txt kosong");
  if (!targets.length) throw new Error("wallet.txt kosong");

  const wallet = users[0]; // 1 account
  loadState();

  if (!state.accessToken || state.wallet !== wallet) {
    await login(wallet, pickRandom(proxies));
  }

  while (true) {
    const proxy = pickRandom(proxies);
    try {
      await claimFaucet(proxy);

      const balance = await getBalance(proxy);
      log(`Balance: ${balance} DIAM`);

      if (balance > 0.001) {
        const target = pickRandom(targets);
        await sendDiam(target, balance, proxy);
      }
    } catch (e) {
      log(`Error: ${e.message}`);
      state.accessToken = "";
      saveState();
    }

    await sleep(CHECK_INTERVAL);
  }
}

main().catch(err => log(err.message));
