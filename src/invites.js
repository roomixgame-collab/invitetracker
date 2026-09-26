const { PermissionFlagsBits } = require("discord.js");

let warnedPermissions = false;
let warnedFetchFailure = false;

function toEntry(invite) {
  const inviter = invite.inviter;
  return {
    uses: invite.uses,
    inviter,
    name: inviter ? inviter.tag ?? `@${inviter.username}` : "(sem dono)",
  };
}

async function fetchFromGuild(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    for (const invite of invites.values()) {
      map.set(invite.code, toEntry(invite));
    }
    return map;
  } catch (err) {
    if (!warnedFetchFailure) {
      warnedFetchFailure = true;
      console.log(
        `[INVITE] guild.invites.fetch() falhou: ${err.message}. Tentando por canal (precisa de MANAGE_CHANNELS).`
      );
    }
    return null;
  }
}

async function fetchFromChannels(guild) {
  const me = guild.members?.me;
  if (!me) {
    console.log(
      "[INVITE] guild.members.me indisponível (falta Guild Members Intent?). Não dá para ler invites por canal."
    );
    return null;
  }

  const map = new Map();
  let readAny = false;

  for (const channel of guild.channels.cache.values()) {
    if (
      !("invites" in channel) ||
      !channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)
    ) {
      continue;
    }
    try {
      const channelInvites = await channel.invites.fetch();
      readAny = true;
      for (const invite of channelInvites.values()) {
        map.set(invite.code, toEntry(invite));
      }
    } catch {
      continue;
    }
  }

  return readAny ? map : null;
}

async function fetchSnapshot(guild) {
  let snapshot = await fetchFromGuild(guild);
  if (snapshot === null) {
    snapshot = await fetchFromChannels(guild);
  }

  if (snapshot === null) {
    if (!warnedPermissions) {
      warnedPermissions = true;
      console.log(
        "[INVITE] ATENÇÃO: não consegui ler os invites agora. O bot precisa de MANAGE_GUILD no servidor, ou MANAGE_CHANNELS nos canais. O cache será preservado até a leitura voltar."
      );
    }
    return null;
  }

  if (warnedPermissions || warnedFetchFailure) {
    console.log("[INVITE] Leitura de invites normalizada.");
  }
  warnedPermissions = false;
  warnedFetchFailure = false;

  return snapshot;
}

function computeChanges(previous, current) {
  const increased = [];
  const created = [];
  const deleted = [];

  for (const [code, entry] of previous) {
    const now = current.get(code);
    if (!now) {
      deleted.push({
        code,
        inviter: entry.inviter,
        name: entry.name,
        prevUses: entry.uses,
      });
    } else if (now.uses > entry.uses) {
      increased.push({
        code,
        inviter: now.inviter,
        name: now.name,
        delta: now.uses - entry.uses,
        prevUses: entry.uses,
      });
    }
  }

  for (const [code, entry] of current) {
    if (!previous.has(code) && entry.uses > 0) {
      created.push({
        code,
        inviter: entry.inviter,
        name: entry.name,
        uses: entry.uses,
      });
    }
  }

  return { increased, created, deleted };
}

function hasChanges(changes) {
  return (
    changes.increased.length +
      changes.created.length +
      changes.deleted.length >
    0
  );
}

module.exports = { fetchSnapshot, computeChanges, hasChanges };
