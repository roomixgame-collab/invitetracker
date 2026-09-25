# Invite Tracker Bot

Bot separado, com token próprio, que rastreia quem convidou cada novo membro do servidor
e posta a contagem no canal de log.

## Como rodar

```bash
cd invite-tracker
npm install
npm start
```

## Configuração

1. Copie `.env.example` para `.env` e preencha:

| Variável | O que é |
| --- | --- |
| `BOT_TOKEN` | Token do bot de invite (aplicação separada do bot da call) |
| `GUILD_ID` | ID do servidor |
| `INVITE_LOG_CHANNEL_ID` | Canal de texto que recebe a mensagem |

2. No portal do Discord, na aplicação do bot:
   - ligue o **Server Members Intent** (e **Server Messages Intent**, caso queira o bot ler
     mensagens de convite);
   - convide o bot no servidor com a permissão **Manage Server** (ou **Manage Channels**
     nos canais, se não puder dar Manage Server);
   - dê permissão de **View Channel** + **Send Messages** no canal de log.

## Como funciona

- A cada `WATCH_INTERVAL_MS` (padrão 4s) o bot lê todos os invites do servidor e compara
  com a leitura anterior.
- Quando um invite ganha uso (ou nasce/some um invite), o bot procura um join pendente e
  atribui o crédito a quem criou o invite.
- O contador fica em `data/invites.json`, com um registro por ID de usuário.
- Se um join não for atribuído em `PENDING_TTL_MS` (padrão 3min), ele é descartado.

## Arquivos

```
invite-tracker/
├── index.js            # login, eventos (ready, guildMemberAdd) e status
├── src/
│   ├── config.js       # leitura do .env
│   ├── storage.js      # data/invites.json
│   ├── invites.js      # leitura de invites + diff entre leituras
│   ├── attribution.js  # fila de joins, crédito e mensagem no canal de log
│   └── tracker.js      # loop de watch
└── data/invites.json   # contadores (gerado)
```

## Logs uteis

- `Watch init: N invites` -> primeira leitura, o diff só começa a contar a partir daí;
  member invites que já tinham uso quando o bot ligou entram como "created" e podem
  atribuir joins antigos.
- `Mudanças (...)` -> o que mudou entre duas leituras.
- `>> Mensagem ENVIADA para #canal` -> crédito postado com sucesso.
