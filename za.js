const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, PermissionFlagsBits, ChannelType
} = require('discord.js');
const fs   = require('fs');
const https = require('https');

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

let filas  = {};
let canais = {};
if (fs.existsSync('./filas.json'))  { try { filas  = JSON.parse(fs.readFileSync('./filas.json', 'utf8')); } catch {} }
if (fs.existsSync('./canais.json')) { try { canais = JSON.parse(fs.readFileSync('./canais.json','utf8')); } catch {} }
function saveFilas()  { fs.writeFileSync('./filas.json',  JSON.stringify(filas, null,2)); }
function saveCanais() { fs.writeFileSync('./canais.json', JSON.stringify(canais,null,2)); }

// ── CONSTANTES ─────────────────────────────────────────────────────────
const ORG    = 'ORG BELA';
const MODES  = { '1v1':2, '2v2':4, '3v3':6, '4v4':8 };
const PLATS  = ['mobile','emu','misto'];
const MIN_FILA_VALUE = Number(config.filaMinValue ?? 0.30);
const MAX_FILA_VALUE = Number(config.filaMaxValue ?? 1.00);

function rnd(n) { return Math.floor(Math.random()*Math.pow(10,n)).toString().padStart(n,'0'); }
function fmtVal(v) { return 'R$ '+Number(v).toFixed(2).replace('.',','); }
function channelValue(v) {
  const total = Number(v);
  if (!Number.isFinite(total)) return '0-reais';
  if (Number.isInteger(total)) return `${total}-reais`;
  return `${total.toFixed(2).replace('.', '-')}-reais`;
}
function getRegisteredPix(userId) {
  return config.pixStaff?.[userId] || config.pixUsers?.[userId] || null;
}
function buildPixQrUrl(pixKey) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(pixKey)}`;
}
function platformLabel(plat) {
  if (plat === 'mobile') return '📱 MOBILE';
  if (plat === 'misto') return '📱🖥️ MISTO';
  return '🖥️ EMULADOR';
}

// ── FILA HELPERS ───────────────────────────────────────────────────────
function getFilaKey(mode,plat,value) { return `${mode}_${plat}_${Number(value).toFixed(2)}`; }
function getFila(mode,plat,value) {
  const k = getFilaKey(mode,plat,value);
  if (!filas[k]) filas[k] = { normal:[], infinito:[] };
  return filas[k];
}

// ── EMBEDS ─────────────────────────────────────────────────────────────
function buildFilaEmbed(mode,plat,value) {
  const fila = getFila(mode,plat,value);
  const maxP = MODES[mode];
  const platLabel = platformLabel(plat);
  const listN = fila.normal.length>0   ? fila.normal.map((p,i)=>`\`${i+1}.\` **${p.nick}**`).join('\n')   : '_Nenhum_';
  const listI = fila.infinito.length>0 ? fila.infinito.map((p,i)=>`\`${i+1}.\` **${p.nick}**`).join('\n') : '_Nenhum_';
  const now = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  return new EmbedBuilder()
    .setColor(plat==='mobile' ? 0x3498DB : 0x9B59B6)
    .setTitle(`⚔️ FILA ${mode.toUpperCase()} — ${platLabel} | ${ORG}`)
    .addFields(
      { name:'**VALOR**',       value:fmtVal(value),     inline:true },
      { name:'**MODO**',        value:mode.toUpperCase(), inline:true },
      { name:'**PLATAFORMA**',  value:platLabel,          inline:true },
      { name:`🧊 Gel Normal (${fila.normal.length}/${maxP})`,    value:listN, inline:false },
      { name:`❄️ Gel Infinito (${fila.infinito.length}/${maxP})`, value:listI, inline:false },
    )
    .setFooter({ text:`Use os botões para entrar/sair da fila. | ${now}` })
    .setTimestamp();
}

