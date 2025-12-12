const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbCache = new Map();

function getDatabase(guildId) {
    if (dbCache.has(guildId)) {
        return dbCache.get(guildId);
    }

    const dbPath = path.join(dataDir, `${guildId}.db`);
    const db = new Database(dbPath);

    db.exec(`
        CREATE TABLE IF NOT EXISTS codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product TEXT NOT NULL,
            code TEXT NOT NULL UNIQUE,
            used INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            avatar_url TEXT,
            product TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price INTEGER NOT NULL,
            total_price INTEGER NOT NULL,
            purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS leaderboard (
            user_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            total_purchases INTEGER DEFAULT 0,
            total_spent INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            price INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            product TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS testimonials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            avatar_url TEXT,
            message TEXT NOT NULL,
            rating INTEGER DEFAULT 5,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    dbCache.set(guildId, db);
    return db;
}

// ============================================
// PRODUCT FUNCTIONS
// ============================================

function addProduct(guildId, code, name, price) {
    const db = getDatabase(guildId);
    try {
        const stmt = db.prepare('INSERT INTO products (code, name, price) VALUES (?, ?, ?)');
        stmt.run(code.toUpperCase(), name, price);
        return { success: true };
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            return { success: false, error: 'Produk dengan code ini udah ada' };
        }
        return { success: false, error: error.message };
    }
}

function getProducts(guildId) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('SELECT * FROM products ORDER BY name ASC');
    return stmt.all();
}

function getProduct(guildId, code) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('SELECT * FROM products WHERE code = ?');
    return stmt.get(code.toUpperCase());
}

function deleteProduct(guildId, code) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('DELETE FROM products WHERE code = ?');
    const result = stmt.run(code.toUpperCase());
    return result.changes > 0;
}

function updateProduct(guildId, code, name, price) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('UPDATE products SET name = ?, price = ? WHERE code = ?');
    const result = stmt.run(name, price, code.toUpperCase());
    return result.changes > 0;
}

// ============================================
// CODE FUNCTIONS
// ============================================

function addCode(guildId, product, code) {
    const db = getDatabase(guildId);
    try {
        const stmt = db.prepare('INSERT INTO codes (product, code) VALUES (?, ?)');
        stmt.run(product.toUpperCase(), code);
        return { success: true };
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            return { success: false, error: 'Code udah ada di database' };
        }
        return { success: false, error: error.message };
    }
}

function addMultipleCodes(guildId, product, codes) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('INSERT OR IGNORE INTO codes (product, code) VALUES (?, ?)');
    const insertMany = db.transaction((codes) => {
        let added = 0;
        for (const code of codes) {
            const result = stmt.run(product.toUpperCase(), code.trim());
            if (result.changes > 0) added++;
        }
        return added;
    });
    return insertMany(codes);
}

function getAvailableCodes(guildId, product, quantity) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('SELECT * FROM codes WHERE product = ? AND used = 0 LIMIT ?');
    return stmt.all(product.toUpperCase(), quantity);
}

function markCodesAsUsed(guildId, codeIds) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('UPDATE codes SET used = 1 WHERE id = ?');
    const updateMany = db.transaction((ids) => {
        for (const id of ids) {
            stmt.run(id);
        }
    });
    updateMany(codeIds);
}

function deleteCode(guildId, product, code) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('DELETE FROM codes WHERE product = ? AND code = ?');
    const result = stmt.run(product.toUpperCase(), code);
    return result.changes > 0;
}

function viewCodes(guildId, product) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('SELECT * FROM codes WHERE product = ? AND used = 0');
    return stmt.all(product.toUpperCase());
}

function getProductStock(guildId, product) {
    const db = getDatabase(guildId);
    const stmt = db.prepare(`
        SELECT COUNT(*) as count 
        FROM codes 
        WHERE product = ? AND used = 0
    `);
    const result = stmt.get(product.toUpperCase());
    return result ? result.count : 0;
}

function getStock(guildId) {
    const db = getDatabase(guildId);
    const stmt = db.prepare(`
        SELECT product, 
               COUNT(CASE WHEN used = 0 THEN 1 END) as available,
               COUNT(*) as total
        FROM codes 
        GROUP BY product
    `);
    return stmt.all();
}

// ============================================
// ORDER FUNCTIONS
// ============================================

function createOrder(guildId, userId, username, product, quantity) {
    const db = getDatabase(guildId);
    const stmt = db.prepare(`
        INSERT INTO orders (user_id, username, product, quantity, status)
        VALUES (?, ?, ?, ?, 'pending')
    `);
    const result = stmt.run(userId, username, product.toUpperCase(), quantity);
    return result.lastInsertRowid;
}

function updateOrderStatus(guildId, orderId, status) {
    const db = getDatabase(guildId);
    const stmt = db.prepare(`
        UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    const result = stmt.run(status, orderId);
    return result.changes > 0;
}

function getOrder(guildId, orderId) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('SELECT * FROM orders WHERE id = ?');
    return stmt.get(orderId);
}

