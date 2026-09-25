const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const { config, missingKeys } = require("./src/config");
const tracker = require("./src/tracker");
const attribution = require("./src/attribution");
const storage = require("./src/storage");

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

const invitesCommand = new SlashCommandBuilder()
  .setName("invites")
  .setDescription("Mostra todos os convites do servidor: código, usos e dono")
  .addUserOption((opt) =>
    opt
      .setName("usuario")
      .setDescription("Filtra só os convites de uma pessoa")
  )
  .toJSON();

async function registerCommands() {
  try {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    await guild.commands.set([invitesCommand]);
    console.log("[INVITE] Comando /invites registrado.");
  } catch (err) {
    console.log("[INVITE] Falha ao registrar /invites:", err.message);
  }
}

function buildInvitesMessage(filterUserId) {
  const invites = tracker
    .listInvites()
    .filter((i) => !filterUserId || i.ownerId === filterUserId);

  if (invites.length === 0) {
    return filterUserId
      ? "Esse usuário não tem nenhum invite no servidor."
      : "Nenhum invite encontrado no servidor.";
  }

  const totalUses = invites.reduce((sum, i) => sum + i.uses, 0);
  const lines = invites
    .slice(0, 25)
    .map(
      (i) =>
        `\`${i.code}\` · ${i.uses} uso(s) · ${i.ownerId ? `<@${i.ownerId}>` : "sem dono"}`
    );

  const out = [
    `**Convites (${invites.length}, ${totalUses} uso(s) no total)**`,
    "```",
    ...lines,
    "```",
  ];

  if (invites.length > 25) out.push(`_e mais ${invites.length - 25} invite(s)._`);

  if (filterUserId) {
    out.push(
      `Saldo de convites de <@${filterUserId}>: **${storage.get(filterUserId)}**`
    );
  }

  return out.join("\n");
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "invites") return;

  const filterUserId = interaction.options.getUser("usuario")?.id ?? null;
  await interaction.reply(buildInvitesMessage(filterUserId));
});

client.once("ready", () => {
  console.log(`[INVITE] ${client.user.tag} online!`);
  console.log("[INVITE] Servidor:", config.guildId);
  console.log("[INVITE] Canal de log:", config.logChannelId);
  console.log(
    `[INVITE] Atualizando a cada ${config.watchIntervalMs}ms (join expira em ${config.pendingTtlMs}ms).`
  );
  reportStatus();
  registerCommands();
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
