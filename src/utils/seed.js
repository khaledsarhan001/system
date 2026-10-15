/**
 * Database Seed Script
 * Run:  npm run seed
 *
 * Creates a default admin account and sample products.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[seed] Connected to MongoDB');

    // ─── Clear existing data ────────────────────────────────────
    await User.deleteMany({});
    await Product.deleteMany({});
    console.log('[seed] Cleared existing users and products');

    // ─── Create Admin ───────────────────────────────────────────
    const admin = await User.create({
      name: 'System Admin',
      email: 'admin@apparel.com',
      password: 'Admin@123456',
      role: 'admin',
    });
    console.log(`[seed] Admin created: ${admin.email}`);

    // ─── Create Employee ────────────────────────────────────────
    const employee = await User.create({
      name: 'John Employee',
      email: 'john@apparel.com',
      password: 'Employee@123',
      role: 'employee',
    });
    console.log(`[seed] Employee created: ${employee.email}`);

    // ─── Create Sample Products ─────────────────────────────────
    const products = await Product.insertMany([
      {
        name: 'Classic Crew Neck T-Shirt',
        category: 'shirts',
        sku: 'SHR-CN-001',
        sizes: ['S', 'M', 'L', 'XL'],
        colors: ['White', 'Black', 'Navy'],
        costPrice: 8.50,
        retailPrice: 24.99,
        quantity: 150,
        description: 'Premium cotton crew neck t-shirt',
      },
      {
        name: 'Slim Fit Chinos',
        category: 'pants',
        sku: 'PNT-SF-002',
        sizes: ['S', 'M', 'L', 'XL', 'XXL'],
        colors: ['Khaki', 'Navy', 'Olive'],
        costPrice: 18.00,
        retailPrice: 49.99,
        quantity: 80,
        description: 'Stretch cotton slim fit chinos',
      },
      {
        name: 'Floral Summer Dress',
        category: 'dresses',
        sku: 'DRS-FL-003',
        sizes: ['XS', 'S', 'M', 'L'],
        colors: ['Blue Floral', 'Pink Floral'],
        costPrice: 22.00,
        retailPrice: 64.99,
        quantity: 45,
        description: 'Lightweight floral print summer dress',
      },
      {
        name: 'Leather Bomber Jacket',
        category: 'jackets',
        sku: 'JKT-LB-004',
        sizes: ['M', 'L', 'XL'],
        colors: ['Black', 'Brown'],
        costPrice: 65.00,
        retailPrice: 189.99,
        quantity: 25,
        description: 'Genuine leather bomber jacket with satin lining',
      },
      {
        name: 'Running Shorts',
        category: 'activewear',
        sku: 'ACT-RS-005',
        sizes: ['S', 'M', 'L', 'XL'],
        colors: ['Black', 'Grey', 'Blue'],
        costPrice: 7.00,
        retailPrice: 29.99,
        quantity: 200,
        description: 'Moisture-wicking running shorts with pockets',
      },
    ]);

    console.log(`[seed] Created ${products.length} sample products`);
    console.log('\n[seed] ✓ Seeding complete!');
    console.log('───────────────────────────────────────────');
    console.log('  Admin login:    admin@apparel.com / Admin@123456');
    console.log('  Employee login: john@apparel.com  / Employee@123');
    console.log('───────────────────────────────────────────\n');

    process.exit(0);
  } catch (error) {
    console.error(`[seed] Error: ${error.message}`);
    process.exit(1);
  }
};

seedData();
