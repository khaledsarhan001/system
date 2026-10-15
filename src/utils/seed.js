/**
 * Production Database Reset & Clean Seeding Script
 * Run: npm run seed
 *
 * Wipes all test/mock products, dummy employees, and sample transactions.
 * Creates ONLY ONE default Admin account:
 *   Username: admin
 *   Email:    admin@apparel.com
 *   Password: Admin@Apparel2026!
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');

const seedData = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/apparel_inventory';
    await mongoose.connect(mongoUri);
    console.log('[seed] Connected to MongoDB');

    // ─── 1. Complete Data Reset: Wipe all mock/sample data ───────────────────
    await User.deleteMany({});
    await Product.deleteMany({});
    await Transaction.deleteMany({});
    console.log('[seed] ✓ Completely wiped all existing users, dummy products, and sample transactions.');

    // ─── 2. Create ONLY ONE default Admin account ───────────────────────────
    const admin = await User.create({
      name: 'System Administrator',
      username: 'admin',
      email: 'admin@apparel.com',
      password: 'Admin@Apparel2026!',
      role: 'admin',
      phone: '',
      address: '',
      branch: 'Headquarters',
      avatar: 'SA',
      isActive: true,
    });

    console.log(`[seed] ✓ Single Production Admin Created: ${admin.username} (${admin.email})`);
    console.log('\n[seed] ═══════════════════════════════════════════════════');
    console.log('  PRODUCTION CLIENT-READY CREDENTIALS:');
    console.log('  Username: admin');
    console.log('  Email:    admin@apparel.com');
    console.log('  Password: Admin@Apparel2026!');
    console.log('  Role:     admin (Full Access)');
    console.log('═══════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error(`[seed] Error: ${error.message}`);
    process.exit(1);
  }
};

seedData();
