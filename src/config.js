const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function toInt(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const config = {
  token:
    process.env.BOT_TOKEN ||
    process.env.INVITE_BOT_TOKEN ||
    process.env.DISCORD_TOKEN ||
    "",
  guildId: process.env.GUILD_ID || "",
  logChannelId: process.env.INVITE_LOG_CHANNEL_ID || "",
  dataFile: path.join(__dirname, "..", "data", "invites.json"),
  watchIntervalMs: toInt(process.env.WATCH_INTERVAL_MS, 4000),
  pendingTtlMs: toInt(process.env.PENDING_TTL_MS, 3 * 60 * 1000),
  joinSettleMs: 1500,
};

function missingKeys() {
  const missing = [];
  if (!config.token) missing.push("BOT_TOKEN");
  if (!config.guildId) missing.push("GUILD_ID");
  if (!config.logChannelId) missing.push("INVITE_LOG_CHANNEL_ID");
  return missing;
}

module.exports = { config, missingKeys };
