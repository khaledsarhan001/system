const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`[db] MongoDB connected: ${conn.connection.host}`);

    // Auto-seed default Admin account upon startup if no admin exists
    const User = require('../models/User');
    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount === 0) {
      console.log('[db] No admin account detected. Automatically seeding default Admin account...');
      await User.create({
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
      console.log('[db] ✓ Default Admin created: Username: admin | Password: Admin@Apparel2026!');
    }
  } catch (error) {
    console.error(`[db] Connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
