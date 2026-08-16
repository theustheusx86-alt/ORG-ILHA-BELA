const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, PermissionFlagsBits, ChannelType
} = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ── CONFIG ─────────────────────────────────────────────────────────────
let config = {};
if (fs.existsSync('./config.json')) { try { config = JSON.parse(fs.readFileSync('./config.json','utf8')); } catch {} }
function saveConfig() { fs.writeFileSync('./config.json', JSON.stringify(config,null,2)); }

let filas   = {}; // filas abertas em memória
let canais  = {}; // canais de fila criados { channelId: { mode, plat, value, players, pixLiberado } }

if (fs.existsSync('./filas.json'))  { try { filas  = JSON.parse(fs.readFileSync('./filas.json', 'utf8')); } catch {} }
if (fs.existsSync('./canais.json')) { try { canais = JSON.parse(fs.readFileSync('./canais.json','utf8')); } catch {} }

function saveFilas()  { fs.writeFileSync('./filas.json',  JSON.stringify(filas, null,2)); }
function saveCanais() { fs.writeFileSync('./canais.json', JSON.stringify(canais,null,2)); }

// ── CONSTANTES ─────────────────────────────────────────────────────────
const MODES = { '1v1':2, '2v2':4, '3v3':6, '4v4':8 }; // modo → jogadores necessários
const PLATS = ['mobile','emu'];
const PRICES = [0.50,1,2,5,10,15,20,25,30,40,50,75,100,150,200];

function rnd(n) { return Math.floor(Math.random()*Math.pow(10,n)).toString().padStart(n,'0'); }
function fmtVal(v) { return 'R$ '+Number(v).toFixed(2).replace('.',','); }

// ── CHAVE DA FILA ──────────────────────────────────────────────────────
// Cada fila é identificada por modo+plat+valor
// Dentro de cada fila há 2 sub-filas: normal e infinito
function getFilaKey(mode, plat, value) {
  return `${mode}_${plat}_${Number(value).toFixed(2)}`;
}

function getFila(mode, plat, value) {
  const k = getFilaKey(mode, plat, value);
  if (!filas[k]) filas[k] = { normal:[], infinito:[] };
  return filas[k];
}

// ── EMBED DA FILA ──────────────────────────────────────────────────────
function buildFilaEmbed(mode, plat, value) {
  const fila = getFila(mode, plat, value);
  const maxP = MODES[mode];
  const platLabel = plat === 'mobile' ? '📱 MOBILE' : '🖥️ EMULADOR';

  const listNormal = fila.normal.length > 0
    ? fila.normal.map((p,i) => `\`${i+1}.\` **${p.nick}** — Gel Normal`).join('\n')
    : '_Nenhum_';
  const listInfinito = fila.infinito.length > 0
    ? fila.infinito.map((p,i) => `\`${i+1}.\` **${p.nick}** — Gel Infinito`).join('\n')
    : '_Nenhum_';

  const now = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});

  return new EmbedBuilder()
    .setColor(plat==='mobile' ? 0x3498DB : 0x9B59B6)
    .setTitle(`⚔️ FILA ${mode.toUpperCase()} — ${platLabel} | ORG TIGRE`)
    .addFields(
      { name:'**VALOR**',  value: fmtVal(value),    inline:true },
      { name:'**MODO**',   value: mode.toUpperCase(), inline:true },
      { name:'**PLATAFORMA**', value: platLabel,     inline:true },
      { name:`🧊 Gel Normal (${fila.normal.length}/${maxP})`,    value: listNormal,    inline:false },
      { name:`❄️ Gel Infinito (${fila.infinito.length}/${maxP})`, value: listInfinito, inline:false },
    )
    .setFooter({ text:`Use os botões para entrar/sair da fila. | ${now}` })
    .setTimestamp();
}

// ── BOTÕES DA FILA ─────────────────────────────────────────────────────
function buildFilaButtons(mode, plat, value) {
  const v = Number(value).toFixed(2);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`fn_${mode}_${plat}_${v}`).setLabel('🧊 Gel Normal').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`fi_${mode}_${plat}_${v}`).setLabel('❄️ Gel Infinito').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`fs_${mode}_${plat}_${v}`).setLabel('Sair da Fila').setStyle(ButtonStyle.Danger),
    )
  ];
}

