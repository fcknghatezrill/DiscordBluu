const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    PermissionFlagsBits, 
    ActivityType,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events
} = require('discord.js');
const config = require('./config.json');
const db = require('./database.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// ============================================
// VARIABEL GLOBAL
// ============================================

const liveStockMessages = new Map();
const liveLeaderboardMessages = new Map();
const lastUpdateTime = new Map();
const updateQueue = new Map();
let isProcessingQueue = false;

// ============================================
// FUNGSI HELPER
// ============================================

function formatRupiah(angka) {
    if (angka === null || angka === undefined) return 'Rp 0';
    return 'Rp ' + angka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function hasPermission(member) {
    if (!member) return false;
    return member.permissions.has(PermissionFlagsBits.Administrator) || 
           member.roles.cache.some(role => role.name.toLowerCase() === 'owner');
}

function parseCommand(content) {
    const prefix = config.prefixes.find(p => content.startsWith(p));
    if (!prefix) return null;

    const args = content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    return { command, args, prefix };
}

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) {
        return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    } else {
        const hours = Math.floor(seconds / 3600);
        return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }
}

function getProductInfo(guildId, productCode) {
    const product = db.getProduct(guildId, productCode);
    if (product) {
        return { name: product.name, price: product.price };
    }
    return null;
}

// ============================================
// EMBED CREATORS
// ============================================

function createStockEmbed(guildId, guildName) {
    const lastUpdate = lastUpdateTime.get(guildId) || Date.now();
    const products = db.getProducts(guildId);

    const embed = new EmbedBuilder()
        .setTitle('Live Stock')
        .setColor(config.colors.primary)
        .setFooter({ text: `Last updated ${formatTimeAgo(lastUpdate)}` })
        .setTimestamp();

    if (config.stockImage) {
        embed.setImage(config.stockImage);
    }

    if (products.length === 0) {
        embed.setDescription('Belum ada produk yang tersedia');
    } else {
        let description = '';
        for (const product of products) {
            const stockCount = db.getProductStock(guildId, product.code);
            description += `**${product.name}**\n`;
            description += `Stock: **${stockCount}**\n`;
            description += `Harga: **${formatRupiah(product.price)}**\n\n`;
        }
        embed.setDescription(description);
    }

    return embed;
}

function createLeaderboardEmbed(guildId) {
    const leaderboard = db.getLeaderboard(guildId, 10);
    const lastUpdate = lastUpdateTime.get(`lb_${guildId}`) || Date.now();

    const embed = new EmbedBuilder()
        .setTitle('Leaderboard - Top Buyers')
        .setColor(config.colors.warning)
        .setImage(config.lbImage)
        .setFooter({ text: `Last updated ${formatTimeAgo(lastUpdate)}` })
        .setTimestamp();

    if (leaderboard.length === 0) {
        embed.setDescription('Belum ada data pembelian');
    } else {
        let description = '';
        leaderboard.forEach((user, index) => {
            const medal = index === 0 ? '1' : index === 1 ? '2' : index === 2 ? '3' : `${index + 1}`;
            description +=`**${medal}. ${user.username}**`;
            description += `Total Beli: ${user.total_purchases}x | Total: ${formatRupiah(user.total_spent)}\n\n`;
        });
        embed.setDescription(description);
    }

    return embed;
}

// ============================================
// UPDATE QUEUE SYSTEM
// ============================================

