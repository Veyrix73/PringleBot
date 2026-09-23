import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import Groq from 'groq-sdk';
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

const env = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || '',
  staffRoleId: process.env.STAFF_ROLE_ID || '',
  ticketCategoryId: process.env.TICKET_CATEGORY_ID || '',
  logChannelId: process.env.LOG_CHANNEL_ID || '',
  serverName: process.env.SERVER_NAME || 'PringleSMP',
  mcIp: process.env.MC_IP || 'pringlesmp.mcsh.io',
  mcPort: process.env.MC_PORT || '19132',
  invite: process.env.DISCORD_INVITE || 'https://discord.gg/5BSSkFeNfR',
  aiEnabled: process.env.AI_ENABLED !== 'false',
  groqKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  fallbackModel: process.env.GROQ_FALLBACK_MODEL || 'llama-3.3-70b-versatile',
  port: Number(process.env.PORT || 10000),
};

const BT = String.fromCharCode(96);
const dataDir = path.join(process.cwd(), 'data');
const dataFile = path.join(dataDir, 'guilds.json');
fs.mkdirSync(dataDir, { recursive: true });

function loadGuilds() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return {}; }
}
function saveGuilds() {
  fs.writeFileSync(dataFile, JSON.stringify(guilds, null, 2));
}
let guilds = loadGuilds();

const ticketTypes = {
  general: ['General Support', 'Ask the PringleSMP team anything.'],
  ban_appeal: ['Ban Appeal', 'Appeal a punishment and explain what happened.'],
  media_request: ['Media Request', 'Request creator/media help from the team.'],
  mute_appeal: ['Mute Appeal', 'Appeal a mute and provide context.'],
  lag_machine: ['Lag Machine Appeal', 'Report or appeal a lag-machine related action.'],
  admin_request: ['Admin Request', 'Request help from an administrator.'],
  shop_item: ['Shop Item Request', 'Request an item for the server shop.'],
  player_report: ['Player Report', 'Report a player with useful evidence.'],
};

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Show PringleBot commands'),
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
  new SlashCommandBuilder().setName('status').setDescription('Show bot and ticket system status'),
  new SlashCommandBuilder().setName('server').setDescription('Show PringleSMP connection information'),
  new SlashCommandBuilder().setName('ask').setDescription('Ask PringleAI a question')
    .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true)),
  new SlashCommandBuilder().setName('panel').setDescription('Post the support ticket panel'),
  new SlashCommandBuilder().setName('setup').setDescription('Create/reuse the staff role, ticket category and logs'),
  new SlashCommandBuilder().setName('tickets').setDescription('List open tickets'),
  new SlashCommandBuilder().setName('claim').setDescription('Claim the current ticket'),
  new SlashCommandBuilder().setName('close').setDescription('Close the current ticket')
    .addStringOption(o => o.setName('reason').setDescription('Close reason').setRequired(false)),
  new SlashCommandBuilder().setName('add').setDescription('Add a user to the current ticket')
    .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true)),
  new SlashCommandBuilder().setName('remove').setDescription('Remove a user from the current ticket')
    .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)),
  new SlashCommandBuilder().setName('announce').setDescription('Send an announcement in this channel')
    .addStringOption(o => o.setName('message').setDescription('Announcement text').setRequired(true)),
  new SlashCommandBuilder().setName('setai').setDescription('Enable or disable PringleAI')
    .addBooleanOption(o => o.setName('enabled').setDescription('AI enabled').setRequired(true)),
].map(c => c.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const groq = env.groqKey ? new Groq({ apiKey: env.groqKey }) : null;
const aiCooldown = new Map();
const spamBuckets = new Map();

function setupFor(guild) {
  return guilds[guild.id] || {};
}
function idsFor(guild) {
  const s = setupFor(guild);
  return {
    staffRoleId: s.staffRoleId || env.staffRoleId,
    categoryId: s.ticketCategoryId || env.ticketCategoryId,
    logChannelId: s.logChannelId || env.logChannelId,
  };
}
function isStaff(member) {
  if (!member?.roles) return false;
  const ids = idsFor(member.guild);
  return member.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions?.has(PermissionFlagsBits.ManageChannels) ||
    Boolean(ids.staffRoleId && member.roles.cache.has(ids.staffRoleId));
}
function ticketFrom(channel) {
  if (!channel?.topic?.startsWith('pringlebot:')) return null;
  try { return JSON.parse(channel.topic.slice('pringlebot:'.length)); }
  catch { return null; }
}
function humanName(user) {
  return (user.globalName || user.username || 'user').replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 18) || 'user';
}
function stamp() { return new Date().toISOString(); }

