const fs = require("fs");
const { config } = require("./config");

const state = { users: {} };

function load() {
  try {
    if (!fs.existsSync(config.dataFile)) {
      console.log("[INVITE] invites.json ainda não existe, começando do zero.");
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
    state.users = parsed.users ?? {};
    console.log("[INVITE] invites.json carregado. users:", state.users);
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

function get(userId) {
  return state.users[userId] || 0;
}

load();

module.exports = { state, load, save, increment, get };