function getPendingOrders(guildId) {
    const db = getDatabase(guildId);
    const stmt = db.prepare(`SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC`);
    return stmt.all();
}

function getUserOrders(guildId, userId) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10');
    return stmt.all(userId);
}

// ============================================
// PURCHASE FUNCTIONS
// ============================================

function addPurchase(guildId, userId, username, avatarUrl, product, quantity, unitPrice, totalPrice) {
    const db = getDatabase(guildId);
    const stmt = db.prepare(`
        INSERT INTO purchases (user_id, username, avatar_url, product, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(userId, username, avatarUrl, product, quantity, unitPrice, totalPrice);

    const leaderboardStmt = db.prepare(`
        INSERT INTO leaderboard (user_id, username, total_purchases, total_spent)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            username = excluded.username,
            total_purchases = total_purchases + 1,
            total_spent = total_spent + excluded.total_spent
    `);
    leaderboardStmt.run(userId, username, totalPrice);
}

function getPurchases(guildId, limit = 10) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('SELECT * FROM purchases ORDER BY purchased_at DESC LIMIT ?');
    return stmt.all(limit);
}

function getLeaderboard(guildId, limit = 10) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('SELECT * FROM leaderboard ORDER BY total_spent DESC LIMIT ?');
    return stmt.all(limit);
}

function getSalesHistory(guildId) {
    const db = getDatabase(guildId);
    
    const dailyStmt = db.prepare(`
        SELECT COALESCE(SUM(total_price), 0) as total
        FROM purchases 
        WHERE date(purchased_at) = date('now')
    `);
    const daily = dailyStmt.get();

    const weeklyStmt = db.prepare(`
        SELECT COALESCE(SUM(total_price), 0) as total
        FROM purchases 
        WHERE purchased_at >= datetime('now', '-7 days')
    `);
    const weekly = weeklyStmt.get();

    const monthlyStmt = db.prepare(`
        SELECT COALESCE(SUM(total_price), 0) as total
        FROM purchases 
        WHERE strftime('%Y-%m', purchased_at) = strftime('%Y-%m', 'now')
    `);
    const monthly = monthlyStmt.get();

    const allTimeStmt = db.prepare(`
        SELECT COALESCE(SUM(total_price), 0) as total
        FROM purchases
    `);
    const allTime = allTimeStmt.get();

    return {
        daily: daily.total,
        weekly: weekly.total,
        monthly: monthly.total,
        allTime: allTime.total
    };
}

// ============================================
// TESTIMONIAL FUNCTIONS
// ============================================

function addTestimonial(guildId, userId, username, avatarUrl, message, rating = 5) {
    const db = getDatabase(guildId);
    const stmt = db.prepare(`
        INSERT INTO testimonials (user_id, username, avatar_url, message, rating)
        VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(userId, username, avatarUrl, message, rating);
    return result.lastInsertRowid;
}

function getTestimonials(guildId, limit = 10) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('SELECT * FROM testimonials ORDER BY created_at DESC LIMIT ?');
    return stmt.all(limit);
}

// ============================================
// SETTINGS FUNCTIONS
// ============================================

function setSetting(guildId, key, value) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run(key, value);
}

function getSetting(guildId, key) {
    const db = getDatabase(guildId);
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get(key);
    return result ? result.value : null;
}

module.exports = {
    getDatabase,
    // Products
    addProduct,
    getProducts,
    getProduct,
    deleteProduct,
    updateProduct,
    // Codes
    addCode,
    addMultipleCodes,
    getAvailableCodes,
    markCodesAsUsed,
    deleteCode,
    viewCodes,
    getProductStock,
    getStock,
    // Orders
    createOrder,
    updateOrderStatus,
    getOrder,
    getPendingOrders,
    getUserOrders,
    // Purchases
    addPurchase,
    getPurchases,
    getLeaderboard,
    getSalesHistory,
    // Testimonials
    addTestimonial,
    getTestimonials,
    // Settings
    setSetting,
    getSetting
};