function panelMessage() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_select')
    .setPlaceholder('Choose what you need help with...')
    .addOptions(Object.entries(ticketTypes).map(([value, [name, description]]) => ({ value, label: name, description })));
  return {
    embeds: [new EmbedBuilder()
      .setTitle('🍪 PringleSMP Support')
      .setDescription('Need help? Open a private ticket below. Staff will be notified automatically.\n\n**AI Support:** ' + (env.aiEnabled && groq ? 'Online' : 'Disabled') + '')
      .setFooter({ text: 'PringleBot • PringleSMP' })],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
}

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setEmoji('🛠️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
}

async function ensureSetup(guild) {
  let staff = idsFor(guild).staffRoleId ? guild.roles.cache.get(idsFor(guild).staffRoleId) : null;
  if (!staff) staff = guild.roles.cache.find(r => r.name === 'Pringle Staff');
  if (!staff) {
    staff = await guild.roles.create({
      name: 'Pringle Staff',
      color: 0xF5A623,
      reason: 'PringleBot ticket staff role',
    });
  }

  let category = idsFor(guild).categoryId ? guild.channels.cache.get(idsFor(guild).categoryId) : null;
  if (!category) category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === 'TICKETS & SUPPORT');
  const baseOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: staff.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
  ];
  if (!category) {
    category = await guild.channels.create({ name: 'TICKETS & SUPPORT', type: ChannelType.GuildCategory, permissionOverwrites: baseOverwrites, reason: 'PringleBot ticket category' });
  } else {
    await category.permissionOverwrites.set(baseOverwrites, 'PringleBot ticket category permissions');
  }

  let logs = idsFor(guild).logChannelId ? guild.channels.cache.get(idsFor(guild).logChannelId) : null;
  if (!logs) logs = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === 'ticket-logs');
  if (!logs) {
    logs = await guild.channels.create({ name: 'ticket-logs', type: ChannelType.GuildText, parent: category.id, permissionOverwrites: baseOverwrites, reason: 'PringleBot ticket logs' });
  }

  guilds[guild.id] = { staffRoleId: staff.id, ticketCategoryId: category.id, logChannelId: logs.id, aiEnabled: setupFor(guild).aiEnabled ?? true };
  saveGuilds();
  return guilds[guild.id];
}

async function postLog(guild, content, file) {
  const id = idsFor(guild).logChannelId;
  if (!id) return;
  const channel = guild.channels.cache.get(id);
  if (!channel?.isTextBased()) return;
  const payload = { content };
  if (file) payload.files = [file];
  await channel.send(payload).catch(() => {});
}

async function transcript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return 'Transcript unavailable.';
  return [...messages.values()].reverse().map(m => {
    const when = new Date(m.createdTimestamp).toISOString();
    const body = m.content || '[attachment/embed/component]';
    return '[' + when + '] ' + m.author.tag + ': ' + body;
  }).join('\n');
}

async function closeTicket(channel, closer, reason = 'Closed by staff') {
  const data = ticketFrom(channel);
  if (!data) return false;
  const text = await transcript(channel);
  const fileName = channel.name + '-' + Date.now() + '.txt';
  await postLog(channel.guild, '🔒 **Ticket closed**\n' + channel.toString() + '\n**Owner:** <@' + data.ownerId + '>\n**Closed by:** ' + closer + '\n**Reason:** ' + reason, {
    attachment: Buffer.from(text, 'utf8'),
    name: fileName,
  });
  await channel.send('🔒 This ticket is closing. The transcript has been saved.').catch(() => {});
  setTimeout(() => channel.delete('PringleBot ticket closed').catch(() => {}), 2500);
  return true;
}

