// Diagnostico: confere .env, banco de dados, canal de log e permissoes.
//   node scripts/check.js          -> so confere config e banco
//   node scripts/check.js --discord -> tambem loga no Discord e valida canal/permissao
const fs = require("fs");
const path = require("path");
const { config, missingKeys } = require("../src/config");

const wantDiscord = process.argv.includes("--discord");
const line = (label, value) => console.log(`  ${label.padEnd(22)} ${value}`);
let problems = 0;
const problem = (msg) => {
  problems++;
  console.log(`  [X] ${msg}`);
};
const good = (msg) => console.log(`  [OK] ${msg}`);

async function checkDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.log("\nBANCO DE DADOS");
    line("modo", "data/invites.json (sem DATABASE_URL)");
    problem(
      "sem DATABASE_URL o saldo se perde a cada deploy em plataforma efemera (Railway)."
    );
    if (fs.existsSync(config.dataFile)) {
      const state = JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
      line("usuarios", Object.keys(state.users ?? {}).length);
      line("invites", Object.keys(state.invites ?? {}).length);
      line("attributions", Object.keys(state.attributions ?? {}).length);
    } else {
      line("arquivo", "ainda nao existe (bot nunca rodou)");
    }
    return;
  }

  console.log("\nBANCO DE DADOS");
  const host = (() => {
    try {
      return new URL(raw).host;
    } catch {
      return "?";
    }
  })();
  line("host", host);
  line("sslmode", raw.includes("sslmode=disable") ? "disable" : "verify-full (padrao)");

  const { Pool } = require("pg");
  const { schema: SCHEMA } = require("../src/storage");
  const pool = new Pool({
    connectionString: raw,
    max: 1,
    connectionTimeoutMillis: 15_000,
    ssl: raw.includes("sslmode=disable") ? false : { rejectUnauthorized: true },
  });

  try {
    await pool.query(SCHEMA);
    good("conectou e as 3 tabelas existem/criaram");

    const { rows: b } = await pool.query(
      "SELECT COALESCE(SUM(balance),0) AS total, COUNT(*) AS users FROM invite_balances WHERE balance <> 0"
    );
    line("pessoas com saldo", b[0].users);
    line("soma dos saldos", b[0].total);

    const { rows: i } = await pool.query("SELECT COUNT(*) AS n, COALESCE(SUM(uses),0) AS uses FROM invites");
    line("invites salvos", `${i[0].n} (${i[0].uses} uso(s))`);

    const { rows: a } = await pool.query("SELECT COUNT(*) AS n FROM attributions");
    line("atribuicoes", a[0].n);

    if (i[0].n === 0) {
      console.log(
        "  [!] tabela invites vazia: o bot ainda nao conseguiu ler os invites do servidor (permissao?)"
      );
    }
  } catch (err) {
    problem(`banco indisponivel: ${err.message}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function checkDiscord() {
  console.log("\nDISCORD");
  const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

  try {
    await client.login(config.token);
    good(`login ok como ${client.user.tag}`);
  } catch (err) {
    problem(`login falhou: ${err.message}`);
    return;
  }

  try {
    const guild = await client.guilds.fetch(config.guildId).catch(() => null);
    if (!guild) {
      problem(`servidor ${config.guildId} nao encontrado (GUILD_ID errado ou bot fora do servidor)`);
    } else {
      good(`servidor ${guild.name} (${guild.id})`);
      const perms = guild.members.me?.permissions;
      const manageGuild = !!perms?.has(PermissionFlagsBits.ManageGuild);
      const manageChannels = !!perms?.has(PermissionFlagsBits.ManageChannels);
      line("MANAGE_GUILD", manageGuild);
      line("MANAGE_CHANNELS", manageChannels);
      if (!manageGuild && !manageChannels) problem("sem MANAGE_GUILD o bot nao le nenhum invite");

      let invites = null;
      try {
        invites = await guild.invites.fetch();
      } catch (err) {
        line("leitura de invites", `falhou: ${err.message}`);
      }
      if (invites) good(`leu ${invites.size} invite(s) do servidor`);

      const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
      if (!channel) {
        problem(`canal ${config.logChannelId} nao encontrado (CONFIRME INVITE_LOG_CHANNEL_ID)`);
      } else {
        good(`canal de log: #${channel.name} (${channel.id})`);
        const can = guild.members.me?.permissionsIn(channel);
        if (!can?.has(PermissionFlagsBits.ViewChannel)) problem("bot nao ve o canal de log");
        else if (!can?.has(PermissionFlagsBits.SendMessages)) problem("bot nao envia mensagens no canal de log");
        else good("bot pode enviar mensagens no canal de log");
      }
    }
  } finally {
    client.destroy();
  }
}

(async () => {
  console.log("CONFIG");
  const missing = missingKeys();
  line("GUILD_ID", config.guildId || "(vazio)");
  line("INVITE_LOG_CHANNEL_ID", config.logChannelId);
  line("watch", `${config.watchIntervalMs}ms`);
  line("ttl do join", `${config.pendingTtlMs}ms`);
  if (missing.length > 0) problem(`falta no .env: ${missing.join(", ")}`);

  await checkDatabase();
  if (wantDiscord) {
    if (missing.includes("BOT_TOKEN")) problem("--discord ignorado: sem BOT_TOKEN");
    else await checkDiscord();
  } else {
    console.log("\n(use --discord para validar token, servidor, canal e permissoes)");
  }

  console.log(problems === 0 ? "\nTUDO OK" : `\n${problems} PROBLEMA(S)`);
  process.exit(problems === 0 ? 0 : 1);
})();