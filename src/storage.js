const fs = require("fs");
const { config } = require("./config");

const useDatabase = Boolean(process.env.DATABASE_URL);

let pool = null;
let ready = null;
let state = { users: {}, invites: {}, attributions: {} };

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS invite_balances (
    user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY,
    uses INTEGER NOT NULL DEFAULT 0,
    owner_id TEXT,
    owner_name TEXT
  );

  CREATE TABLE IF NOT EXISTS attributions (
    joiner_id TEXT PRIMARY KEY,
    inviter_id TEXT NOT NULL
  );
`;

function cleanUrl(raw) {
  try {
    const url = new URL(raw);
    url.searchParams.delete("channel_binding");
    if (url.searchParams.get("sslmode") === "require") {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function setupDatabase() {
  const { Pool } = require("pg");
  const connectionString = cleanUrl(process.env.DATABASE_URL);

  pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    // verify-full: o pg-connection-string transforma sslmode=require em
    // rejectUnauthorized=false, o que NAO valida o certificado. Forcamos SSL
    // com validacao para nao ficar aberto a interceptacao.
    ssl: connectionString.includes("sslmode=disable")
      ? false
      : { rejectUnauthorized: true },
  });

  pool.on("error", (err) =>
    console.log("[INVITE] Erro de conexão com o Postgres:", err.message)
  );

  return pool.query(SCHEMA).then(
    () => console.log("[INVITE] Postgres conectado e tabelas prontas."),
    (err) => {
      console.log("[INVITE] Falha ao preparar o Postgres:", err.message);
      throw err;
    }
  );
}

function loadFile() {
  if (!fs.existsSync(config.dataFile)) {
    console.log("[INVITE] invites.json ainda não existe, começando do zero.");
    return;
  }
  const parsed = JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
  state.users = parsed.users ?? {};
  state.invites = parsed.invites ?? {};
  state.attributions = parsed.attributions ?? {};
  console.log(
    `[INVITE] invites.json carregado. users: ${Object.keys(state.users).length} | invites: ${
      Object.keys(state.invites).length
    } | attributions: ${Object.keys(state.attributions).length}`
  );
}

function saveFile() {
  fs.writeFileSync(config.dataFile, JSON.stringify(state, null, 2));
}

async function dbIncrement(userId) {
  const { rows } = await pool.query(
    `INSERT INTO invite_balances (user_id, balance) VALUES ($1, 1)
     ON CONFLICT (user_id) DO UPDATE SET balance = invite_balances.balance + 1
     RETURNING balance`,
    [userId]
  );
  return rows[0].balance;
}

async function dbDecrement(userId) {
  const { rows } = await pool.query(
    `INSERT INTO invite_balances (user_id, balance) VALUES ($1, 0)
     ON CONFLICT (user_id) DO UPDATE SET balance = GREATEST(0, invite_balances.balance - 1)
     RETURNING balance`,
    [userId]
  );
  return rows[0].balance;
}

async function dbGet(userId) {
  const { rows } = await pool.query(
    "SELECT balance FROM invite_balances WHERE user_id = $1",
    [userId]
  );
  return rows[0] ? rows[0].balance : 0;
}

async function dbSetInvites(map) {
  const rows = [...map.entries()].map(([code, entry]) => [
    code,
    entry.uses,
    entry.inviter ? entry.inviter.id : null,
    entry.name,
  ]);
  const codes = rows.map((r) => r[0]);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (rows.length > 0) {
      await client.query(
        `INSERT INTO invites (code, uses, owner_id, owner_name)
         SELECT * FROM UNNEST($1::text[], $2::int[], $3::text[], $4::text[])
           AS incoming(code, uses, owner_id, owner_name)
         ON CONFLICT (code) DO UPDATE
           SET uses = EXCLUDED.uses,
               owner_id = EXCLUDED.owner_id,
               owner_name = EXCLUDED.owner_name`,
        [codes, rows.map((r) => r[1]), rows.map((r) => r[2]), rows.map((r) => r[3])]
      );
      await client.query("DELETE FROM invites WHERE NOT (code = ANY($1::text[]))", [
        codes,
      ]);
    } else {
      await client.query("DELETE FROM invites");
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function dbSetAttribution(joinerId, inviterId) {
  await pool.query(
    `INSERT INTO attributions (joiner_id, inviter_id) VALUES ($1, $2)
     ON CONFLICT (joiner_id) DO UPDATE SET inviter_id = EXCLUDED.inviter_id`,
    [joinerId, inviterId]
  );
}

async function dbGetAttribution(joinerId) {
  const { rows } = await pool.query(
    "SELECT inviter_id FROM attributions WHERE joiner_id = $1",
    [joinerId]
  );
  return rows[0] ? rows[0].inviter_id : null;
}

async function dbClearAttribution(joinerId) {
  await pool.query("DELETE FROM attributions WHERE joiner_id = $1", [joinerId]);
}

async function dbListInvitedBy(inviterId) {
  const { rows } = await pool.query(
    "SELECT joiner_id FROM attributions WHERE inviter_id = $1 ORDER BY joiner_id",
    [inviterId]
  );
  return rows.map((r) => r.joiner_id);
}

function init() {
  if (!ready) {
    ready = useDatabase
      ? setupDatabase()
      : Promise.resolve().then(() => {
          try {
            loadFile();
          } catch (err) {
            console.log("[INVITE] Erro ao ler invites.json:", err.message);
          }
        });
  }
  return ready;
}

async function increment(userId) {
  if (useDatabase) return dbIncrement(userId);
  state.users[userId] = (state.users[userId] || 0) + 1;
  saveFile();
  return state.users[userId];
}

async function decrement(userId) {
  if (useDatabase) return dbDecrement(userId);
  const next = Math.max(0, (state.users[userId] || 0) - 1);
  state.users[userId] = next;
  saveFile();
  return next;
}

async function get(userId) {
  if (useDatabase) return dbGet(userId);
  return state.users[userId] || 0;
}

async function setInvites(map) {
  if (useDatabase) return dbSetInvites(map);
  state.invites = {};
  for (const [code, entry] of map) {
    state.invites[code] = {
      uses: entry.uses,
      owner: entry.inviter ? entry.inviter.id : null,
      name: entry.name,
    };
  }
  saveFile();
}

async function setAttribution(joinerId, inviterId) {
  if (useDatabase) return dbSetAttribution(joinerId, inviterId);
  state.attributions[joinerId] = inviterId;
  saveFile();
}

async function getAttribution(joinerId) {
  if (useDatabase) return dbGetAttribution(joinerId);
  return state.attributions[joinerId] ?? null;
}

async function clearAttribution(joinerId) {
  if (useDatabase) return dbClearAttribution(joinerId);
  delete state.attributions[joinerId];
  saveFile();
}

async function listInvitedBy(inviterId) {
  if (useDatabase) return dbListInvitedBy(inviterId);
  return Object.entries(state.attributions)
    .filter(([, inviter]) => inviter === inviterId)
    .map(([joinerId]) => joinerId)
    .sort();
}

module.exports = {
  usingDatabase: useDatabase,
  init,
  increment,
  decrement,
  get,
  setInvites,
  setAttribution,
  getAttribution,
  clearAttribution,
  listInvitedBy,
};