async function createTicket(interaction, type, subject, details) {
  const guild = interaction.guild;
  const existing = guild.channels.cache.find(c => {
    const d = ticketFrom(c);
    return d?.ownerId === interaction.user.id;
  });
  if (existing) return interaction.reply({ content: 'You already have an open ticket: ' + existing, ephemeral: true });

  let setup = setupFor(guild);
  if (!setup.staffRoleId || !setup.ticketCategoryId) setup = await ensureSetup(guild);
  const staffRole = guild.roles.cache.get(setup.staffRoleId);
  if (!staffRole) return interaction.reply({ content: 'Ticket setup is incomplete. Run /setup first.', ephemeral: true });

  const safeSubject = subject.replace(/[^a-z0-9 -]/gi, '').trim().slice(0, 35) || 'support';
  const channelName = 'ticket-' + humanName(interaction.user) + '-' + String(Math.floor(Math.random() * 9000) + 1000);
  const topic = 'pringlebot:' + JSON.stringify({ ownerId: interaction.user.id, type, subject: safeSubject, createdAt: stamp(), claimedBy: null });
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: setup.ticketCategoryId,
    topic,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels] },
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
    ],
    reason: 'PringleBot ticket opened',
  });

  const [name, desc] = ticketTypes[type] || ticketTypes.general;
  await channel.send({
    content: '<@' + interaction.user.id + '> <@&' + staffRole.id + '>',
    embeds: [new EmbedBuilder().setTitle('🎫 ' + name).setDescription(
      '**Subject:** ' + safeSubject + '\n\n' + details.slice(0, 3500) + '\n\n**Opened by:** <@' + interaction.user.id + '>\n**AI:** ' + (env.aiEnabled && groq ? 'available in this ticket' : 'disabled')
    ).addFields({ name: 'About', value: desc }).setTimestamp()],
    components: [ticketButtons()],
  });
  await postLog(guild, '🎫 **Ticket opened** ' + channel + ' by <@' + interaction.user.id + '> • ' + name);
  return interaction.reply({ content: '✅ Ticket created: ' + channel, ephemeral: true });
}

function recentSpam(userId) {
  const now = Date.now();
  const list = (spamBuckets.get(userId) || []).filter(t => now - t < 10000);
  list.push(now);
  spamBuckets.set(userId, list);
  return list.length > 7;
}

function aiAllowed(guild) {
  const custom = guild ? setupFor(guild).aiEnabled : true;
  return env.aiEnabled && groq && custom !== false;
}

function aiSystem(guild) {
  return [
    'You are PringleAI, the support assistant for ' + env.serverName + '.',
    'Minecraft server IP: ' + env.mcIp + ':' + env.mcPort + '.',
    'Discord: ' + env.invite + '.',
    'Be friendly, direct, and concise. Use Discord-friendly Markdown.',
    'Do not invent rules, staff actions, player data, punishments, or private information.',
    'You cannot actually ban, unban, mute, refund, edit permissions, or access private channels.',
    'When a question needs a staff decision, tell the user to wait for staff in the ticket.',
    guild ? 'Current server: ' + guild.name : '',
  ].filter(Boolean).join('\n');
}

async function askAI(guild, question) {
  if (!groq || !aiAllowed(guild)) return 'PringleAI is currently disabled. A staff member can still help you.';
  try {
    const run = model => groq.chat.completions.create({
      model,
      temperature: 0.4,
      max_tokens: 700,
      messages: [
        { role: 'system', content: aiSystem(guild) },
        { role: 'user', content: question.slice(0, 5000) },
      ],
    });
    let result;
    try { result = await run(env.groqModel); }
    catch { result = await run(env.fallbackModel); }
    return result.choices?.[0]?.message?.content?.trim() || 'I could not generate an answer right now. Please ask staff.';
  } catch (error) {
    console.error('AI error:', error.message);
    return 'PringleAI had a temporary error. Please try again or wait for staff.';
  }
}

async function sendLong(channel, text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += 1900) chunks.push(text.slice(i, i + 1900));
  for (const chunk of chunks.slice(0, 4)) await channel.send({ content: chunk });
}

async function registerCommands() {
  if (!env.token || !env.clientId) return;
  const rest = new REST({ version: '10' }).setToken(env.token);
  const route = env.guildId ? Routes.applicationGuildCommands(env.clientId, env.guildId) : Routes.applicationCommands(env.clientId);
  await rest.put(route, { body: commands });
  console.log('Registered ' + commands.length + ' slash commands ' + (env.guildId ? 'in guild ' + env.guildId : 'globally') + '.');
}

