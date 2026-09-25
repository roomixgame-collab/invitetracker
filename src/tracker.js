const { config } = require("./config");
const { fetchSnapshot, computeChanges } = require("./invites");
const attribution = require("./attribution");
const storage = require("./storage");

let cache = new Map();
let initialized = false;
let running = false;
let warnedGuildAccess = false;
let savedSignature = "";

function signature(map) {
  return [...map.entries()]
    .map(([code, e]) => `${code}:${e.uses}:${e.name}`)
    .join("|");
}

function listInvites() {
  return [...cache.entries()]
    .map(([code, entry]) => ({
      code,
      uses: entry.uses,
      ownerId: entry.inviter ? entry.inviter.id : null,
      ownerName: entry.name,
    }))
    .sort((a, b) => b.uses - a.uses);
}

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

    const current = await fetchSnapshot(guild);
    if (current === null) return;

    if (!initialized) {
      cache = current;
      initialized = true;
      savedSignature = signature(current);
      storage.setInvites(current);
      console.log(
        `[INVITE] Watch init: ${cache.size} invite(s). Diff começa a contar a partir daqui.`
      );
      return;
    }

    const changes = computeChanges(cache, current);
    attribution.process(changes);
    cache = current;

    const next = signature(current);
    if (next !== savedSignature) {
      savedSignature = next;
      storage.setInvites(current);
    }

    attribution.expireStale();

    const waiting = attribution.pending();
    if (waiting.length > 0) {
      console.log(
        `[INVITE] aguardando crédito de ${waiting.length} entrada(s): ` +
          waiting.map((p) => `${p.member.user.tag} (${Math.round((Date.now() - p.at) / 1000)}s)`).join(", ")
      );
    }
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

module.exports = { start, tick, listInvites };