// ── MENU DO MEDIADOR ───────────────────────────────────────────────────
function buildMediadorMenu(channelId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`med_${channelId}`)
      .setPlaceholder('⚖️ Menu do Mediador...')
      .addOptions([
        { label:'✅ Finalizar Aposta',    value:'finalizar',  description:'Encerra a fila e o canal', emoji:'✅' },
        { label:'🏆 Escolher Vencedor',   value:'vencedor',   description:'Escolhe quem ganhou',      emoji:'🏆' },
        { label:'⚠️ Vitória por W.O',     value:'wo',         description:'Vitória por walkover',     emoji:'⚠️' },
        { label:'💳 Liberar PIX',         value:'pix',        description:'Permite envio de PIX',     emoji:'💳' },
      ])
  );
}

// ── CRIAR CANAL DE FILA ────────────────────────────────────────────────
async function criarCanalFila(guild, mode, plat, value, players, gelType) {
  const platLabel = plat === 'mobile' ? 'MOBILE' : 'EMULADOR';
  const channelName = `${platLabel}-${rnd(5)}`;

  let ch;
  try {
    ch = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: config.filaCategory || null,
      permissionOverwrites: [
        { id: guild.id,       deny:  [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles] },
        ...players.map(p => ({
          id: p.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny:  [PermissionFlagsBits.SendMessages], // bloqueado até liberar PIX
        })),
        ...(config.staffRole ? [{ id:config.staffRole, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
      ],
    });
  } catch(e) { console.error('Erro criar canal:', e); return; }

  canais[ch.id] = { mode, plat, value: Number(value), players, gelType, pixLiberado: false, vencedor: null };
  saveCanais();

  const platLabel2 = plat==='mobile' ? '📱 Mobile' : '🖥️ Emulador';
  const embed = new EmbedBuilder()
    .setColor(0xFFAA00)
    .setTitle(`⚔️ ${channelName} | ORG TIGRE`)
    .setDescription(
      `> 🔇 Você **não pode enviar mensagens** até o mediador liberar o PIX!\n\n` +
      `**Modo:** ${mode.toUpperCase()} — ${platLabel2}\n` +
      `**Gel:** ${gelType === 'normal' ? '🧊 Gel Normal' : '❄️ Gel Infinito'}\n` +
      `**Valor:** ${fmtVal(value)}\n\n` +
      `**Jogadores:**\n` +
      players.map((p,i) => `\`${i+1}.\` <@${p.id}> — **${p.nick}**`).join('\n')
    )
    .setFooter({ text:'ORG TIGRE • Aguardando mediador' })
    .setTimestamp();

  await ch.send({
    content: players.map(p=>`<@${p.id}>`).join(' '),
    embeds: [embed],
    components: [buildMediadorMenu(ch.id)],
  });

  return ch;
}

// ── READY ──────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  // Promo a cada 20min
  setInterval(async () => {
    if (!config.promoChannels?.length) return;
    const embed = new EmbedBuilder().setColor(0xFFAA00)
      .setTitle('⭐ MELHOR ORG DE TODAS ⭐')
      .setDescription('> 🏆 **ORG TIGRE** — Apostas Free Fire!\n> 💰 Seguro, rápido e confiável!\n> ⚡ Entre na fila agora!')
      .setFooter({ text:'ORG TIGRE • Free Fire' }).setTimestamp();
    for (const chId of config.promoChannels) {
      try { const c=await client.channels.fetch(chId); if(c) await c.send({embeds:[embed]}); } catch {}
    }
  }, 20*60*1000);
});

