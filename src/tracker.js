const { config } = require("./config");
const { fetchSnapshot, computeChanges } = require("./invites");
const attribution = require("./attribution");

let cache = new Map();
let running = false;
let warnedGuildAccess = false;

async function tick(client) {
  if (running) return;
  running = true;

  try {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
      if (!warnedGuildAccess) {
        warnedGuildAccess = true;
        console.log(
          `[INVITE] Servidor ${config.guildId} não está no cache. Confira GUILD_ID e se o bot está no servidor.`
        );
      }
      return;
    }

    attribution.expireStale();

    const current = await fetchSnapshot(guild);
    if (current.size === 0 && cache.size === 0) return;

    if (cache.size === 0) {
      cache = current;
      console.log(`[INVITE] Watch init: ${cache.size} invites.`);
      return;
    }

    const changes = computeChanges(cache, current);
    attribution.process(changes);
    cache = current;
  } finally {
    running = false;
  }
}

function start(client) {
  const loop = () => {
    tick(client).catch((err) =>
      console.log("[INVITE] Erro no watch loop:", err.message)
    );
  };

  loop();
  setInterval(loop, config.watchIntervalMs);
  console.log(`[INVITE] Watch rodando a cada ${config.watchIntervalMs}ms.`);
}

module.exports = { start, tick };
