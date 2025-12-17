/* =========================
   DIAM TESTNET AUTO BOT
   RED HAND EDITION
   UI OPTIMIZED
========================= */

import blessed from "blessed";
import figlet from "figlet";
import fs from "fs";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { Wallet, getAddress } from "ethers";
import { faker } from "@faker-js/faker";

/* =========================
   CONFIG
========================= */

const API_BASE_URL = "https://campapi.diamante.io/api/v1";
const CONFIG_FILE = "config.json";
const ACCOUNT_DATA_FILE = "account_data.json";
const REFF_DATA_FILE = "reff_data.json";

const CONFIG_DEFAULT_HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "Origin": "https://campaign.diamante.io",
  "Referer": "https://campaign.diamante.io/",
  "User-Agent": "Mozilla/5.0"
};

/* =========================
   STATE
========================= */

let addresses = [];
let proxies = [];
let recipientAddresses = [];
let accountTokens = {};
let accountData = {};
let reffData = [];

let dailyActivityConfig = {
  sendDiamRepetitions: 1,
  minSendAmount: 0.01,
  maxSendAmount: 0.02
};

let transactionLogs = [];
let activityRunning = false;
let isCycleRunning = false;
let shouldStop = false;

let activeProcesses = 0;
let spinnerIndex = 0;
let borderBlinkIndex = 0;
let blinkCounter = 0;

const spinner = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
const borderColors = ["red", "yellow", "magenta"];

/* =========================
   UTILS
========================= */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = a => a ? `${a.slice(0,6)}...${a.slice(-4)}` : "N/A";

function addLog(msg, type="info") {
  const time = new Date().toLocaleTimeString();
  const color =
    type === "error" ? "red-fg" :
    type === "success" ? "green-fg" :
    type === "wait" ? "yellow-fg" :
    "white";
  transactionLogs.push(`{grey-fg}[${time}]{/grey-fg} {${color}}${msg}{/${color}}`);
  updateLogsThrottled();
}

/* =========================
   LOADERS
========================= */

function loadJSON(file, def) {
  if (!fs.existsSync(file)) return def;
  try { return JSON.parse(fs.readFileSync(file)); }
  catch { return def; }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadAddresses() {
  if (!fs.existsSync("user.txt")) return [];
  return fs.readFileSync("user.txt","utf8")
    .split("\n")
    .map(a => a.trim())
    .filter(a => a.startsWith("0x"))
    .map(a => getAddress(a));
}

/* =========================
   UI
========================= */

const screen = blessed.screen({
  smartCSR: true,
  title: "RED HAND BOT"
});

const headerBox = blessed.box({
  top: 0,
  height: 6,
  width: "100%",
  tags: true
});

const statusBox = blessed.box({
  top: 6,
  height: 3,
  width: "100%",
  border: "line",
  style: { border: { fg: "red" }},
  tags: true
});

const walletBox = blessed.box({
  top: 9,
  left: 0,
  width: "40%",
  height: "40%",
  border: "line",
  label: " Wallet ",
  tags: true
});

const logBox = blessed.log({
  top: 9,
  left: "41%",
  width: "59%",
  height: "100%-9",
  border: "line",
  label: " Logs ",
  tags: true,
  scrollable: true
});

const menuBox = blessed.list({
  top: "50%",
  left: 0,
  width: "40%",
  height: "50%",
  border: "line",
  label: " Menu ",
  items: [
    "Start Auto Daily Activity",
    "Refresh Wallet",
    "Clear Logs",
    "Exit"
  ],
  keys: true,
  mouse: true,
  style: { selected: { bg: "red" }}
});

screen.append(headerBox);
screen.append(statusBox);
screen.append(walletBox);
screen.append(logBox);
screen.append(menuBox);

/* =========================
   RENDER OPTIMIZED
========================= */

let renderLock = false;
let logRenderTimer = null;

function safeRender() {
  if (renderLock) return;
  renderLock = true;
  setTimeout(() => {
    screen.render();
    renderLock = false;
  }, 150);
}

function updateLogsThrottled() {
  if (logRenderTimer) return;
  logRenderTimer = setTimeout(() => {
    logBox.setContent(transactionLogs.join("\n"));
    logBox.setScrollPerc(100);
    safeRender();
    logRenderTimer = null;
  }, 200);
}

/* =========================
   HEADER
========================= */

figlet.text("RED HAND", { font: "ANSI Shadow" }, (_, data) => {
  headerBox.setContent(`{center}{bold}{red-fg}${data}{/red-fg}{/bold}{/center}`);
  safeRender();
});

/* =========================
   STATUS LOOP
========================= */

setInterval(() => {
  const running = activityRunning || isCycleRunning;
  const spin = running ? spinner[spinnerIndex++] : "";
  if (spinnerIndex >= spinner.length) spinnerIndex = 0;

  statusBox.setContent(
    `Status: ${running ? `{yellow-fg}${spin} RUNNING{/yellow-fg}` : "{green-fg}IDLE{/green-fg}"}`
  );

  if (running && blinkCounter++ % 3 === 0) {
    statusBox.style.border.fg = borderColors[borderBlinkIndex++ % borderColors.length];
  } else if (!running) {
    statusBox.style.border.fg = "red";
  }

  safeRender();
}, 300);

/* =========================
   MENU
========================= */

menuBox.on("select", async item => {
  const action = item.getText();
  if (action === "Start Auto Daily Activity") {
    activityRunning = true;
    addLog("Daily activity started", "success");
  }
  if (action === "Refresh Wallet") {
    addresses = loadAddresses();
    walletBox.setContent(addresses.map((a,i)=>`${i+1}. ${short(a)}`).join("\n"));
    addLog("Wallet refreshed", "success");
  }
  if (action === "Clear Logs") {
    transactionLogs = [];
    logBox.setContent("");
  }
  if (action === "Exit") {
    process.exit(0);
  }
});

/* =========================
   INIT
========================= */

function init() {
  accountData = loadJSON(ACCOUNT_DATA_FILE, {});
  reffData = loadJSON(REFF_DATA_FILE, []);
  addresses = loadAddresses();

  walletBox.setContent(
    addresses.length
      ? addresses.map((a,i)=>`${i+1}. ${short(a)}`).join("\n")
      : "No wallet loaded"
  );

  addLog("RED HAND BOT READY", "success");
  safeRender();
}

screen.key(["q","C-c","escape"], ()=>process.exit(0));
init();