// ── COMMANDS ───────────────────────────────────────────────────────────
client.on('messageCreate', async (msg) => {
  if (!msg.guild || msg.author.bot || !msg.content.startsWith('!')) return;
  const args = msg.content.slice(1).trim().split(/ +/);
  const cmd  = args.shift().toLowerCase();
  const isAdmin = msg.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!config.players) config.players = {};
  function getPlayer(id) {
    if (!config.players[id]) config.players[id] = { vitorias:0, partidas:0 };
    return config.players[id];
  }

  // !fila <modo> <plat> <valor>
  // ex: !fila 1v1 mobile 10
  if (cmd === 'fila') {
    if (!isAdmin) return msg.reply('❌ Sem permissão.');
    const mode  = args[0]?.toLowerCase();
    const plat  = args[1]?.toLowerCase();
    const value = parseFloat(args[2]);

    if (!MODES[mode]) return msg.reply(`❌ Modo inválido. Use: ${Object.keys(MODES).join(', ')}`);
    if (!PLATS.includes(plat)) return msg.reply('❌ Plataforma inválida. Use: mobile ou emu');
    if (isNaN(value) || value<=0) return msg.reply('❌ Valor inválido. Ex: !fila 1v1 mobile 10');

    // Resetar sub-filas ao criar nova
    const k = getFilaKey(mode, plat, value);
    filas[k] = { normal:[], infinito:[] };
    saveFilas();

    msg.delete().catch(()=>{});
    await msg.channel.send({
      embeds: [buildFilaEmbed(mode, plat, value)],
      components: buildFilaButtons(mode, plat, value),
    });
    return;
  }

  // !c — renomeia canal para fila-XXXX
  if (cmd === 'c') {
    if (!isAdmin) return msg.reply('❌ Sem permissão.');
    const newName = `fila-${rnd(4)}`;
    try { await msg.channel.setName(newName); msg.delete().catch(()=>{}); }
    catch { msg.reply('❌ Erro ao renomear.'); }
    return;
  }

  // !pg — renomeia canal para pagar-[total]
  if (cmd === 'pg') {
    if (!isAdmin) return msg.reply('❌ Sem permissão.');
    const info = canais[msg.channel.id];
    if (!info) return msg.reply('❌ Canal de fila não encontrado.');
    const total = info.value * info.players.length;
    const totalStr = total.toFixed(2).replace('.',',');
    const newName = `pagar-${totalStr}`;
    try { await msg.channel.setName(newName); msg.delete().catch(()=>{}); }
    catch { msg.reply('❌ Erro ao renomear.'); }
    return;
  }

  // !vitoria [@player]
  if (cmd === 'vitoria') {
    const target = msg.mentions.members.first() || msg.member;
    const p = getPlayer(target.id);
    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle('🏆 ESTATÍSTICAS — ORG TIGRE')
      .setThumbnail(target.user.displayAvatarURL())
      .setDescription(`**Jogador:** ${target.displayName}`)
      .addFields(
        { name:'🏆 Vitórias',       value:`**${p.vitorias}**`,  inline:true },
        { name:'🎮 Partidas Ganhas', value:`**${p.partidas}**`, inline:true },
      )
      .setFooter({ text:'ORG TIGRE • Free Fire' })
      .setTimestamp();
    return msg.reply({ embeds:[embed] });
  }

  // !setstaff @role
  if (cmd === 'setstaff') {
    if (!isAdmin) return;
    const r = msg.mentions.roles.first(); if(!r) return;
    config.staffRole = r.id; saveConfig();
    msg.reply(`✅ Staff: ${r}`);
  }

  // !setfilacat <id>
  if (cmd === 'setfilacat') {
    if (!isAdmin) return;
    config.filaCategory = args[0]; saveConfig();
    msg.reply(`✅ Categoria: \`${args[0]}\``);
  }

  // !setpromo #canal
  if (cmd === 'setpromo') {
    if (!isAdmin) return;
    const ch = msg.mentions.channels.first(); if(!ch) return;
    if (!config.promoChannels) config.promoChannels = [];
    if (!config.promoChannels.includes(ch.id)) config.promoChannels.push(ch.id);
    saveConfig(); msg.reply(`✅ Canal ${ch} adicionado.`);
  }
});