function buildFilaButtons(mode,plat,value) {
  const v = Number(value).toFixed(2);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`fn_${mode}_${plat}_${v}`).setLabel('🧊 Gel Normal').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`fi_${mode}_${plat}_${v}`).setLabel('❄️ Gel Infinito').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`fs_${mode}_${plat}_${v}`).setLabel('Sair da Fila').setStyle(ButtonStyle.Danger),
    )
  ];
}

function buildMediadorMenu(channelId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`med_${channelId}`)
      .setPlaceholder('⚖️ Menu do Mediador...')
      .addOptions([
        { label:'✅ Finalizar Aposta',   value:'finalizar', description:'Encerra a fila e deleta o canal', emoji:'✅' },
        { label:'🏆 Escolher Vencedor',  value:'vencedor',  description:'Escolhe quem ganhou',            emoji:'🏆' },
        { label:'⚠️ Vitória por W.O',    value:'wo',        description:'Vitória por walkover',           emoji:'⚠️' },
        { label:'💳 Liberar PIX',        value:'pix',       description:'Permite envio de mensagens',     emoji:'💳' },
      ])
  );
}

function getMediadoresEmServico() {
  if (!config.mediadoresEmServico || typeof config.mediadoresEmServico !== 'object' || Array.isArray(config.mediadoresEmServico))
    config.mediadoresEmServico = {};
  return config.mediadoresEmServico;
}

function getMediadoresAtivos() {
  return Object.keys(getMediadoresEmServico())
    .filter(id => Boolean(config.pixStaff?.[id]));
}

function buildMediatorServicePanel() {
  const ativos = getMediadoresAtivos();
  const lista = ativos.length
    ? ativos.map(id => `<@${id}>`).join('\n')
    : '_Nenhum administrador em serviço no momento._';

  return {
    embeds: [new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle(`⚖️ FILA DE MEDIADORES — ${ORG}`)
      .setDescription(
        `Administradores podem entrar ou sair de serviço pelos botões abaixo.\n\n` +
        `**Administradores em serviço:**\n${lista}\n\n` +
        `Quando todos os jogadores confirmarem uma fila, ela será encaminhada para um administrador ativo.`
      )
      .setFooter({ text:`${ORG} • Painel de Mediadores` })
      .setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('medsvc_on').setLabel('🟢 Entrar em Serviço').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('medsvc_off').setLabel('🔴 Sair de Serviço').setStyle(ButtonStyle.Danger),
    )],
  };
}

// ── CRIAR CANAL ────────────────────────────────────────────────────────
async function criarCanalFila(guild, mode, plat, value, players, gelType) {
  const platLabel = plat==='mobile' ? 'MOBILE' : plat==='misto' ? 'MISTO' : 'EMULADOR';
  const channelName = `${platLabel}-${rnd(5)}`;

  let ch;
  try {
    ch = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: config.filaCategory || null,
      permissionOverwrites: [
        { id:guild.id,       deny: [PermissionFlagsBits.ViewChannel] },
        { id:client.user.id, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageRoles] },
        ...players.map(p=>({ id:p.id, allow:[PermissionFlagsBits.ViewChannel], deny:[PermissionFlagsBits.SendMessages] })),
        ...(config.staffRole ? [{ id:config.staffRole, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages] }] : []),
      ],
    });
  } catch(e) { console.error('Erro criar canal:', e); return; }

  canais[ch.id] = { mode, plat, value:Number(value), players, gelType, pixLiberado:false, mediador:null };
  saveCanais();

  const platLabel2 = plat==='mobile' ? '📱 Mobile' : plat==='misto' ? '📱🖥️ Misto' : '🖥️ Emulador';
  const gelLabel   = gelType==='normal' ? '🧊 Gel Normal' : '❄️ Gel Infinito';

  const embed = new EmbedBuilder()
    .setColor(0xFFAA00)
    .setTitle(`⚔️ ${channelName} | ${ORG}`)
    .setDescription(
      `> 🔇 Você **não pode enviar mensagens** até o mediador liberar o PIX!\n\n` +
      `**Modo:** ${mode.toUpperCase()} — ${platLabel2}\n` +
      `**Gel:** ${gelLabel}\n` +
      `**Valor:** ${fmtVal(value)}\n\n` +
      `**Jogadores:**\n` +
      players.map((p,i)=>`\`${i+1}.\` <@${p.id}> — **${p.nick}**`).join('\n') +
      `\n\n> Clique em **✅ Confirmar AP** para confirmar sua presença!`
    )
    .setFooter({ text:`${ORG} • Aguardando confirmação` })
    .setTimestamp();

  await ch.send({
    content: players.map(p=>`<@${p.id}>`).join(' '),
    embeds:  [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`conf_${ch.id}`).setLabel('✅ Confirmar AP').setStyle(ButtonStyle.Success),
      ),
      buildMediadorMenu(ch.id),
    ],
  });
  return ch;
}

