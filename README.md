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
| `ORIGINAL_INVITE_URL` | Opcional. Convite usado na mensagem de entrada sem convidador. Padrão `https://discord.gg/roomix` |
| `DATABASE_URL` | Opcional. String de conexão Postgres. Sem ela o bot usa `data/invites.json` |

## Persistência

Sem `DATABASE_URL` o bot grava em `data/invites.json`, que **se perde a cada deploy**
em plataformas efêmeras como Railway. Para persistir de verdade, use um Postgres
hospedado (Neon, Supabase, Railway Postgres) e defina `DATABASE_URL`.

O [Neon](https://neon.tech) tem plano grátis que **desliga sozinho após 5 min sem
uso** e reativa em milissegundos, então não precisa ficar online 24h.

As tabelas (`invite_balances`, `invites`, `attributions`) são criadas
automaticamente na primeira execução. Não é preciso rodar migration.

> Use `sslmode=verify-full` na string de conexão. Com `sslmode=require` a biblioteca
> `pg` desliga a validação do certificado, o que deixa a conexão aberta a
> interceptação. O bot normaliza `require` para `verify-full` sozinho, mas o ideal é
> já vir certo do painel.
>
> **Nunca comite a string de conexão.** No Railway, defina em
> Settings → Variables. A senha do banco não vai no código nem no GitHub.

2. No portal do Discord, na aplicação do bot:
   - ligue o **Server Members Intent** (e **Server Messages Intent**, caso queira o bot ler
     mensagens de convite);
   - convide o bot no servidor com a permissão **Manage Server** (ou **Manage Channels**
     nos canais, se não puder dar Manage Server);
   - dê permissão de **View Channel** + **Send Messages** no canal de log.

## Como funciona

- A cada `WATCH_INTERVAL_MS` (padrão **1s**) o bot lê todos os invites do servidor e compara
  com a leitura anterior.
- Quando um invite ganha uso (ou nasce um invite), o bot procura um join pendente e
  atribui o crédito a quem criou o invite.
- Os contadores e a tabela de invites ficam no Postgres (ou em `data/invites.json`
  se não houver `DATABASE_URL`): saldos, invites e quem convidou quem.
- O saldo é **líquido**: se alguém convidou 10 pessoas e 1 sai, o saldo cai para 9.
  Saiu alguém sem conviedor registrado, nada é descontado. O saldo nunca fica negativo.
- Se um join não for atribuído em `PENDING_TTL_MS` (padrão 3min), ele é descartado **sem
  crédito** e o bot posta no canal de log que a pessoa entrou pelo convite original
  (`ORIGINAL_INVITE_URL`), já que nenhum invite ganhou uso para quem chamou.
- Use `/i` para ver quantas pessoas você convidou (e quem), e
  `/i usuario:@alguem` para ver o total de outra pessoa. A resposta é só sua.
- Use `/invites` no servidor para ver a tabela ao vivo (código, usos, dono), e
  `/invites usuario:@alguem` para filtrar os convites de uma pessoa.

> A cada 1s o bot faz 10 leituras por 10s, que é o limite da rota de invites do
> Discord. Se bater o limite a API responde 429, o bot preserva o último cache
> válido e tenta de novo no próximo ciclo — nada é perdido, só atrasa.

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

- `Watch init: N invite(s)` -> primeira leitura, o diff só começa a contar a partir daí;
  member invites que já tinham uso quando o bot ligou entram como "created" e podem
  atribuir joins antigos.
- `Mudanças (...)` -> o que mudou entre duas leituras.
- `aguardando crédito de N entrada(s)` -> alguém entrou mas nenhum invite subiu ainda;
  em 3min a entrada vira "entrou pelo convite original", sem crédito.
- `entrou no servidor pelo convite original` -> entrada sem convidador identificado
  (nenhum invite ganhou uso), ninguém foi creditado.
- `>> Mensagem ENVIADA para #canal` -> crédito postado com sucesso.
- `<< SAIDA registrada` -> alguém saiu; o bot desconta 1 do conviedor registrado.
- `SAIDA sem crédito` -> a pessoa não tem conviedor registrado (entrou antes do bot
  ligar, ou o bot reiniciou), então nada é descontado.