// ── INTERACTIONS ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── MENU MEDIADOR ──────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('med_')) {
    const channelId = interaction.customId.replace('med_','');
    const info = canais[channelId];
    const isStaff = config.staffRole && interaction.member.roles.cache.has(config.staffRole);
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isStaff && !isAdmin) return interaction.reply({ content:'❌ Só mediadores podem usar isso!', ephemeral:true });
    const acao = interaction.values[0];

    // ── FINALIZAR APOSTA ──────────────────────────────────────────────
    if (acao === 'finalizar') {
      await interaction.reply({ embeds:[new EmbedBuilder().setColor(0xE74C3C)
        .setTitle('🏁 APOSTA FINALIZADA').setDescription(`Finalizado por ${interaction.user}.\nCanal deletado em 5s.`).setTimestamp()] });
      delete canais[channelId]; saveCanais();
      setTimeout(()=>interaction.channel.delete().catch(()=>{}), 5000);
      return;
    }

    // ── VITÓRIA POR W.O ───────────────────────────────────────────────
    if (acao === 'wo') {
      if (!info) return interaction.reply({ content:'❌ Dados não encontrados.', ephemeral:true });
      // Mostrar botões com os jogadores pra escolher quem ganhou por WO
      const buttons = info.players.map((p,i) =>
        new ButtonBuilder().setCustomId(`wo_${channelId}_${p.id}`).setLabel(p.nick).setStyle(ButtonStyle.Primary)
      );
      const row = new ActionRowBuilder().addComponents(buttons.slice(0,5));
      await interaction.reply({
        embeds:[new EmbedBuilder().setColor(0xE67E22).setTitle('⚠️ Vitória por W.O')
          .setDescription('Selecione quem ganhou por W.O:').setTimestamp()],
        components:[row], ephemeral:true
      });
      return;
    }

    // ── ESCOLHER VENCEDOR ─────────────────────────────────────────────
    if (acao === 'vencedor') {
      if (!info) return interaction.reply({ content:'❌ Dados não encontrados.', ephemeral:true });
      const buttons = info.players.map((p,i) =>
        new ButtonBuilder().setCustomId(`win_${channelId}_${p.id}`).setLabel(p.nick).setStyle(ButtonStyle.Success)
      );
      const row = new ActionRowBuilder().addComponents(buttons.slice(0,5));
      await interaction.reply({
        embeds:[new EmbedBuilder().setColor(0x2ECC71).setTitle('🏆 Escolher Vencedor')
          .setDescription('Selecione quem ganhou a aposta:').setTimestamp()],
        components:[row], ephemeral:true
      });
      return;
    }

    // ── LIBERAR PIX ───────────────────────────────────────────────────
    if (acao === 'pix') {
      if (!info) return interaction.reply({ content:'❌ Dados não encontrados.', ephemeral:true });
      // Liberar envio de mensagens pra todos os jogadores
      for (const p of info.players) {
        try {
          await interaction.channel.permissionOverwrites.edit(p.id, { ViewChannel:true, SendMessages:true });
        } catch {}
      }
      info.pixLiberado = true;
      saveCanais();
      await interaction.reply({ embeds:[new EmbedBuilder().setColor(0x00C896)
        .setTitle('💳 PIX LIBERADO!')
        .setDescription('> Os jogadores agora podem enviar mensagens!\n> Envie o comprovante de pagamento.')
        .setTimestamp()] });
      return;
    }

    return interaction.reply({ content:'❌ Opção inválida.', ephemeral:true });
  }

  if (!interaction.isButton()) return;
  const id = interaction.customId;

  // ── ENTRAR NA FILA (Gel Normal) ────────────────────────────────────────
  if (id.startsWith('fn_') || id.startsWith('fi_')) {
    const parts   = id.split('_');
    const gelType = parts[0]==='fn' ? 'normal' : 'infinito';
    const gelLabel= gelType==='normal' ? '🧊 Gel Normal' : '❄️ Gel Infinito';
    const mode    = parts[1];
    const plat    = parts[2];
    const value   = parseFloat(parts[3]);
    const maxP    = MODES[mode];
    if (!maxP) return interaction.reply({ content:'❌ Modo inválido.', ephemeral:true });

    const fila = getFila(mode, plat, value);
    const subFila = fila[gelType];

    // Verificar se já tá em alguma sub-fila
    if (fila.normal.find(p=>p.id===interaction.user.id) || fila.infinito.find(p=>p.id===interaction.user.id))
      return interaction.reply({ content:'⚠️ Você já está na fila!', ephemeral:true });

    if (subFila.length >= maxP)
      return interaction.reply({ content:`❌ Fila ${gelLabel} cheia!`, ephemeral:true });

    const nick = interaction.member.displayName;
    subFila.push({ id:interaction.user.id, name:interaction.user.username, nick });
    saveFilas();

    // Atualizar embed
    try { await interaction.message.edit({ embeds:[buildFilaEmbed(mode,plat,value)], components:buildFilaButtons(mode,plat,value) }); } catch {}
    await interaction.reply({ content:`✅ Entrou na fila **${mode.toUpperCase()} ${plat==='mobile'?'Mobile':'Emulador'}** — ${gelLabel} — ${fmtVal(value)}!`, ephemeral:true });

    // Verificar se sub-fila completou
    if (subFila.length >= maxP) {
      const players = [...subFila];
      fila[gelType] = []; // limpa sub-fila
      saveFilas();

      // Atualizar embed sem os jogadores que foram
      try { await interaction.message.edit({ embeds:[buildFilaEmbed(mode,plat,value)], components:buildFilaButtons(mode,plat,value) }); } catch {}

      // Criar canal privado
      await criarCanalFila(interaction.guild, mode, plat, value, players, gelType);
    }
    return;
  }

  // ── SAIR DA FILA ───────────────────────────────────────────────────────
  if (id.startsWith('fs_')) {
    const parts = id.split('_');
    const mode  = parts[1];
    const plat  = parts[2];
    const value = parseFloat(parts[3]);
    const fila  = getFila(mode, plat, value);
    let removido = false;

    for (const gel of ['normal','infinito']) {
      const idx = fila[gel].findIndex(p=>p.id===interaction.user.id);
      if (idx !== -1) { fila[gel].splice(idx,1); removido=true; break; }
    }

    if (!removido) return interaction.reply({ content:'⚠️ Você não está na fila.', ephemeral:true });
    saveFilas();
    try { await interaction.message.edit({ embeds:[buildFilaEmbed(mode,plat,value)], components:buildFilaButtons(mode,plat,value) }); } catch {}
    return interaction.reply({ content:'✅ Saiu da fila.', ephemeral:true });
  }

  // ── VENCEDOR ESCOLHIDO ─────────────────────────────────────────────────
  if (id.startsWith('win_') || id.startsWith('wo_')) {
    const isWo   = id.startsWith('wo_');
    const parts  = id.replace(isWo?'wo_':'win_','').split('_');
    const chId   = parts.slice(0,-1).join('_');
    const winnId = parts[parts.length-1];
    const info   = canais[chId];
    if (!info) return interaction.reply({ content:'❌ Dados não encontrados.', ephemeral:true });

    const isStaff = config.staffRole && interaction.member.roles.cache.has(config.staffRole);
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isStaff && !isAdmin) return interaction.reply({ content:'❌ Sem permissão.', ephemeral:true });

    const winner = info.players.find(p=>p.id===winnId);
    if (!winner) return interaction.reply({ content:'❌ Jogador não encontrado.', ephemeral:true });

    // Adicionar vitória
    if (!config.players) config.players = {};
    if (!config.players[winnId]) config.players[winnId] = { vitorias:0, partidas:0 };
    config.players[winnId].vitorias++;
    config.players[winnId].partidas++;
    saveConfig();

    // Anunciar no canal
    await interaction.reply({ embeds:[new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle(isWo ? '⚠️ VITÓRIA POR W.O!' : '🏆 VENCEDOR DA APOSTA!')
      .setDescription(`> <@${winnId}> (**${winner.nick}**) ganhou${isWo?' por W.O':''}!\n\n🏆 +1 Vitória\n🎮 +1 Partida Ganha`)
      .setTimestamp()] });

    // DM pro vencedor
    try {
      const user = await client.users.fetch(winnId);
      await user.send({ embeds:[new EmbedBuilder().setColor(0xFFD700)
        .setTitle('🏆 PARABÉNS — ORG TIGRE')
        .setDescription(`> Parabéns! Você ganhou${isWo?' por W.O':''}!\n\n✅ **+1 Vitória**\n✅ **+1 Partida Ganha**\n\nSeu total: **${config.players[winnId].vitorias} vitórias** e **${config.players[winnId].partidas} partidas ganhas**!`)
        .setFooter({ text:'ORG TIGRE • Free Fire' }).setTimestamp()] });
    } catch {}

    return;
  }
});

const TOKEN = process.env.DISCORD_TOKEN || config.token || 'SEU_TOKEN_AQUI';
client.login(TOKEN);