// ── READY ──────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  setInterval(async () => {
    if (!config.promoChannels?.length) return;
    const embed = new EmbedBuilder().setColor(0xFFAA00)
      .setTitle(`⭐ MELHOR ORG DE TODAS ⭐`)
      .setDescription(`> 🏆 **${ORG}** — Apostas Free Fire!\n> 💰 Seguro, rápido e confiável!\n> ⚡ Entre na fila agora!`)
      .setFooter({ text:`${ORG} • Free Fire` }).setTimestamp();
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
  const isStaff = config.staffRole && msg.member.roles.cache.has(config.staffRole);
  if (!config.players) config.players = {};
  function getPlayer(id) {
    if (!config.players[id]) config.players[id] = { vitorias:0, partidas:0, perdas:0 };
    return config.players[id];
  }

  // !fila <modo> <plat> <valor>
  if (cmd === 'fila') {
    if (!isAdmin && !isStaff) return msg.reply('❌ Sem permissão.');
    const mode  = args[0]?.toLowerCase();
    const plat  = args[1]?.toLowerCase();
    const value = parseFloat(String(args[2] ?? '').replace(',', '.'));
    if (!MODES[mode])          return msg.reply(`❌ Modo inválido. Use: ${Object.keys(MODES).join(', ')}`);
    if (!PLATS.includes(plat)) return msg.reply('❌ Plataforma inválida. Use: mobile, emu ou misto');
    if (!Number.isFinite(value) || value < MIN_FILA_VALUE || value > MAX_FILA_VALUE)
      return msg.reply(`❌ Valor inválido. As filas aceitam de R$ ${MIN_FILA_VALUE.toFixed(2).replace('.',',')} até R$ ${MAX_FILA_VALUE.toFixed(2).replace('.',',')}. Ex: \`!fila 1v1 mobile 0,30\``);
    const k = getFilaKey(mode,plat,value);
    filas[k] = { normal:[], infinito:[] };
    saveFilas();
    msg.delete().catch(()=>{});
    await msg.channel.send({ embeds:[buildFilaEmbed(mode,plat,value)], components:buildFilaButtons(mode,plat,value) });
    return;
  }

  // !c — renomeia canal para fila-XXXX
  if (cmd === 'c') {
    if (!isAdmin && !isStaff) return msg.reply('❌ Sem permissão.');
    try { await msg.channel.setName(`fila-${rnd(4)}`); msg.delete().catch(()=>{}); }
    catch { msg.reply('❌ Erro ao renomear.'); }
    return;
  }

  // !pg — renomeia canal para pagar-[total]-reais.
  // O Discord remove vírgulas e pontos dos nomes dos canais. O sufixo
  // "-reais" deixa o total legível, sem transformar 20,00 em "2000".
  if (cmd === 'pg') {
    if (!isAdmin && !isStaff) return msg.reply('❌ Sem permissão.');
    const info = canais[msg.channel.id];
    if (!info) return msg.reply('❌ Canal de fila não encontrado.');
    const total = info.value * info.players.length;
    try { await msg.channel.setName(`pagar-${channelValue(total)}`); msg.delete().catch(()=>{}); }
    catch { msg.reply('❌ Erro ao renomear.'); }
    return;
  }

  // !registrar pix <gmail> <nome>
  if (cmd === 'registrar' && args[0]?.toLowerCase()==='pix') {
    const gmail = args[1];
    const nome  = args.slice(2).join(' ');
    if (!gmail||!nome) return msg.reply('❌ Use: `!registrar pix seugmail@gmail.com Seu Nome`');
    if (!/^[^\s@]+@gmail\.com$/i.test(gmail))
      return msg.reply('❌ Informe um Gmail válido, por exemplo: `seunome@gmail.com`');

    // Todo jogador pode registrar o Pix para receber prêmios.
    if (!config.pixUsers) config.pixUsers = {};
    config.pixUsers[msg.author.id] = { gmail, nome };

    // Quando quem registra é staff, o mesmo Pix fica disponível para
    // receber os pagamentos das filas em que essa pessoa estiver em serviço.
    if (isAdmin || isStaff) {
      if (!config.pixStaff) config.pixStaff = {};
      config.pixStaff[msg.author.id] = { gmail, nome };
    }
    saveConfig();
    msg.reply({ embeds:[new EmbedBuilder().setColor(0x00C896).setTitle(`✅ PIX Registrado — ${ORG}`)
      .setDescription(`**Gmail:** \`${gmail}\`\n**Nome:** \`${nome}\`\n\nSeu Pix foi salvo para recebimentos.`)
      .setFooter({ text:ORG }).setTimestamp()] });
    return;
  }

  // !vitoria [@player]
  if (cmd === 'vitoria') {
    const target = msg.mentions.members.first() || msg.member;
    const p = getPlayer(target.id);
    msg.reply({ embeds:[new EmbedBuilder().setColor(0xFFD700).setTitle(`🏆 ESTATÍSTICAS — ${ORG}`)
      .setThumbnail(target.user.displayAvatarURL())
      .setDescription(`**Jogador:** ${target.displayName}`)
      .addFields(
        { name:'🏆 Vitórias',         value:`**${p.vitorias}**`, inline:true },
        { name:'🎮 Partidas Ganhas',   value:`**${p.partidas}**`, inline:true },
        { name:'💀 Partidas Perdidas', value:`**${p.perdas}**`,   inline:true },
      )
      .setFooter({ text:`${ORG} • Free Fire` }).setTimestamp()] });
    return;
  }

  // !addvitoria @player — adm adiciona vitória manual
  if (cmd === 'addvitoria') {
    if (!isAdmin) return msg.reply('❌ Sem permissão.');
    const target = msg.mentions.members.first();
    if (!target) return msg.reply('❌ Mencione um jogador.');
    const p = getPlayer(target.id); p.vitorias++; p.partidas++; saveConfig();
    msg.reply(`✅ +1 vitória para ${target.displayName}!`);
    return;
  }

  // !addderrota @player — adm adiciona derrota manual
  if (cmd === 'addderrota') {
    if (!isAdmin) return msg.reply('❌ Sem permissão.');
    const target = msg.mentions.members.first();
    if (!target) return msg.reply('❌ Mencione um jogador.');
    const p = getPlayer(target.id); p.perdas++; saveConfig();
    msg.reply(`✅ +1 derrota para ${target.displayName}!`);
    return;
  }

  if (cmd==='setstaff')   { if(!isAdmin)return; const r=msg.mentions.roles.first();if(!r)return; config.staffRole=r.id; saveConfig(); msg.reply(`✅ Staff: ${r}`); }
  if (cmd==='setfilacat') { if(!isAdmin)return; config.filaCategory=args[0]; saveConfig(); msg.reply(`✅ Categoria: \`${args[0]}\``); }
  if (cmd==='setpromo')   { if(!isAdmin)return; const ch=msg.mentions.channels.first();if(!ch)return; if(!config.promoChannels)config.promoChannels=[]; if(!config.promoChannels.includes(ch.id))config.promoChannels.push(ch.id); saveConfig(); msg.reply(`✅ Canal ${ch} adicionado.`); }
  if (cmd==='setmedcanal') {
    if (!isAdmin) return msg.reply('❌ Só administradores podem configurar a fila de mediadores.');
    const channel = msg.mentions.channels.first() || await client.channels.fetch(args[0]).catch(()=>null);
    if (!channel || !channel.isTextBased()) return msg.reply('❌ Mencione um canal válido. Ex: `!setmedcanal #fila-mediadores`');
    config.mediadorChannel = channel.id;
    saveConfig();
    await channel.send(buildMediatorServicePanel());
    msg.reply(`✅ Painel da fila de mediadores enviado em ${channel}.`);
    return;
  }
});

