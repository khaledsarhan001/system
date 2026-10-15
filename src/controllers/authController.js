const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// ─── Helper: Send token response ──────────────────────────────────
const sendTokenResponse = (user, statusCode, res) => {
  const token = user.generateAuthToken();

  // Strip password from output
  const userObj = user.toObject();
  delete userObj.password;

  res.status(statusCode).json({
    success: true,
    token,
    data: userObj,
  });
};

// ─── POST /api/v1/auth/register ─── Admin creates accounts ───────
exports.register = asyncHandler(async (req, res) => {
  const { name, email, username, password, role = 'employee', phone = '', address = '', branch = '' } = req.body;

  // Only admins can create admin accounts
  if (role === 'admin' && req.user.role !== 'admin') {
    throw new ApiError('Only admins can create admin accounts.', 403);
  }

  const normalizedUsername = (username || (email ? email.split('@')[0] : name.replace(/\s+/g, '').toLowerCase())).trim().toLowerCase();
  const avatar = name ? name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'EM';

  const user = await User.create({
    name,
    email: email.trim().toLowerCase(),
    username: normalizedUsername,
    password,
    role,
    phone,
    address,
    branch,
    avatar
  });
  sendTokenResponse(user, 201, res);
});

// ─── POST /api/v1/auth/login ──────────────────────────────────────
exports.login = asyncHandler(async (req, res) => {
  const { email, username, identifier, loginIdentifier, password } = req.body;
  const loginKey = (identifier || loginIdentifier || username || email || '').trim().toLowerCase();

  if (!loginKey || !password) {
    throw new ApiError('Username/email and password are required.', 400);
  }

  // Explicitly select password (hidden by default), allow login via username or email
  const user = await User.findOne({
    $or: [{ email: loginKey }, { username: loginKey }]
  }).select('+password');

  if (!user) {
    throw new ApiError('Invalid credentials.', 401);
  }

  if (!user.isActive) {
    throw new ApiError('This account has been deactivated. Contact an administrator.', 403);
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new ApiError('Invalid credentials.', 401);
  }

  sendTokenResponse(user, 200, res);
});

// ─── GET /api/v1/auth/me ─────────────────────────────────────────
exports.getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  res.status(200).json({ success: true, data: user });
});

// ─── GET /api/v1/auth/users ─── Admin: list all users ─────────────
exports.getUsers = asyncHandler(async (req, res) => {
  const { role, isActive, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const total = await User.countDocuments(filter);
  const users = await User.find(filter)
    .sort('-createdAt')
    .skip(skip)
    .limit(parseInt(limit, 10));

  res.status(200).json({
    success: true,
    count: users.length,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / parseInt(limit, 10)),
    data: users,
  });
});

// ─── PUT /api/v1/auth/users/:id ─── Admin: update user ───────────
exports.updateUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    throw new ApiError('User not found.', 404);
  }

  res.status(200).json({ success: true, data: user });
});

// ─── PATCH /api/v1/auth/users/:id/deactivate ─── Admin ───────────
exports.deactivateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) throw new ApiError('User not found.', 404);
  if (user._id.equals(req.user._id)) {
    throw new ApiError('You cannot deactivate your own account.', 400);
  }

  user.isActive = false;
  await user.save();

  res.status(200).json({ success: true, message: 'User deactivated.', data: user });
});

// ─── DELETE /api/v1/auth/users/:id ─── Admin: hard delete ────────
exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) throw new ApiError('User not found.', 404);
  if (user._id.equals(req.user._id)) {
    throw new ApiError('You cannot delete your own account.', 400);
  }

  await user.deleteOne();

  res.status(200).json({ success: true, message: 'User permanently deleted.' });
});
