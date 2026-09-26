const fs = require("fs");
const { config } = require("./config");

const state = { users: {}, invites: {}, attributions: {} };

function load() {
  try {
    if (!fs.existsSync(config.dataFile)) {
      console.log("[INVITE] invites.json ainda não existe, começando do zero.");
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
    state.users = parsed.users ?? {};
    state.invites = parsed.invites ?? {};
    state.attributions = parsed.attributions ?? {};
    console.log(
      `[INVITE] invites.json carregado. users: ${JSON.stringify(
        state.users
      )} | invites: ${Object.keys(state.invites).length} | attributions: ${
        Object.keys(state.attributions).length
      }`
    );
  } catch (err) {
    console.log("[INVITE] Erro ao ler invites.json:", err.message);
  }
}

function save() {
  try {
    fs.writeFileSync(config.dataFile, JSON.stringify(state, null, 2));
  } catch (err) {
    console.log("[INVITE] Erro ao salvar invites.json:", err.message);
  }
}

function increment(userId) {
  state.users[userId] = (state.users[userId] || 0) + 1;
  save();
  return state.users[userId];
}

function decrement(userId) {
  const next = Math.max(0, (state.users[userId] || 0) - 1);
  state.users[userId] = next;
  save();
  return next;
}

function get(userId) {
  return state.users[userId] || 0;
}

function setAttribution(joinerId, inviterId) {
  state.attributions[joinerId] = inviterId;
  save();
}

function getAttribution(joinerId) {
  return state.attributions[joinerId] ?? null;
}

function clearAttribution(joinerId) {
  delete state.attributions[joinerId];
  save();
}

function setInvites(map) {
  state.invites = {};
  for (const [code, entry] of map) {
    state.invites[code] = {
      uses: entry.uses,
      owner: entry.inviter ? entry.inviter.id : null,
      name: entry.name,
    };
  }
  save();
}

load();

module.exports = {
  state,
  load,
  save,
  increment,
  decrement,
  get,
  setInvites,
  setAttribution,
  getAttribution,
  clearAttribution,
};