// ── INTERACTIONS ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── MENU MEDIADOR ──────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('med_')) {
    const channelId = interaction.customId.replace('med_','');
    const info      = canais[channelId];
    const isAdmin   = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isAdmin) return interaction.reply({ content:'❌ Só administradores podem usar o menu do mediador!', ephemeral:true });
    const acao = interaction.values[0];

    // ENTRAR EM SERVIÇO
    if (acao === 'servico') {
      if (!info) return interaction.reply({ content:'❌ Canal não encontrado.', ephemeral:true });
      const pixInfo = config.pixStaff?.[interaction.user.id];
      if (!pixInfo) return interaction.reply({ content:'❌ Registre seu PIX primeiro!\nUse: `!registrar pix seugmail@gmail.com Seu Nome`', ephemeral:true });
      if (info.mediador && info.mediador !== interaction.user.id)
        return interaction.reply({ content:'❌ Já existe um mediador em serviço nesta fila.', ephemeral:true });
      info.mediador = interaction.user.id;
      saveCanais();
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ECC71)
        .setTitle('🟢 MEDIADOR EM SERVIÇO')
        .setDescription(`${interaction.user} entrou em serviço!\nPIX registrado: \`${pixInfo.gmail}\``)
        .setFooter({ text:ORG }).setTimestamp()] });
    }

    // FINALIZAR
    if (acao === 'finalizar') {
      await interaction.reply({ embeds:[new EmbedBuilder().setColor(0xE74C3C)
        .setTitle('🏁 APOSTA FINALIZADA')
        .setDescription(`Finalizado por ${interaction.user}.\nCanal deletado em 5s.`).setTimestamp()] });
      delete canais[channelId]; saveCanais();
      setTimeout(()=>interaction.channel.delete().catch(()=>{}), 5000);
      return;
    }

    // ESCOLHER VENCEDOR
    if (acao === 'vencedor') {
      if (!info) return interaction.reply({ content:'❌ Dados não encontrados.', ephemeral:true });
      const btns = info.players.slice(0,5).map(p =>
        new ButtonBuilder().setCustomId(`win_${channelId}_${p.id}`).setLabel(p.nick).setStyle(ButtonStyle.Success)
      );
      return interaction.reply({
        embeds:[new EmbedBuilder().setColor(0x2ECC71).setTitle('🏆 Escolher Vencedor').setDescription('Quem ganhou a aposta?').setTimestamp()],
        components:[new ActionRowBuilder().addComponents(btns)], ephemeral:true
      });
    }

    // W.O
    if (acao === 'wo') {
      if (!info) return interaction.reply({ content:'❌ Dados não encontrados.', ephemeral:true });
      const btns = info.players.slice(0,5).map(p =>
        new ButtonBuilder().setCustomId(`wo_${channelId}_${p.id}`).setLabel(p.nick).setStyle(ButtonStyle.Primary)
      );
      return interaction.reply({
        embeds:[new EmbedBuilder().setColor(0xE67E22).setTitle('⚠️ Vitória por W.O').setDescription('Quem ganhou por W.O?').setTimestamp()],
        components:[new ActionRowBuilder().addComponents(btns)], ephemeral:true
      });
    }

    // LIBERAR PIX
    if (acao === 'pix') {
      if (!info) return interaction.reply({ content:'❌ Dados não encontrados.', ephemeral:true });
      for (const p of info.players) {
        try { await interaction.channel.permissionOverwrites.edit(p.id,{ ViewChannel:true, SendMessages:true }); } catch {}
      }
      info.pixLiberado = true; saveCanais();
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x00C896)
        .setTitle('💳 PIX LIBERADO!')
        .setDescription('> Os jogadores agora podem enviar mensagens!\n> Envie o comprovante.')
        .setTimestamp()] });
    }

    return interaction.reply({ content:'❌ Opção inválida.', ephemeral:true });
  }

  if (!interaction.isButton()) return;
  const id = interaction.customId;

  // ── PAINEL DA FILA DE MEDIADORES ───────────────────────────────────────
  if (id === 'medsvc_on' || id === 'medsvc_off') {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isAdmin) return interaction.reply({ content:'❌ Só administradores podem entrar ou sair de serviço.', ephemeral:true });

    const ativos = getMediadoresEmServico();
    if (id === 'medsvc_on') {
      const pixInfo = config.pixStaff?.[interaction.user.id];
      if (!pixInfo)
        return interaction.reply({ content:'❌ Registre seu Pix primeiro com `!registrar pix seuemail@gmail.com Seu Nome`.', ephemeral:true });
      if (ativos[interaction.user.id])
        return interaction.reply({ content:'⚠️ Você já está em serviço.', ephemeral:true });

      ativos[interaction.user.id] = { desde: new Date().toISOString() };
      saveConfig();
      await interaction.message.edit(buildMediatorServicePanel()).catch(()=>{});
      return interaction.reply({ content:`🟢 Você entrou em serviço. As filas confirmadas serão encaminhadas para você.`, ephemeral:true });
    }

    if (!ativos[interaction.user.id])
      return interaction.reply({ content:'⚠️ Você não está em serviço.', ephemeral:true });

    delete ativos[interaction.user.id];
    saveConfig();
    await interaction.message.edit(buildMediatorServicePanel()).catch(()=>{});
    return interaction.reply({ content:'🔴 Você saiu de serviço e não receberá novas filas.', ephemeral:true });
  }

  // ── BOTÃO CONFIRMAR AP ─────────────────────────────────────────────────
  if (id.startsWith('conf_')) {
    const channelId = id.replace('conf_','');
    const info      = canais[channelId];
    if (!info) return interaction.reply({ content:'❌ Dados não encontrados.', ephemeral:true });

    const isPlayer = info.players.find(p=>p.id===interaction.user.id);
    if (!isPlayer) return interaction.reply({ content:'❌ Você não faz parte desta fila.', ephemeral:true });

    if (!info.confirmados) info.confirmados = [];
    if (info.confirmados.includes(interaction.user.id))
      return interaction.reply({ content:'⚠️ Você já confirmou!', ephemeral:true });

    info.confirmados.push(interaction.user.id);

    // No mobile, a primeira confirmação transforma o nome técnico do canal
    // em uma fila curta e fácil de identificar, como "fila-1231".
    if (info.plat === 'mobile' && !info.nomeConfirmado) {
      try {
        await interaction.channel.setName(`fila-${rnd(4)}`);
        info.nomeConfirmado = true;
      } catch {}
    }
    saveCanais();

    await interaction.reply({ content:`✅ <@${interaction.user.id}> confirmou! (${info.confirmados.length}/${info.players.length})` });

    // Quando todos confirmaram → mandar PIX do mediador em serviço
    if (info.confirmados.length >= info.players.length) {
      if (!info.mediador) info.mediador = getMediadoresAtivos()[0] || null;
      const pixInfo = config.pixStaff?.[info.mediador];

      if (!pixInfo) {
        await interaction.channel.send({ embeds:[new EmbedBuilder().setColor(0xE74C3C)
          .setTitle('⚠️ Nenhum mediador em serviço!')
          .setDescription('> Aguarde um mediador entrar em serviço!').setTimestamp()] });
        return;
      }

      if (!info.mediadorAvisado && config.mediadorChannel) {
        try {
          const mediatorChannel = await client.channels.fetch(config.mediadorChannel);
          if (mediatorChannel?.isTextBased()) {
            await mediatorChannel.send({
              content: `<@${info.mediador}>`,
              embeds: [new EmbedBuilder().setColor(0x3498DB)
                .setTitle('📥 NOVA FILA CONFIRMADA')
                .setDescription(
                  `A fila foi confirmada por todos os jogadores.\n\n` +
                  `**Canal da partida:** <#${channelId}>\n` +
                  `**Modo:** ${info.mode.toUpperCase()}\n` +
                  `**Plataforma:** ${info.plat === 'mobile' ? 'Mobile' : info.plat === 'misto' ? 'Misto' : 'Emulador'}\n` +
                  `**Total:** ${fmtVal(info.value * info.players.length)}`
                )
                .setTimestamp()]
            });
            info.mediadorAvisado = true;
            saveCanais();
          }
        } catch {}
      }

      // Gerar QR Code via API pública com o Pix do mediador em serviço.
      const qrUrl = buildPixQrUrl(pixInfo.gmail);

      await interaction.channel.send({ embeds:[new EmbedBuilder().setColor(0x00C896)
        .setTitle('✅ TODOS CONFIRMARAM — Pague o Mediador!')
        .setDescription(
          `> Todos confirmaram! Pague o mediador agora! 💰\n\n` +
          `**📲 PIX do Mediador:**\n\`\`\`${pixInfo.gmail}\`\`\`` +
          `\n**👤 Nome:** \`${pixInfo.nome}\`\n\n` +
          `**Valor:** ${fmtVal(info.value)}\n` +
          `**Total:** ${fmtVal(info.value * info.players.length)}\n\n` +
          `> QR Code abaixo 👇`
        )
        .setImage(qrUrl)
        .setFooter({ text:`${ORG} • Free Fire` }).setTimestamp()] });
    }
    return;
  }

  // ── ENTRAR NA FILA ─────────────────────────────────────────────────────
  if (id.startsWith('fn_') || id.startsWith('fi_')) {
    const parts   = id.split('_');
    const gelType = parts[0]==='fn' ? 'normal' : 'infinito';
    const gelLabel= gelType==='normal' ? '🧊 Gel Normal' : '❄️ Gel Infinito';
    const mode    = parts[1];
    const plat    = parts[2];
    const value   = parseFloat(parts[3]);
    const maxP    = MODES[mode];
    if (!maxP) return interaction.reply({ content:'❌ Modo inválido.', ephemeral:true });

    const fila    = getFila(mode,plat,value);
    const subFila = fila[gelType];

    if (fila.normal.find(p=>p.id===interaction.user.id) || fila.infinito.find(p=>p.id===interaction.user.id))
      return interaction.reply({ content:'⚠️ Você já está na fila!', ephemeral:true });
    if (subFila.length >= maxP)
      return interaction.reply({ content:`❌ Fila ${gelLabel} cheia!`, ephemeral:true });

    const nick = interaction.member.displayName;
    subFila.push({ id:interaction.user.id, name:interaction.user.username, nick });
    saveFilas();

    try { await interaction.message.edit({ embeds:[buildFilaEmbed(mode,plat,value)], components:buildFilaButtons(mode,plat,value) }); } catch {}
    const platName = plat==='mobile' ? 'Mobile' : plat==='misto' ? 'Misto' : 'Emulador';
    await interaction.reply({ content:`✅ Entrou na fila **${mode.toUpperCase()} ${platName}** — ${gelLabel} — ${fmtVal(value)}!`, ephemeral:true });

    if (subFila.length >= maxP) {
      const players = [...subFila];
      fila[gelType] = [];
      saveFilas();
      try { await interaction.message.edit({ embeds:[buildFilaEmbed(mode,plat,value)], components:buildFilaButtons(mode,plat,value) }); } catch {}
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
    const fila  = getFila(mode,plat,value);
    let removido = false;
    for (const gel of ['normal','infinito']) {
      const idx = fila[gel].findIndex(p=>p.id===interaction.user.id);
      if (idx!==-1) { fila[gel].splice(idx,1); removido=true; break; }
    }
    if (!removido) return interaction.reply({ content:'⚠️ Você não está na fila.', ephemeral:true });
    saveFilas();
    try { await interaction.message.edit({ embeds:[buildFilaEmbed(mode,plat,value)], components:buildFilaButtons(mode,plat,value) }); } catch {}
    return interaction.reply({ content:'✅ Saiu da fila.', ephemeral:true });
  }

  // ── VENCEDOR / W.O ─────────────────────────────────────────────────────
  if (id.startsWith('win_') || id.startsWith('wo_')) {
    const isWo   = id.startsWith('wo_');
    const sem    = id.replace(isWo?'wo_':'win_','');
    const parts  = sem.split('_');
    const winnId = parts[parts.length-1];
    const chId   = parts.slice(0,-1).join('_');
    const info   = canais[chId];
    if (!info) return interaction.reply({ content:'❌ Dados não encontrados.', ephemeral:true });
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isAdmin) return interaction.reply({ content:'❌ Só administradores podem registrar o resultado.', ephemeral:true });
    const winner = info.players.find(p=>p.id===winnId);
    if (!winner) return interaction.reply({ content:'❌ Jogador não encontrado.', ephemeral:true });
     if (info.resultado) return interaction.reply({ content:'⚠️ O resultado desta aposta já foi registrado.', ephemeral:true });

     const winnerPix = getRegisteredPix(winnId);
     if (!winnerPix) {
       return interaction.reply({
         content:`❌ **${winner.nick}** ainda não registrou um Pix.\nUse no servidor: \`!registrar pix seugmail@gmail.com Nome de quem recebe\``,
         ephemeral:true,
       });
     }

    if (!config.players) config.players = {};
    if (!config.players[winnId]) config.players[winnId] = { vitorias:0, partidas:0, perdas:0 };
    config.players[winnId].vitorias++;
    config.players[winnId].partidas++;

    // Adicionar derrota pros outros
    for (const p of info.players) {
      if (p.id !== winnId) {
        if (!config.players[p.id]) config.players[p.id] = { vitorias:0, partidas:0, perdas:0 };
        config.players[p.id].perdas++;
      }
    }
     info.resultado = { vencedor:winnId, wo:isWo };
    saveConfig();
     saveCanais();

    await interaction.reply({ embeds:[new EmbedBuilder().setColor(0xFFD700)
      .setTitle(isWo?'⚠️ VITÓRIA POR W.O!':'🏆 VENCEDOR DA APOSTA!')
       .setDescription(
         `> <@${winnId}> (**${winner.nick}**) ganhou${isWo?' por W.O':''}!\n\n` +
         `🏆 +1 Vitória\n🎮 +1 Partida Ganha\n\n` +
         `**Pix para receber:** \`${winnerPix.gmail}\`\n` +
         `**Nome:** \`${winnerPix.nome}\`\n\n` +
         `QR Code para pagamento abaixo.`
       )
       .setImage(buildPixQrUrl(winnerPix.gmail))
      .setTimestamp()] });

    try {
      const user = await client.users.fetch(winnId);
      await user.send({ embeds:[new EmbedBuilder().setColor(0xFFD700)
        .setTitle(`🏆 PARABÉNS — ${ORG}`)
        .setDescription(`> Parabéns! Você ganhou${isWo?' por W.O':''}! 🎉\n\n✅ **+1 Vitória**\n✅ **+1 Partida Ganha**\n\nTotal: **${config.players[winnId].vitorias} vitórias**!`)
        .setFooter({ text:`${ORG} • Free Fire` }).setTimestamp()] });
    } catch {}
    return;
  }
});

const TOKEN = process.env.DISCORD_TOKEN || config.token || 'SEU_TOKEN_AQUI';
client.login(TOKEN);
