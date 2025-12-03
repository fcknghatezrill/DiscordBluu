// index.js - Optimized version of stock notification system

const { Client, Intents } = require('discord.js');
const { Client: DBClient } = require('pg'); // Assume pg for PostgreSQL
const dotenv = require('dotenv');
const fs = require('fs');
const moment = require('moment');

dotenv.config();

// Validate environment variables
if (!process.env.STOCK_ALERT_CHANNEL_ID) {
    throw new Error('STOCK_ALERT_CHANNEL_ID must be defined in .env file');
}

// Initialize database client
const dbClient = new DBClient({
    connectionString: process.env.DATABASE_URL
});

// Initialize Discord client
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

async function setupDatabase() {
    try {
        await dbClient.connect();
        // Create stock alerts table if it doesn't exist
        await dbClient.query(`CREATE TABLE IF NOT EXISTS StockAlerts (id SERIAL PRIMARY KEY, threshold INT NOT NULL, period VARCHAR(10) NOT NULL);`);
    } catch (error) {
        console.error(`Database setup error: ${error.message}`);
    }
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag} at ${moment().format('YYYY-MM-DD HH:mm:ss')}`);
});

// Command handling for setting stock threshold
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('!setstockthreshold')) {
        const args = message.content.split(' ');
        const period = args[1];
        const threshold = parseInt(args[2], 10);
        if (!threshold || !['7d', '30d'].includes(period)) {
            return message.channel.send('Invalid command usage.');
        }
        try {
            await dbClient.query('INSERT INTO StockAlerts (threshold, period) VALUES ($1, $2)', [threshold, period]);
            message.channel.send(`Stock threshold set to ${threshold} for ${period}.`);
        } catch (error) {
            console.error(`Error setting threshold: ${error.message}`);
            message.channel.send('Error setting stock threshold.');
        }
    }
});

async function checkStock() {
    // Placeholder for actual stock checking logic
    const lowStockItems = [/* fetch low stock items */];
    if (lowStockItems.length > 0) {
        const channel = client.channels.cache.get(process.env.STOCK_ALERT_CHANNEL_ID);
        if (channel) {
            lowStockItems.forEach(item => {
                channel.send(`Low stock alert: ${item.name}`);
            });
        } else {
            console.error('Stock alert channel not found.');
        }
    }
}

// Periodically check stock
setInterval(() => {
    try {
        checkStock();
    } catch (error) {
        console.error(`Error on stock check: ${error.message}`);
    }
}, 60000); // Check every 60 seconds

client.login(process.env.BOT_TOKEN);