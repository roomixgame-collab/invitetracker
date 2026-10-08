const { config } = require("./config");
const { fetchSnapshot, computeChanges } = require("./invites");
const attribution = require("./attribution");
const storage = require("./storage");

let cache = new Map();
let initialized = false;
let running = false;
let warnedGuildAccess = false;
let warnedReadFailure = false;
let savedSignature = "";
let lastReadOkAt = 0;

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
  let readOk = false;

  try {
    await attribution.processLeaves();

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

    const { snapshot: current, blocked } = await fetchSnapshot(guild);
    if (current === null) {
      if (!warnedReadFailure) {
        warnedReadFailure = true;
        console.log(
          `[INVITE] Leitura de invites falhou${blocked ? " (rate limit)" : ""}; cache e fila preservados.`
        );
      }
      return;
    }
    readOk = true;
    lastReadOkAt = Date.now();
    if (warnedReadFailure) {
      console.log("[INVITE] Leitura de invites voltou ao normal.");
      warnedReadFailure = false;
    }

    if (!initialized) {
      cache = current;
      initialized = true;
      savedSignature = signature(current);
      await storage.setInvites(current);
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
      await storage.setInvites(current);
    }

    const waiting = attribution.pending();
    if (waiting.length > 0) {
      console.log(
        `[INVITE] aguardando crédito de ${waiting.length} entrada(s): ` +
          waiting.map((p) => `${p.member.user.tag} (${Math.round((Date.now() - p.at) / 1000)}s)`).join(", ")
      );
    }
  } finally {
    // Depois do process(), para que um crédito que chegou no mesmo ciclo ainda
    // seja aplicado antes da entrada ser dada como "convite original".
    //
    // Só expira quando a leitura de invites funcionou: se ela falhou, o crédito
    // pode estar a um ciclo de aparecer e expirar agora postaria "entrou pelo
    // convite original" para alguém que foi convidado de verdade. A exceção é a
    // leitura quebrada há mais que o TTL, aí a fila precisa ser limpa senão
    // cresce sem parar.
    const stuck = !readOk && lastReadOkAt > 0 &&
      Date.now() - lastReadOkAt >= config.pendingTtlMs;
    if (readOk || stuck) {
      attribution.expireStale(stuck ? "sem leitura de invites há mais que o TTL" : "");
    }
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

module.exports = { start, tick, listInvites, isReady: () => initialized };
