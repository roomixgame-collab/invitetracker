const { config } = require("./config");
const storage = require("./storage");
const { hasChanges } = require("./invites");

let pendingJoins = [];
let pendingLeaves = [];

function push(member) {
  const duplicate = pendingJoins.some(
    (pending) => pending.member.id === member.id && Date.now() - pending.at < 10_000
  );
  if (duplicate) {
    console.log(
      `[INVITE] ENTRADA redeclarada (ignorando duplicata): ${member.user.tag}`
    );
    return null;
  }

  pendingJoins.push({ member, at: Date.now() });
  console.log(
    `[INVITE] >> ENTRADA registrada (fila=${pendingJoins.length}): ${member.user.tag} (${member.id})`
  );
  return pendingJoins[pendingJoins.length - 1];
}

function buildCredits(changes) {
  const credits = [];
  for (const invite of changes.increased) {
    for (let i = 0; i < invite.delta; i++) {
      credits.push({
        code: invite.code,
        inviter: invite.inviter,
        name: invite.name,
        detail: `uso do invite "${invite.code}" (${invite.prevUses} -> ${invite.prevUses + invite.delta})`,
      });
    }
  }
  for (const invite of changes.created) {
    for (let i = 0; i < invite.uses; i++) {
      credits.push({
        code: invite.code,
        inviter: invite.inviter,
        name: invite.name,
        detail: `invite NOVO criado/registrado "${invite.code}"`,
      });
    }
  }
  return credits.filter((credit) => credit.inviter);
}

function describeChanges(changes) {
  return [
    ...changes.increased.map((c) => `${c.code}+${c.delta} por ${c.name}`),
    ...changes.created.map((c) => `${c.code} criado+${c.uses} por ${c.name}`),
    ...changes.deleted.map((c) => `${c.code} deletado por ${c.name}`),
  ];
}

async function sendLog(guild, message) {
  let channel = guild.channels.cache.get(config.logChannelId);
  if (!channel) {
    try {
      channel = await guild.channels.fetch(config.logChannelId);
    } catch (err) {
      console.log(
        `[INVITE] Não consegui buscar o canal de log ${config.logChannelId}: ${err.message}`
      );
      return;
    }
  }
  if (!channel || !channel.isTextBased()) {
    console.log(
      `[INVITE] Canal de log ${config.logChannelId} não encontrado ou não é de texto.`
    );
    return;
  }
  try {
    await channel.send(message);
    console.log(`[INVITE] >> Mensagem ENVIADA para #${channel.name}.`);
  } catch (err) {
    console.log("[INVITE] Falha ao enviar mensagem:", err.message);
  }
}

async function credit(member, creditInfo) {
  const inviter = creditInfo.inviter;
  await storage.setAttribution(member.id, inviter.id);
  const count = await storage.increment(inviter.id);
  const code = creditInfo.code ? ` pelo invite \`${creditInfo.code}\`` : "";
  const message =
    `O usuário <@${member.id}> entrou no servidor através do usuário ` +
    `<@${inviter.id}>${code} que agora possui ${count} convite(s)!! 🥳🥳`;

  await sendLog(member.guild, message);
  console.log(`[INVITE] RESULTADO: ${message}`);
}

function attribute(member, creditInfo) {
  if (!creditInfo || !creditInfo.inviter) {
    console.log(
      `[INVITE] Sem dono identificável pro join de ${member.user.tag} (${member.id}).`
    );
    return false;
  }
  const detail = creditInfo.detail ?? "invite usado";
  console.log(
    `[INVITE] >> ${member.user.tag} (${member.id}) convidado | ${detail} | criado por ${creditInfo.name} (${creditInfo.inviter.id})`
  );
  credit(member, creditInfo).catch((err) =>
    console.log("[INVITE] Erro ao creditar invite:", err.message)
  );
  return true;
}

function process(changes) {
  if (pendingJoins.length === 0) return;

  if (hasChanges(changes)) {
    console.log(
      `[INVITE] Mudanças (${describeChanges(changes).length}, pendentes=${pendingJoins.length})`,
      describeChanges(changes)
    );
  }

  const credits = buildCredits(changes);
  if (credits.length === 0) return;

  const sorted = pendingJoins.slice().sort((a, b) => a.at - b.at);
  const kept = [];

  for (const pending of sorted) {
    let handled = false;
    const triedInviters = new Set();

    for (let i = 0; i < credits.length; i++) {
      const creditInfo = credits[i];
      if (triedInviters.has(creditInfo.inviter.id)) continue;
      triedInviters.add(creditInfo.inviter.id);

      if (attribute(pending.member, creditInfo)) {
        credits.splice(i, 1);
        handled = true;
        break;
      }
    }

    if (!handled) kept.push(pending);
  }

  pendingJoins = kept;
}

function pushLeave(member) {
  if (
    pendingLeaves.some(
      (pending) => pending.member.id === member.id && Date.now() - pending.at < 10_000
    )
  ) {
    console.log(
      `[INVITE] SAIDA redeclarada (ignorando duplicata): ${member.user.tag}`
    );
    return null;
  }

  pendingLeaves.push({ member, at: Date.now() });
  console.log(
    `[INVITE] << SAIDA registrada (fila=${pendingLeaves.length}): ${member.user.tag} (${member.id})`
  );
  return pendingLeaves[pendingLeaves.length - 1];
}

async function processLeaves() {
  if (pendingLeaves.length === 0) return;

  for (const pending of pendingLeaves) {
    const leaverId = pending.member.id;
    const inviterId = await storage.getAttribution(leaverId);

    if (!inviterId) {
      console.log(
        `[INVITE] SAIDA sem crédito: ${pending.member.user.tag} (${leaverId}) não tem conviedor registrado. Nada descontado.`
      );
      continue;
    }

    if (inviterId === leaverId) {
      console.log(
        `[INVITE] SAIDA ignorada: ${pending.member.user.tag} tinha a si mesmo como conviedor.`
      );
      continue;
    }

    const count = await storage.decrement(inviterId);
    await storage.clearAttribution(leaverId);

    const message =
      `O usuário <@${leaverId}> saiu do servidor, então o usuário <@${inviterId}> ` +
      `perdeu 1 convite e agora possui ${count} convite(s).`;

    console.log(`[INVITE] RESULTADO: ${message}`);
    sendLog(pending.member.guild, message).catch((err) =>
      console.log("[INVITE] Erro ao registrar saída:", err.message)
    );
  }

  pendingLeaves = [];
}

function expireStale() {
  if (pendingJoins.length === 0) return;
  const now = Date.now();
  const stale = pendingJoins.filter(
    (pending) => now - pending.at >= config.pendingTtlMs
  );
  if (stale.length === 0) return;

  for (const pending of stale) {
    console.log(
      `[INVITE] Sem attribution pra ${pending.member.user.tag} (${pending.member.id}) após ${Math.round(
        config.pendingTtlMs / 1000
      )}s. Join ignorado.`
    );
  }

  const staleIds = new Set(stale.map((pending) => pending.member.id));
  pendingJoins = pendingJoins.filter(
    (pending) => !staleIds.has(pending.member.id)
  );
}

module.exports = {
  push,
  pushLeave,
  process,
  processLeaves,
  expireStale,
  pending: () => pendingJoins,
  pendingDepartures: () => pendingLeaves,
};
