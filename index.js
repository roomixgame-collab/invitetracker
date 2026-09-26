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

const myInvitesCommand = new SlashCommandBuilder()
  .setName("i")
  .setDescription("Mostra quantas pessoas você convidou para o servidor")
  .addUserOption((opt) =>
    opt
      .setName("usuario")
      .setDescription("Vê o total de outra pessoa (opcional)")
  )
  .toJSON();

const commands = [invitesCommand, myInvitesCommand];

async function registerCommands() {
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(commands);
      console.log(
        `[INVITE] Comandos /invites e /i registrados em ${guild.name} (${guild.id}).`
      );
    } catch (err) {
      console.log(`[INVITE] Falha ao registrar comandos em ${guild.id}:`, err.message);
    }
  }
}

function buildInvitesMessage(invites, balance) {
  if (invites.length === 0) {
    return "Nenhum invite encontrado no servidor.";
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
  if (balance !== null) {
    out.push(`Saldo de convites: **${balance}**`);
  }

  return out.join("\n");
}

function describeMember(guild, userId) {
  const member = guild.members.cache.get(userId);
  return member ? member.user.username : `\`${userId}\``;
}

async function buildMyInvitesMessage(guild, userId, isSelf) {
  const [balance, invited] = await Promise.all([
    storage.get(userId),
    storage.listInvitedBy(userId),
  ]);

  const who = isSelf ? "Você" : `<@${userId}>`;
  const plural = balance === 1 ? "pessoa" : "pessoas";
  const header = isSelf
    ? `Você convidou **${balance}** ${plural} para o servidor.`
    : `<@${userId}> convidou **${balance}** ${plural} para o servidor.`;

  if (invited.length === 0) {
    return `${header}\n_(nenhuma pessoa registrada ainda)_`;
  }

  const shown = invited.slice(0, 15);
  const lines = shown.map((id) => `• ${describeMember(guild, id)} (\`${id}\`)`);

  const out = [header, "", "**Pessoas convidadas por você:**", ...lines];

  if (invited.length > shown.length) {
    out.push(`_e mais ${invited.length - shown.length} pessoa(s)._`);
  }

  return out.join("\n");
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "i") {
    try {
      const target = interaction.options.getUser("usuario");
      const targetId = target?.id ?? interaction.user.id;
      const isSelf = !target || target.id === interaction.user.id;
      await interaction.reply({
        content: await buildMyInvitesMessage(
          interaction.guild,
          targetId,
          isSelf
        ),
        ephemeral: true,
      });
    } catch (err) {
      console.log("[INVITE] Erro no comando /i:", err.message);
      await interaction
        .reply({
          content: "Não consegui ler seus convites agora. Tente de novo em instantes.",
          ephemeral: true,
        })
        .catch(() => {});
    }
    return;
  }

  if (interaction.commandName !== "invites") return;

  try {
    const filterUserId = interaction.options.getUser("usuario")?.id ?? null;
    const invites = tracker
      .listInvites()
      .filter((i) => !filterUserId || i.ownerId === filterUserId);

    if (filterUserId && invites.length === 0) {
      await interaction.reply("Esse usuário não tem nenhum invite no servidor.");
      return;
    }

    const balance = filterUserId ? await storage.get(filterUserId) : null;
    await interaction.reply(buildInvitesMessage(invites, balance));
  } catch (err) {
    console.log("[INVITE] Erro no comando /invites:", err.message);
    await interaction
      .reply("Não consegui ler os convites agora. Tente de novo em instantes.")
      .catch(() => {});
  }
});

client.once("ready", async () => {
  console.log(`[INVITE] ${client.user.tag} online!`);
  console.log("[INVITE] Servidor:", config.guildId);
  console.log("[INVITE] Canal de log:", config.logChannelId);
  console.log(
    `[INVITE] Persistência: ${
      storage.usingDatabase ? "Postgres" : "data/invites.json (local)"
    }`
  );
  console.log(
    `[INVITE] Atualizando a cada ${config.watchIntervalMs}ms (join expira em ${config.pendingTtlMs}ms).`
  );

  try {
    await storage.init();
  } catch (err) {
    console.log("[INVITE] Banco indisponível, o bot vai rodar sem persistir:", err.message);
  }

  reportStatus();
  registerCommands();
  tracker.start(client);
});

client.on("guildMemberAdd", (member) => {
  if (member.guild.id !== config.guildId) return;
  attribution.push(member);
  setTimeout(() => tracker.tick(client), config.joinSettleMs);
});

client.on("guildMemberRemove", (member) => {
  if (!member.guild || member.guild.id !== config.guildId) return;
  attribution.pushLeave(member);
  setTimeout(() => {
    attribution.processLeaves().catch((err) =>
      console.log("[INVITE] Erro ao processar saídas:", err.message)
    );
  }, config.joinSettleMs);
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