async function processUpdateQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (updateQueue.size > 0) {
        for (const [key, data] of updateQueue.entries()) {
            updateQueue.delete(key);
            
            try {
                if (data.type === 'stock') {
                    await doUpdateLiveStock(data.guildId);
                } else if (data.type === 'leaderboard') {
                    await doUpdateLiveLeaderboard(data.guildId);
                }
            } catch (error) {
                console.log(`Error processing queue for ${key}:`, error.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    isProcessingQueue = false;
}

function queueStockUpdate(guildId) {
    updateQueue.set(`stock_${guildId}`, { type: 'stock', guildId });
    processUpdateQueue();
}

function queueLeaderboardUpdate(guildId) {
    updateQueue.set(`leaderboard_${guildId}`, { type: 'leaderboard', guildId });
    processUpdateQueue();
}

async function doUpdateLiveStock(guildId) {
    const messageData = liveStockMessages.get(guildId);
    if (!messageData) return;

    try {
        const channel = await client.channels.fetch(messageData.channelId);
        if (!channel) {
            liveStockMessages.delete(guildId);
            return;
        }

        const message = await channel.messages.fetch(messageData.messageId).catch(() => null);
        if (!message) {
            liveStockMessages.delete(guildId);
            return;
        }

        lastUpdateTime.set(guildId, Date.now());
        const embed = createStockEmbed(guildId, channel.guild.name);
        await message.edit({ embeds: [embed] });
        
        console.log(`Updated stock for guild ${guildId}`);
    } catch (error) {
        console.log(`Error updating live stock for guild ${guildId}:`, error.message);
        if (error.code === 10008 || error.code === 404) {
            liveStockMessages.delete(guildId);
        }
    }
}

async function doUpdateLiveLeaderboard(guildId) {
    const messageData = liveLeaderboardMessages.get(guildId);
    if (!messageData) return;

    try {
        const channel = await client.channels.fetch(messageData.channelId);
        if (!channel) {
            liveLeaderboardMessages.delete(guildId);
            return;
        }

        const message = await channel.messages.fetch(messageData.messageId).catch(() => null);
        if (!message) {
            liveLeaderboardMessages.delete(guildId);
            return;
        }

        lastUpdateTime.set(`lb_${guildId}`, Date.now());
        const embed = createLeaderboardEmbed(guildId);
        await message.edit({ embeds: [embed] });
        
        console.log(`Updated leaderboard for guild ${guildId}`);
    } catch (error) {
        console.log(`Error updating leaderboard for guild ${guildId}:`, error.message);
        if (error.code === 10008 || error.code === 404) {
            liveLeaderboardMessages.delete(guildId);
        }
    }
}

async function updateAllLiveMessages() {
    for (const guildId of liveStockMessages.keys()) {
        queueStockUpdate(guildId);
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    for (const guildId of liveLeaderboardMessages.keys()) {
        queueLeaderboardUpdate(guildId);
    }
}

// Interval untuk update
setInterval(() => {
    updateAllLiveMessages();
}, config.updateInterval);

// ============================================
// AUTO ROLE - MEMBER BARU
// ============================================

client.on('guildMemberAdd', async (member) => {
    try {
        const autoRoleName = db.getSetting(member.guild.id, 'auto_role') || config.autoRoleName;
        const role = member.guild.roles.cache.find(r => r.name.toLowerCase() === autoRoleName.toLowerCase());
        
        if (role) {
            await member.roles.add(role);
            console.log(`Auto role "${role.name}" diberikan ke ${member.user.username}`);
        }
    } catch (error) {
        console.log(`Error giving auto role:`, error.message);
    }
});

// ============================================
// READY EVENT
// ============================================

client.once('ready', async () => {
    console.log(`Bot ${client.user.tag} udah online dan siap jualan!`);
    
    client.user.setPresence({
        activities: [{ 
            name: 'Bot Managed by Bluuskiee', 
            type: ActivityType.Watching 
        }],
        status: 'dnd'
    });

    for (const guild of client.guilds.cache.values()) {
        const guildId = guild.id;
        
        const stockChannelId = db.getSetting(guildId, 'live_stock_channel');
        const stockMessageId = db.getSetting(guildId, 'live_stock_message');
        if (stockChannelId && stockMessageId) {
            liveStockMessages.set(guildId, {
                channelId: stockChannelId,
                messageId: stockMessageId
            });
            lastUpdateTime.set(guildId, Date.now());
        }

        const leaderboardChannelId = db.getSetting(guildId, 'leaderboard_channel');
        const leaderboardMessageId = db.getSetting(guildId, 'leaderboard_message');
        if (leaderboardChannelId && leaderboardMessageId) {
            liveLeaderboardMessages.set(guildId, {
                channelId: leaderboardChannelId,
                messageId: leaderboardMessageId
            });
            lastUpdateTime.set(`lb_${guildId}`, Date.now());
        }
    }
    
    setTimeout(() => {
        updateAllLiveMessages();
    }, 10000);
});

// ============================================
// MESSAGE CREATE EVENT
// ============================================

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const parsed = parseCommand(message.content);
    if (!parsed) return;

    const { command, args } = parsed;
    const guildId = message.guild.id;

    // ========== COMMAND QRIS (PUBLIC) ==========
    if (command === 'qris') {
        const qrisImage = db.getSetting(guildId, 'qris_image') || config.defaultQrisImage;
        
        if (!qrisImage) {
            const embed = new EmbedBuilder()
                .setTitle('QRIS Belum Di-setup')
                .setDescription('Admin belum setup QRIS. Hubungi admin ya')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }
        
        const embed = new EmbedBuilder()
            .setTitle('Pembayaran QRIS')
            .setDescription('Scan QRIS di bawah ini untuk melakukan pembayaran\n\nSetelah bayar, hubungi admin ya')
            .setColor(config.colors.primary)
            .setImage(qrisImage)
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // ========== COMMAND ADDTESTI (PUBLIC) ==========
    if (command === 'addtesti') {
        const testiMessage = args.join(' ');
        
        if (!testiMessage) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!addtesti <pesan testimoni>`\nContoh: `!addtesti Pelayanan cepat dan ramah, recommended!`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const testiId = db.addTestimonial(
            guildId,
            message.author.id,
            message.author.username,
            message.author.displayAvatarURL({ dynamic: true }),
            testiMessage,
            5
        );

        const testiChannelId = db.getSetting(guildId, 'testi_channel');
        
        if (testiChannelId) {
            try {
                const testiChannel = await client.channels.fetch(testiChannelId);
                if (testiChannel) {
                    const testiEmbed = new EmbedBuilder()
                        .setTitle('Testimoni Buyers')
                        .setDescription(testiMessage)
                        .addFields(
                            { name: 'Buyers', value: String(message.author.username), inline: true }
                        )
                        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                        .setColor(config.colors.success)
                        .setTimestamp();
                    testiChannel.send({ embeds: [testiEmbed] });
                }
            } catch (error) {
                console.log('Error sending testi:', error.message);
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('Testimoni Diterima')
            .setDescription('Makasih udah kasih testimoni!')
            .setColor(config.colors.success);
        return message.reply({ embeds: [embed] });
    }

    // ========== CEK PERMISSION UNTUK COMMAND ADMIN ==========
    if (!hasPermission(message.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Akses Ditolak')
            .setDescription('Lu ga punya akses buat pake command ini. Minta tolong Owner atau Admin ya')
            .setColor(config.colors.error);
        return message.reply({ embeds: [embed] });
    }

    // ========== COMMAND ADDPRODUK ==========
    if (command === 'addproduk') {
        if (args.length < 3) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!addproduk <code> <harga> <nama produk>`\nContoh: `!addproduk 7d 19500 Redfinger 7 Days`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const code = args[0].toUpperCase();
        const price = parseInt(args[1]);
        const name = args.slice(2).join(' ');

        if (isNaN(price) || price < 0) {
            const embed = new EmbedBuilder()
                .setTitle('Harga Invalid')
                .setDescription('Harga harus berupa angka positif')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const result = db.addProduct(guildId, code, name, price);

        if (result.success) {
            const embed = new EmbedBuilder()
                .setTitle('Produk Ditambahkan')
                .setDescription('Produk baru berhasil ditambahkan')
                .addFields(
                    { name: 'Code', value: String(code), inline: true },
                    { name: 'Nama', value: String(name), inline: true },
                    { name: 'Harga', value: String(formatRupiah(price)), inline: true }
                )
                .setColor(config.colors.success)
                .setTimestamp();
            message.reply({ embeds: [embed] });
            queueStockUpdate(guildId);
        } else {
            const embed = new EmbedBuilder()
                .setTitle('Gagal Tambah Produk')
                .setDescription(result.error || 'Unknown error')
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND DELPRODUK ==========
    else if (command === 'delproduk') {
        if (args.length < 1) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!delproduk <code>`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const code = args[0].toUpperCase();
        const deleted = db.deleteProduct(guildId, code);

        if (deleted) {
            const embed = new EmbedBuilder()
                .setTitle('Produk Dihapus')
                .setDescription(`Produk **${code}** berhasil dihapus`)
                .setColor(config.colors.success);
            message.reply({ embeds: [embed] });
            queueStockUpdate(guildId);
        } else {
            const embed = new EmbedBuilder()
                .setTitle('Produk Tidak Ditemukan')
                .setDescription(`Produk dengan code **${code}** ga ada`)
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND LISTPRODUK ==========
    else if (command === 'listproduk') {
        const products = db.getProducts(guildId);

        if (products.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('Daftar Produk')
                .setDescription('Belum ada produk yang ditambahkan')
                .setColor(config.colors.warning);
            return message.reply({ embeds: [embed] });
        }

        let description = '';
        products.forEach((p, i) => {
            const stock = db.getProductStock(guildId, p.code);
            description += `**${i + 1}. ${p.name}**\n`;
            description += `   Harga: ${formatRupiah(p.price)} | Stock: ${stock}\n\n`;
        });

        const embed = new EmbedBuilder()
            .setTitle('Daftar Produk')
            .setDescription(description)
            .setColor(config.colors.primary)
            .setTimestamp();
        message.reply({ embeds: [embed] });
    }

    // ========== COMMAND PROSES ==========
    else if (command === 'proses') {
        if (args.length < 1) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!proses <order_id>`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const orderId = parseInt(args[0]);
        const order = db.getOrder(guildId, orderId);

        if (!order) {
            const embed = new EmbedBuilder()
                .setTitle('Order Tidak Ditemukan')
                .setDescription(`Order #${orderId} ga ada`)
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        db.updateOrderStatus(guildId, orderId, 'processing');

        const embed = new EmbedBuilder()
            .setTitle('Order Diproses')
            .setDescription(`Order #${orderId} sedang diproses`)
            .addFields(
                { name: 'User', value: String(order.username), inline: true },
                { name: 'Produk', value: String(order.product), inline: true },
                { name: 'Jumlah', value: String(order.quantity), inline: true }
            )
            .setColor(config.colors.warning)
            .setTimestamp();
        message.reply({ embeds: [embed] });
    }

    // ========== COMMAND DONE ==========
    else if (command === 'done') {
        if (args.length < 1) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!done <order_id>`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const orderId = parseInt(args[0]);
        const order = db.getOrder(guildId, orderId);

        if (!order) {
            const embed = new EmbedBuilder()
                .setTitle('Order Tidak Ditemukan')
                .setDescription(`Order #${orderId} ga ada`)
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        db.updateOrderStatus(guildId, orderId, 'completed');

        const embed = new EmbedBuilder()
            .setTitle('Order Selesai')
            .setDescription(`Order #${orderId} sudah selesai`)
            .addFields(
                { name: 'User', value: String(order.username), inline: true },
                { name: 'Produk', value: String(order.product), inline: true },
                { name: 'Status', value: 'Completed', inline: true }
            )
            .setColor(config.colors.success)
            .setTimestamp();
        message.reply({ embeds: [embed] });
    }

    // ========== COMMAND CANCEL ==========
    else if (command === 'cancel') {
        if (args.length < 1) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!cancel <order_id>`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const orderId = parseInt(args[0]);
        const order = db.getOrder(guildId, orderId);

        if (!order) {
            const embed = new EmbedBuilder()
                .setTitle('Order Tidak Ditemukan')
                .setDescription(`Order #${orderId} ga ada`)
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        db.updateOrderStatus(guildId, orderId, 'cancelled');

        const embed = new EmbedBuilder()
            .setTitle('Order Dibatalkan')
            .setDescription(`Order #${orderId} sudah dibatalkan`)
            .addFields(
                { name: 'User', value: String(order.username), inline: true },
                { name: 'Produk', value: String(order.product), inline: true },
                { name: 'Status', value: 'Cancelled', inline: true }
            )
            .setColor(config.colors.error)
            .setTimestamp();
        message.reply({ embeds: [embed] });
    }

    // ========== COMMAND ORDERS ==========
    else if (command === 'orders') {
        const orders = db.getPendingOrders(guildId);

        if (orders.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('Pending Orders')
                .setDescription('Ga ada order yang pending')
                .setColor(config.colors.info);
            return message.reply({ embeds: [embed] });
        }

        let description = '';
        orders.forEach(o => {
            description += `**#${o.id}** - ${o.username}\n`;
            description += `Produk: ${o.product} x${o.quantity}\n`;
            description += `Status: ${o.status}\n\n`;
        });

        const embed = new EmbedBuilder()
            .setTitle('Pending Orders')
            .setDescription(description)
            .setColor(config.colors.warning)
            .setTimestamp();
        message.reply({ embeds: [embed] });
    }

    // ========== COMMAND KICK ==========
    else if (command === 'kick') {
        const targetUser = message.mentions.members.first();
        const reason = args.slice(1).join(' ') || 'Tidak ada alasan';

        if (!targetUser) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!kick @user [alasan]`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        if (!targetUser.kickable) {
            const embed = new EmbedBuilder()
                .setTitle('Tidak Bisa Kick')
                .setDescription('Ga bisa kick user ini. Mungkin role nya lebih tinggi')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        try {
            await targetUser.kick(reason);
            const embed = new EmbedBuilder()
                .setTitle('User Dikick')
                .setDescription(`**${targetUser.user.username}** berhasil di-kick`)
                .addFields({ name: 'Alasan', value: String(reason) })
                .setColor(config.colors.success)
                .setTimestamp();
            message.reply({ embeds: [embed] });
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('Gagal Kick')
                .setDescription(`Error: ${error.message}`)
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND BAN ==========
    else if (command === 'ban') {
        const targetUser = message.mentions.members.first();
        const reason = args.slice(1).join(' ') || 'Tidak ada alasan';

        if (!targetUser) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!ban @user [alasan]`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        if (!targetUser.bannable) {
            const embed = new EmbedBuilder()
                .setTitle('Tidak Bisa Ban')
                .setDescription('Ga bisa ban user ini. Mungkin role nya lebih tinggi')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        try {
            await targetUser.ban({ reason: reason });
            const embed = new EmbedBuilder()
                .setTitle('User Dibanned')
                .setDescription(`**${targetUser.user.username}** berhasil di-ban`)
                .addFields({ name: 'Alasan', value: String(reason) })
                .setColor(config.colors.success)
                .setTimestamp();
            message.reply({ embeds: [embed] });
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('Gagal Ban')
                .setDescription(`Error: ${error.message}`)
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND UNBAN ==========
    else if (command === 'unban') {
        const userId = args[0];

        if (!userId) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!unban <user_id>`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        try {
            await message.guild.members.unban(userId);
            const embed = new EmbedBuilder()
                .setTitle('User Di-unban')
                .setDescription(`User dengan ID **${userId}** berhasil di-unban`)
                .setColor(config.colors.success)
                .setTimestamp();
            message.reply({ embeds: [embed] });
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('Gagal Unban')
                .setDescription(`Error: ${error.message}`)
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND PURGE ==========
    else if (command === 'purge') {
        const amount = parseInt(args[0]);

        if (isNaN(amount) || amount < 1 || amount > 100) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!purge (max 99))')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        try {
            const deleted = await message.channel.bulkDelete(amount + 1, true);
            const embed = new EmbedBuilder()
                .setTitle('Pesan Dihapus')
                .setDescription(`Berhasil hapus **${deleted.size - 1}** pesan`)
                .setColor(config.colors.success);
            const reply = await message.channel.send({ embeds: [embed] });
            setTimeout(() => reply.delete().catch(() => {}), 3000);
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('Gagal Purge')
                .setDescription(`Error: ${error.message}`)
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND LOCK ==========
    else if (command === 'lock') {
        try {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
                SendMessages: false
            });
            const embed = new EmbedBuilder()
                .setTitle('Channel Dikunci')
                .setDescription('Channel ini sudah dikunci. Member tidak bisa mengirim pesan')
                .setColor(config.colors.warning)
                .setTimestamp();
            message.reply({ embeds: [embed] });
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('Gagal Lock')
                .setDescription(`Error: ${error.message}`)
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND UNLOCK ==========
    else if (command === 'unlock') {
        try {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
                SendMessages: true
            });
            const embed = new EmbedBuilder()
                .setTitle('Channel Dibuka')
                .setDescription('Channel ini sudah dibuka. Member bisa mengirim pesan')
                .setColor(config.colors.success)
                .setTimestamp();
            message.reply({ embeds: [embed] });
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('Gagal Unlock')
                .setDescription(`Error: ${error.message}`)
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND SEND ==========
    else if (command === 'send') {
        if (args.length < 3) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!send <produk> <jumlah> @user`\nContoh: `!send VIP7D 1 @user`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const product = args[0].toUpperCase();
        const quantity = parseInt(args[1]);
        const targetUser = message.mentions.users.first();

        const productInfo = getProductInfo(guildId, product);

        if (!productInfo) {
            const embed = new EmbedBuilder()
                .setTitle('Produk Tidak Ditemukan')
                .setDescription(`Produk "${product}" ga ada. Cek !listproduk`)
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        if (isNaN(quantity) || quantity < 1) {
            const embed = new EmbedBuilder()
                .setTitle('Jumlah Invalid')
                .setDescription('Jumlah harus angka dan minimal 1')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        if (!targetUser) {
            const embed = new EmbedBuilder()
                .setTitle('User Tidak Ditemukan')
                .setDescription('Mention user yang mau dikasih code')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const codes = db.getAvailableCodes(guildId, product, quantity);

        if (codes.length < quantity) {
            const embed = new EmbedBuilder()
                .setTitle('Stock Tidak Cukup')
                .setDescription(`Stock ${product} cuma ada ${codes.length}, tapi lu minta ${quantity}`)
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const unitPrice = productInfo.price;
        const totalPrice = unitPrice * quantity;

        db.markCodesAsUsed(guildId, codes.map(c => c.id));

        db.addPurchase(
            guildId,
            targetUser.id,
            targetUser.username,
            targetUser.displayAvatarURL({ dynamic: true }),
            product,
            quantity,
            unitPrice,
            totalPrice
        );

        const codeList = codes.map(c => c.code).join('\n');
        const dmEmbed = new EmbedBuilder()
            .setTitle('Pembelian Berhasil')
            .setDescription(`Makasih udah beli di **${message.guild.name}**`)
            .addFields(
                { name: 'Produk', value: String(productInfo.name), inline: true },
                { name: 'Jumlah', value: String(quantity), inline: true },
                { name: 'Code Kamu', value: `\`\`\`\n${codeList}\n\`\`\`` }
            )
            .setColor(config.colors.success)
            .setTimestamp();

        try {
            await targetUser.send({ embeds: [dmEmbed] });
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('Gagal Kirim DM')
                .setDescription(`Ga bisa kirim DM ke ${targetUser.username}. DM nya mungkin di-disable`)
                .addFields({ name: 'Code', value: `\`\`\`\n${codeList}\n\`\`\`` })
                .setColor(config.colors.warning);
            message.channel.send({ embeds: [embed] });
        }

        const confirmEmbed = new EmbedBuilder()
            .setTitle('Code Berhasil Dikirim')
            .setDescription(`${quantity}x ${productInfo.name} udah dikirim ke ${targetUser.username}`)
            .setColor(config.colors.success)
            .setTimestamp();
        message.reply({ embeds: [confirmEmbed] });

        const purchaseLogsChannelId = db.getSetting(guildId, 'purchase_logs_channel');
        if (purchaseLogsChannelId) {
            try {
                const logsChannel = await client.channels.fetch(purchaseLogsChannelId);
                if (logsChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('Purchase Log')
                        .setDescription(`Terimakasih telah membeli **${productInfo.name}** di **${message.guild.name}**`)
                        .addFields(
                            { name: 'Pembeli', value: String(targetUser.username), inline: true },
                            { name: 'Produk', value: String(productInfo.name), inline: true },
                            { name: 'Jumlah', value: String(quantity), inline: true },
                            { name: 'Harga Satuan', value: String(formatRupiah(unitPrice)), inline: true },
                            { name: 'Total Harga', value: String(formatRupiah(totalPrice)), inline: true }
                        )
                        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                        .setColor(config.colors.success)
                        .setTimestamp();
                    logsChannel.send({ embeds: [logEmbed] });
                }
            } catch (error) {
                console.log('Error sending purchase log:', error.message);
            }
        }

        queueStockUpdate(guildId);
        queueLeaderboardUpdate(guildId);
    }

    // ========== COMMAND ADDCODE ==========
    else if (command === 'addcode') {
        if (args.length < 2) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!addcode <produk> <code>`\nContoh: `!addcode VIP7D ABC123`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const product = args[0].toUpperCase();
        const code = args.slice(1).join(' ');

        const productInfo = getProductInfo(guildId, product);
        if (!productInfo) {
            const embed = new EmbedBuilder()
                .setTitle('Produk Tidak Ditemukan')
                .setDescription(`Produk "${product}" ga ada. Tambah dulu pake !addproduk`)
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const result = db.addCode(guildId, product, code);

        if (result.success) {
            const embed = new EmbedBuilder()
                .setTitle('Code Ditambahkan')
                .setDescription(`Berhasil tambah code ke **${productInfo.name}**`)
                .setColor(config.colors.success)
                .setTimestamp();
            message.reply({ embeds: [embed] });
            queueStockUpdate(guildId);
        } else {
            const embed = new EmbedBuilder()
                .setTitle('Gagal Tambah Code')
                .setDescription(result.error || 'Unknown error')
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND IMPORT ==========
    else if (command === 'import') {
        if (args.length < 2) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!import <produk> <code1> <code2> ...`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const product = args[0].toUpperCase();

        const productInfo = getProductInfo(guildId, product);
        if (!productInfo) {
            const embed = new EmbedBuilder()
                .setTitle('Produk Tidak Ditemukan')
                .setDescription(`Produk "${product}" ga ada. Tambah dulu pake !addproduk`)
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const rawCodes = args.slice(1).join(' ');
        const codes = rawCodes.split(/[\n\s]+/).filter(c => c.trim() !== '');

        if (codes.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('Tidak Ada Code')
                .setDescription('Ga ada code yang bisa di-import')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const added = db.addMultipleCodes(guildId, product, codes);

        const embed = new EmbedBuilder()
            .setTitle('Import Selesai')
            .setDescription(`Berhasil import **${added}** dari **${codes.length}** code ke **${productInfo.name}**`)
            .setColor(config.colors.success)
            .setTimestamp();
        message.reply({ embeds: [embed] });
        queueStockUpdate(guildId);
    }

    // ========== COMMAND ADDROLE ==========
    else if (command === 'addrole') {
        const targetUser = message.mentions.members.first();
        const targetRole = message.mentions.roles.first();

        if (!targetUser || !targetRole) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!addrole @user @role`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        try {
            await targetUser.roles.add(targetRole);
            const embed = new EmbedBuilder()
                .setTitle('Role Ditambahkan')
                .setDescription(`Berhasil kasih role **${targetRole.name}** ke **${targetUser.user.username}**`)
                .setColor(config.colors.success)
                .setTimestamp();
            message.reply({ embeds: [embed] });
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('Gagal Tambah Role')
                .setDescription(`Error: ${error.message}`)
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND REMOVEROLE ==========
    else if (command === 'removerole') {
        const targetUser = message.mentions.members.first();
        const targetRole = message.mentions.roles.first();

        if (!targetUser || !targetRole) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!removerole @user @role`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        try {
            await targetUser.roles.remove(targetRole);
            const embed = new EmbedBuilder()
                .setTitle('Role Dihapus')
                .setDescription(`Berhasil hapus role **${targetRole.name}** dari **${targetUser.user.username}**`)
                .setColor(config.colors.success)
                .setTimestamp();
            message.reply({ embeds: [embed] });
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('Gagal Hapus Role')
                .setDescription(`Error: ${error.message}`)
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND EMBED ==========
    else if (command === 'embed') {
        const embedContent = args.join(' ');
        if (embedContent) {
            const parts = embedContent.split('|').map(p => p.trim());
            const customEmbed = new EmbedBuilder()
                .setTitle(parts[0] || 'Untitled')
                .setDescription(parts[1] || 'No description')
                .setColor(parts[2] || config.colors.primary)
                .setTimestamp();
            
            return message.channel.send({ embeds: [customEmbed] });
        }
        
        const embed = new EmbedBuilder()
            .setTitle('Embed Builder')
            .setDescription('Format: `!embed Title | Description | #Color`\nContoh: `!embed Judul | Ini deskripsi | #5865F2`')
            .setColor(config.colors.primary);
        message.reply({ embeds: [embed] });
    }

    // ========== COMMAND DELCODE ==========
    else if (command === 'delcode') {
        if (args.length < 2) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!delcode <produk> <code>`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const product = args[0].toUpperCase();
        const code = args.slice(1).join(' ');

        const deleted = db.deleteCode(guildId, product, code);

        if (deleted) {
            const embed = new EmbedBuilder()
                .setTitle('Code Dihapus')
                .setDescription(`Berhasil hapus code dari **${product}**`)
                .setColor(config.colors.success)
                .setTimestamp();
            message.reply({ embeds: [embed] });
            queueStockUpdate(guildId);
        } else {
            const embed = new EmbedBuilder()
                .setTitle('Code Tidak Ditemukan')
                .setDescription('Code yang mau dihapus ga ada di database')
                .setColor(config.colors.error);
            message.reply({ embeds: [embed] });
        }
    }

    // ========== COMMAND VIEWCODE ==========
    else if (command === 'viewcode') {
        if (args.length < 1) {
            const embed = new EmbedBuilder()
                .setTitle('Format Salah')
                .setDescription('Format: `!viewcode <produk>`')
                .setColor(config.colors.error);
            return message.reply({ embeds: [embed] });
        }

        const product = args[0].toUpperCase();
        const codes = db.viewCodes(guildId, product);

        if (codes.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(`Codes - ${product}`)
                .setDescription('Ga ada code yang tersedia')
                .setColor(config.colors.warning);
            return message.reply({ embeds: [embed] });
        }

        const codeList = codes.map(c => c.code);
        const chunks = [];
        for (let i = 0; i < codeList.length; i += 20) {
            chunks.push(codeList.slice(i, i + 20));
        }

        for (let i = 0; i < chunks.length; i++) {
            const embed = new EmbedBuilder()
                .setTitle(`Codes - ${product} (${i + 1}/${chunks.length})`)
                .setDescription(`\`\`\`\n${chunks[i].join('\n')}\n\`\`\``)
                .setColor(config.colors.primary)
                .setFooter({ text: `Total: ${codes.length} codes` });
            
            if (i === 0) {
                message.reply({ embeds: [embed] });
            } else {
                message.channel.send({ embeds: [embed] });
            }
        }
    }

    // ========== COMMAND SALES ==========
    else if (command === 'sales') {
        const sales = db.getSalesHistory(guildId);

        const embed = new EmbedBuilder()
            .setTitle('Sales History')
            .addFields(
                { name: 'Hari Ini', value: String(formatRupiah(sales.daily || 0)), inline: true },
                { name: 'Minggu Ini', value: String(formatRupiah(sales.weekly || 0)), inline: true },
                { name: 'Bulan Ini', value: String(formatRupiah(sales.monthly || 0)), inline: true },
                { name: 'Total Keseluruhan', value: String(formatRupiah(sales.allTime || 0)), inline: false }
            )
            .setColor(config.colors.success)
            .setTimestamp();
        message.reply({ embeds: [embed] });
    }

    // ========== COMMAND SETAUTOROLE ==========
    else if (command === 'setautorole') {
        const roleName = args.join(' ');
        
        if (!roleName) {
            const currentRole = db.getSetting(guildId, 'auto_role') || config.autoRoleName;
            const embed = new EmbedBuilder()
                .setTitle('Auto Role')
                .setDescription(`Format: \`!setautorole <nama role>\`\nAuto role saat ini: **${currentRole}**`)
                .setColor(config.colors.primary);
            return message.reply({ embeds: [embed] });
        }

        db.setSetting(guildId, 'auto_role', roleName);
        
        const embed = new EmbedBuilder()
            .setTitle('Auto Role Diset')
            .setDescription(`Member baru akan otomatis dapat role **${roleName}**`)
            .setColor(config.colors.success);
        message.reply({ embeds: [embed] });
    }

    // ========== COMMAND SETUP ==========
    else if (command === 'setup') {
        const subCommand = args[0]?.toLowerCase();

        if (subCommand === 'stock') {
            lastUpdateTime.set(guildId, Date.now());
            const embed = createStockEmbed(guildId, message.guild.name);
            const msg = await message.channel.send({ embeds: [embed] });
            
            liveStockMessages.set(guildId, {
                channelId: message.channel.id,
                messageId: msg.id
            });
            db.setSetting(guildId, 'live_stock_channel', message.channel.id);
            db.setSetting(guildId, 'live_stock_message', msg.id);

            const confirmEmbed = new EmbedBuilder()
                .setTitle('Live Stock Setup')
                .setDescription('Live stock udah di-setup di channel ini')
                .setColor(config.colors.success);
            message.reply({ embeds: [confirmEmbed] });
        }
        else if (subCommand === 'leaderboard') {
            lastUpdateTime.set(`lb_${guildId}`, Date.now());
            const embed = createLeaderboardEmbed(guildId);
            const msg = await message.channel.send({ embeds: [embed] });
            
            liveLeaderboardMessages.set(guildId, {
                channelId: message.channel.id,
                messageId: msg.id
            });
            db.setSetting(guildId, 'leaderboard_channel', message.channel.id);
            db.setSetting(guildId, 'leaderboard_message', msg.id);

            const confirmEmbed = new EmbedBuilder()
                .setTitle('Leaderboard Setup')
                .setDescription('Leaderboard udah di-setup di channel ini')
                .setColor(config.colors.success);
            message.reply({ embeds: [confirmEmbed] });
        }
        else if (subCommand === 'logs') {
            db.setSetting(guildId, 'purchase_logs_channel', message.channel.id);

            const embed = new EmbedBuilder()
                .setTitle('Purchase Logs Setup')
                .setDescription('Purchase logs udah di-setup di channel ini')
                .setColor(config.colors.success);
            message.reply({ embeds: [embed] });
        }
        else if (subCommand === 'testi') {
            db.setSetting(guildId, 'testi_channel', message.channel.id);

            const embed = new EmbedBuilder()
                .setTitle('Testimoni Channel Setup')
                .setDescription('Channel testimoni udah di-setup di channel ini')
                .setColor(config.colors.success);
            message.reply({ embeds: [embed] });
        }
        else if (subCommand === 'qris') {
            const imageUrl = args[1];
            
            if (!imageUrl) {
                const currentQris = db.getSetting(guildId, 'qris_image') || config.defaultQrisImage;
                
                const embed = new EmbedBuilder()
                    .setTitle('Setup QRIS')
                    .setDescription('Format: `!setup qris <link_gambar>`')
                    .addFields({ name: 'QRIS Saat Ini', value: currentQris || 'Belum di-setup' })
                    .setColor(config.colors.primary);
                
                if (currentQris && currentQris.startsWith('http')) {
                    embed.setImage(currentQris);
                }
                
                return message.reply({ embeds: [embed] });
            }

            if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
                const embed = new EmbedBuilder()
                    .setTitle('URL Tidak Valid')
                    .setDescription('Link gambar harus dimulai dengan http:// atau https://')
                    .setColor(config.colors.error);
                return message.reply({ embeds: [embed] });
            }

            db.setSetting(guildId, 'qris_image', imageUrl);

            const embed = new EmbedBuilder()
                .setTitle('QRIS Berhasil Di-setup')
                .setDescription('Gambar QRIS udah diupdate')
                .setImage(imageUrl)
                .setColor(config.colors.success)
                .setTimestamp();
            message.reply({ embeds: [embed] });
        }
        else {
            const embed = new EmbedBuilder()
                .setTitle('Setup Commands')
                .setDescription('Pilih mau setup apa:')
                .addFields(
                    { name: '!setup stock', value: 'Setup live stock di channel ini', inline: false },
                    { name: '!setup leaderboard', value: 'Setup leaderboard di channel ini', inline: false },
                    { name: '!setup logs', value: 'Setup purchase logs di channel ini', inline: false },
                    { name: '!setup testi', value: 'Setup channel testimoni di channel ini', inline: false },
                    { name: '!setup qris <link>', value: 'Setup gambar QRIS pembayaran', inline: false }
                )
                .setColor(config.colors.primary);
            message.reply({ embeds: [embed] });
        }
    }

// ========== COMMAND HELP ==========
else if (command === 'help') {
    const embed = new EmbedBuilder()
        .setTitle('Help Menu')
        .setDescription(`
**PRODUK**
\`addproduk\` \`delproduk\` \`listproduk\`

**CODE**
\`addcode\` \`import\` \`delcode\` \`viewcode\`

**ORDER**
\`send\`

**MODERASI**
\`kick\` \`ban\` \`unban\` \`purge\` \`lock\` \`unlock\`

**ROLE**
\`addrole\` \`removerole\` \`setautorole\`

**LAINNYA**
\`qris\` \`addtesti\` \`sales\` \`stock\` \`embed\`

**SETUP**
\`setup stock\` \`setup leaderboard\` \`setup logs\` \`setup testi\` \`setup qris\`

Ketik \`!<command>\` untuk info lebih lanjut
Prefix: \`!\` \`.\` \`?\`
Public: \`!qris\` \`!addtesti\`
        `)
        .setColor(config.colors.primary)
        .setFooter({ text: 'Contoh: !addproduk rbx 50000 160 Robux' })
        .setTimestamp();
    message.reply({ embeds: [embed] });
}

    // ========== COMMAND STOCK ==========
    else if (command === 'stock') {
        const embed = createStockEmbed(guildId, message.guild.name);
        message.reply({ embeds: [embed] });
    }
});

// ============================================
// LOGIN
// ============================================

client.login(config.token);