client.once('ready', async () => {
  console.log('🤖 Logged in as ' + client.user.tag + ' • ' + client.guilds.cache.size + ' guild(s)');
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const guild = interaction.guild;
      if (interaction.commandName === 'help') {
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🍪 PringleBot').setDescription(
          '**Member:** ' + [
            BT + '/help' + BT + ' — commands', BT + '/ping' + BT + ' — latency', BT + '/status' + BT + ' — status', BT + '/server' + BT + ' — server info', BT + '/ask' + BT + ' — AI support'
          ].join('\n') + '\n\n**Staff:** ' + [
            BT + '/setup' + BT + ', ' + BT + '/panel' + BT + ', ' + BT + '/tickets' + BT + ', ' + BT + '/claim' + BT + ', ' + BT + '/close' + BT + ', ' + BT + '/add' + BT + ', ' + BT + '/remove' + BT + ', ' + BT + '/announce' + BT + ', ' + BT + '/setai' + BT
          ].join('')
        )], ephemeral: true });
      }
      if (interaction.commandName === 'ping') return interaction.reply('🏓 Pong! ' + client.ws.ping + 'ms');
      if (interaction.commandName === 'server') {
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🌐 ' + env.serverName).setDescription(
          '**Minecraft IP:** ' + BT + env.mcIp + BT + '\n**Port:** ' + BT + env.mcPort + BT + '\n**Discord:** ' + env.invite
        ).setFooter({ text: 'PringleBot' })] });
      }
      if (interaction.commandName === 'status') {
        const open = guild ? guild.channels.cache.filter(c => Boolean(ticketFrom(c))).size : 0;
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('📊 PringleBot Status').addFields(
          { name: 'Bot', value: 'Online', inline: true },
          { name: 'AI', value: aiAllowed(guild) ? 'Online' : 'Disabled', inline: true },
          { name: 'Open tickets', value: String(open), inline: true },
          { name: 'Uptime', value: Math.floor(process.uptime()) + 's', inline: true },
        ).setTimestamp()] });
      }
      if (interaction.commandName === 'ask') {
        if (!guild) return interaction.reply({ content: 'Use this command inside the PringleSMP Discord server.', ephemeral: true });
        const now = Date.now();
        const last = aiCooldown.get(interaction.user.id) || 0;
        if (now - last < 8000) return interaction.reply({ content: '⏳ Please wait a few seconds before asking PringleAI again.', ephemeral: true });
        aiCooldown.set(interaction.user.id, now);
        await interaction.deferReply();
        return interaction.editReply(await askAI(guild, interaction.options.getString('question', true)));
      }
      if (!guild) return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });

      if (interaction.commandName === 'setup') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        const setup = await ensureSetup(guild);
        return interaction.editReply('✅ Setup complete.\nStaff role: <@&' + setup.staffRoleId + '>\nCategory: <#' + setup.ticketCategoryId + '>\nLogs: <#' + setup.logChannelId + '>');
      }
      if (interaction.commandName === 'panel') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server.', ephemeral: true });
        return interaction.channel.send(panelMessage()).then(() => interaction.reply({ content: '✅ Ticket panel posted.', ephemeral: true }));
      }
      if (interaction.commandName === 'tickets') {
        if (!isStaff(interaction.member)) return interaction.reply({ content: 'Staff only.', ephemeral: true });
        const list = guild.channels.cache.filter(c => ticketFrom(c)).map(c => {
          const d = ticketFrom(c);
          return '• ' + c.toString() + ' — ' + (ticketTypes[d.type]?.[0] || d.type) + ' — <@' + d.ownerId + '>';
        });
        return interaction.reply({ content: list.length ? '**Open tickets (' + list.length + ')**\n' + list.join('\n') : 'No open tickets.', ephemeral: true });
      }
      const current = ticketFrom(interaction.channel);
      if (interaction.commandName === 'claim') {
        if (!current || !isStaff(interaction.member)) return interaction.reply({ content: 'Staff only, and this must be used in a ticket.', ephemeral: true });
        current.claimedBy = interaction.user.id;
        await interaction.channel.setTopic('pringlebot:' + JSON.stringify(current));
        return interaction.reply('🛠️ Ticket claimed by <@' + interaction.user.id + '>.');
      }
      if (interaction.commandName === 'close') {
        if (!current) return interaction.reply({ content: 'This is not a ticket.', ephemeral: true });
        if (current.ownerId !== interaction.user.id && !isStaff(interaction.member)) return interaction.reply({ content: 'Only the ticket owner or staff can close this ticket.', ephemeral: true });
        const reason = interaction.options.getString('reason') || 'Closed by user';
        await interaction.reply('🔒 Closing ticket...');
        return closeTicket(interaction.channel, interaction.user.tag, reason);
      }
      if (interaction.commandName === 'add' || interaction.commandName === 'remove') {
        if (!current || !isStaff(interaction.member)) return interaction.reply({ content: 'Staff only, and this must be used in a ticket.', ephemeral: true });
        const user = interaction.options.getUser('user', true);
        const allow = interaction.commandName === 'add';
        await interaction.channel.permissionOverwrites.edit(user.id, allow ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true } : { ViewChannel: false });
        return interaction.reply((allow ? '➕ Added ' : '➖ Removed ') + user.toString() + ' from the ticket.');
      }
      if (interaction.commandName === 'announce') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server.', ephemeral: true });
        const message = interaction.options.getString('message', true);
        await interaction.channel.send({ content: '📢 **PringleSMP Announcement**\n\n' + message, allowedMentions: { parse: [] } });
        return interaction.reply({ content: '✅ Sent.', ephemeral: true });
      }
      if (interaction.commandName === 'setai') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server.', ephemeral: true });
        const enabled = interaction.options.getBoolean('enabled', true);
        guilds[guild.id] = { ...setupFor(guild), aiEnabled: enabled };
        saveGuilds();
        return interaction.reply('🤖 PringleAI is now **' + (enabled ? 'enabled' : 'disabled') + '** for this server.');
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
      const type = interaction.values[0];
      const [name] = ticketTypes[type] || ticketTypes.general;
      const modal = new ModalBuilder().setCustomId('ticket_modal:' + type).setTitle(name.slice(0, 45));
      const subject = new TextInputBuilder().setCustomId('subject').setLabel('Short subject').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder('What do you need help with?');
      const details = new TextInputBuilder().setCustomId('details').setLabel('Details / evidence').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3000).setPlaceholder('Explain what happened. Add useful details, usernames, times, etc.');
      modal.addComponents(new ActionRowBuilder().addComponents(subject), new ActionRowBuilder().addComponents(details));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal:')) {
      const type = interaction.customId.split(':')[1];
      return createTicket(interaction, type, interaction.fields.getTextInputValue('subject'), interaction.fields.getTextInputValue('details'));
    }

    if (interaction.isButton()) {
      const data = ticketFrom(interaction.channel);
      if (!data) return interaction.reply({ content: 'This is not a ticket.', ephemeral: true });
      if (interaction.customId === 'ticket_claim') {
        if (!isStaff(interaction.member)) return interaction.reply({ content: 'Staff only.', ephemeral: true });
        data.claimedBy = interaction.user.id;
        await interaction.channel.setTopic('pringlebot:' + JSON.stringify(data));
        return interaction.reply('🛠️ Claimed by <@' + interaction.user.id + '>.');
      }
      if (interaction.customId === 'ticket_close') {
        if (data.ownerId !== interaction.user.id && !isStaff(interaction.member)) return interaction.reply({ content: 'Only the ticket owner or staff can close it.', ephemeral: true });
        await interaction.reply('🔒 Closing ticket...');
        return closeTicket(interaction.channel, interaction.user.tag, 'Closed from ticket button');
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const response = { content: '⚠️ Something went wrong. Please try again.', ephemeral: true };
    if (interaction.deferred) await interaction.editReply(response).catch(() => {});
    else if (!interaction.replied) await interaction.reply(response).catch(() => {});
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const ticket = ticketFrom(message.channel);
  if (ticket) {
    if (!recentSpam(message.author.id) && message.guild && ticket.ownerId === message.author.id) {
      const now = Date.now();
      const last = aiCooldown.get(message.author.id) || 0;
      if (now - last >= 8000 && aiAllowed(message.guild)) {
        aiCooldown.set(message.author.id, now);
        const answer = await askAI(message.guild, message.content);
        await message.reply({ content: answer.slice(0, 1900), allowedMentions: { repliedUser: false } }).catch(() => {});
      }
    }
    return;
  }

  if (!message.guild) {
    if (!recentSpam(message.author.id)) {
      const answer = await askAI(null, message.content);
      await sendLong(message.channel, answer).catch(() => {});
    }
    return;
  }

  const mentioned = message.mentions.has(client.user);
  if (mentioned && !recentSpam(message.author.id)) {
    const now = Date.now();
    const last = aiCooldown.get(message.author.id) || 0;
    if (now - last < 8000) return;
    aiCooldown.set(message.author.id, now);
    const question = message.content.replace(new RegExp('<@!?' + client.user.id + '>', 'g'), '').trim();
    if (!question) return message.reply('🍪 Ask me something! Example: @PringleBot how do I open a support ticket?');
    await message.channel.sendTyping().catch(() => {});
    await sendLong(message.channel, await askAI(message.guild, question)).catch(() => {});
  }
});

client.on('error', error => console.error('Discord client error:', error));
process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

const app = express();
app.get('/', (_req, res) => res.json({ name: 'PringleBot', status: 'online', server: env.serverName }));
app.get('/health', (_req, res) => res.status(client.isReady() ? 200 : 503).json({ ok: client.isReady(), uptime: process.uptime(), guilds: client.guilds.cache.size }));
app.get('/version', (_req, res) => res.json({ version: '2.0.0' }));
app.listen(env.port, '0.0.0.0', () => console.log('🌐 Health server listening on port ' + env.port));

if (!env.token || !env.clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID. Copy .env.example to .env and fill the values.');
  process.exit(1);
}

await registerCommands();
if (process.argv.includes('--register-only')) process.exit(0);
await client.login(env.token);
