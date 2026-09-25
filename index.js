const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
} = require("discord.js");

const { config, missingKeys } = require("./src/config");
const tracker = require("./src/tracker");
const attribution = require("./src/attribution");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.GuildMember],
});

function reportStatus() {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) {
    console.log(`[INVITE] Servidor ${config.guildId} não encontrado no cache.`);
    return;
  }

  const perms = guild.members.me?.permissions;
  const hasManageGuild = !!perms?.has(PermissionFlagsBits.ManageGuild);
  const hasManageChannels = !!perms?.has(PermissionFlagsBits.ManageChannels);

  console.log("[INVITE] Permissões do bot no servidor:", {
    manageGuild: hasManageGuild,
    manageChannels: hasManageChannels,
    viewChannel: !!perms?.has(PermissionFlagsBits.ViewChannel),
  });

  if (!hasManageGuild && !hasManageChannels) {
    console.log(
      "[INVITE] AVISO: dê MANAGE_GUILD (ou MANAGE_CHANNELS) pro bot ou nenhum invite será listado."
    );
  }

  const logChannel = guild.channels.cache.get(config.logChannelId);
  if (!logChannel) {
    console.log(
      `[INVITE] AVISO: canal de log ${config.logChannelId} não encontrado. Confira INVITE_LOG_CHANNEL_ID.`
    );
  }
}

client.once("ready", () => {
  console.log(`[INVITE] ${client.user.tag} online!`);
  console.log("[INVITE] Servidor:", config.guildId);
  console.log("[INVITE] Canal de log:", config.logChannelId);
  reportStatus();
  tracker.start(client);
});

client.on("guildMemberAdd", (member) => {
  if (member.guild.id !== config.guildId) return;
  attribution.push(member);
  setTimeout(() => tracker.tick(client), config.joinSettleMs);
});

client.on("error", (err) => console.log("[INVITE] Erro do client:", err.message));
client.on("shardError", (err) => console.log("[INVITE] Erro de shard:", err.message));

process.on("unhandledRejection", (reason) =>
  console.log("[INVITE] Rejeição não tratada:", reason?.message || reason)
);
process.on("uncaughtException", (err) =>
  console.log("[INVITE] Exceção não capturada:", err.message)
);

function main() {
  const missing = missingKeys();
  if (missing.length > 0) {
    console.error(
      "=== CONFIGURAÇÃO FALTANDO ===\n" +
        `Faltando no .env: ${missing.join(", ")}\n` +
        "Copie o .env.example para .env e preencha os valores."
    );
    process.exit(1);
  }

  client.login(config.token).catch((err) => {
    console.log("[INVITE] Falha no login:", err.message);
    process.exit(1);
  });
}

main();
