const fs = require('fs');
const path = require('path');

const portalDir = path.resolve(__dirname, '..', '..', 'dnc-portal');

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeFile(relPath, content) {
  const fullPath = path.join(portalDir, relPath);
  ensureDir(fullPath);
  fs.writeFileSync(fullPath, content.trim() + '\n', 'utf8');
  console.log('Created:', relPath);
}

// 1. .env.local
writeFile('.env.local', `
MONGODB_URI=mongodb+srv://umairzakria6:<db_password>@cluster0.5dcfg.mongodb.net/dnc_license_db?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=dnc_ultra_secure_jwt_token_secret_key_2026_xyz!
ADMIN_USERNAME=MUadmin
ADMIN_PASSWORD=umadmin
PORT=3000
`);

// 2. src/lib/mongodb.js
writeFile('src/lib/mongodb.js', `
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.warn('⚠️ Please define MONGODB_URI inside .env.local');
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

export async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 8000,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongooseInstance) => {
      console.log('✅ Connected to MongoDB Atlas');
      return mongooseInstance;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}
`);

// 3. src/lib/models/User.js
writeFile('src/lib/models/User.js', `
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
    },
    displayName: {
      type: String,
      trim: true,
      default: '',
    },
    role: {
      type: String,
      enum: ['admin', 'user'],
      default: 'user',
    },
    planName: {
      type: String,
      default: 'Standard',
      trim: true,
    },
    lookupsTotal: {
      type: Number,
      default: 100,
      min: 0,
    },
    lookupsRemaining: {
      type: Number,
      default: 100,
      min: 0,
    },
    totalLookupsUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      default: '',
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

UserSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.models.User || mongoose.model('User', UserSchema);
`);

// 4. src/lib/auth.js
writeFile('src/lib/auth.js', `
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from './models/User';
import { connectToDatabase } from './mongodb';

const JWT_SECRET = process.env.JWT_SECRET || 'dnc_default_fallback_secret_xyz123';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

export async function getAuthUser(req) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded || !decoded.id) {
    return null;
  }
  await connectToDatabase();
  const user = await User.findById(decoded.id);
  return user;
}

export async function seedInitialAdmin() {
  await connectToDatabase();
  const adminUsername = (process.env.ADMIN_USERNAME || 'MUadmin').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'umadmin';

  let admin = await User.findOne({ username: adminUsername });
  if (!admin) {
    const hashedPassword = await hashPassword(adminPassword);
    admin = await User.create({
      username: adminUsername,
      password: hashedPassword,
      displayName: 'System Admin',
      role: 'admin',
      planName: 'Unlimited Admin',
      lookupsTotal: 999999999,
      lookupsRemaining: 999999999,
      isActive: true,
      notes: 'Initial administrator account created on startup',
    });
    console.log('⚡ Initial admin created successfully:', adminUsername);
  }
  return admin;
}
`);

// 5. src/app/api/auth/login/route.js
writeFile('src/app/api/auth/login/route.js', `
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/models/User';
import { signToken, seedInitialAdmin } from '@/lib/auth';

export async function POST(req) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    await connectToDatabase();
    await seedInitialAdmin();

    const cleanUsername = String(username).trim().toLowerCase();
    const user = await User.findOne({ username: cleanUsername });

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return NextResponse.json(
        { error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: 'Your account is currently disabled. Please contact administrator.' },
        { status: 403 }
      );
    }

    // Check if user (non-admin) has already reached their lookup limit
    if (user.role !== 'admin' && user.lookupsRemaining <= 0) {
      return NextResponse.json(
        {
          error: 'limit reached contact admin for more limit',
          code: 'LIMIT_REACHED',
          lookupsRemaining: 0,
          lookupsTotal: user.lookupsTotal,
        },
        { status: 403 }
      );
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken({
      id: user._id,
      username: user.username,
      role: user.role,
    });

    return NextResponse.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName || user.username,
        role: user.role,
        planName: user.planName,
        lookupsRemaining: user.lookupsRemaining,
        lookupsTotal: user.lookupsTotal,
        totalLookupsUsed: user.totalLookupsUsed,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: error.message || 'Server error during login' },
      { status: 500 }
    );
  }
}
`);

// 6. src/app/api/auth/me/route.js
writeFile('src/app/api/auth/me/route.js', `
import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';

export async function GET(req) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized or token expired' }, { status: 401 });
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: 'Account disabled. Contact administrator.', code: 'ACCOUNT_DISABLED' },
        { status: 403 }
      );
    }

    if (user.role !== 'admin' && user.lookupsRemaining <= 0) {
      return NextResponse.json(
        {
          error: 'limit reached contact admin for more limit',
          code: 'LIMIT_REACHED',
          lookupsRemaining: 0,
          lookupsTotal: user.lookupsTotal,
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName || user.username,
        role: user.role,
        planName: user.planName,
        lookupsRemaining: user.lookupsRemaining,
        lookupsTotal: user.lookupsTotal,
        totalLookupsUsed: user.totalLookupsUsed,
      },
    });
  } catch (error) {
    console.error('Me error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
`);

// 7. src/app/api/lookup/consume/route.js
writeFile('src/app/api/lookup/consume/route.js', `
import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/models/User';

export async function POST(req) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authentication token' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded || !decoded.id) {
      return NextResponse.json({ error: 'Invalid or expired session. Please log in again.' }, { status: 401 });
    }

    await connectToDatabase();

    // If admin, unlimited lookups
    if (decoded.role === 'admin') {
      const admin = await User.findById(decoded.id);
      if (admin && admin.isActive) {
        return NextResponse.json({
          success: true,
          lookupsRemaining: 999999,
          lookupsTotal: 999999,
          totalLookupsUsed: (admin.totalLookupsUsed || 0) + 1,
        });
      }
    }

    // Atomic find and decrement for standard users
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: decoded.id,
        isActive: true,
        lookupsRemaining: { $gt: 0 },
      },
      {
        $inc: {
          lookupsRemaining: -1,
          totalLookupsUsed: 1,
        },
      },
      { new: true }
    );

    if (!updatedUser) {
      // Find out why: was account deactivated or quota reached?
      const checkUser = await User.findById(decoded.id);
      if (!checkUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      if (!checkUser.isActive) {
        return NextResponse.json(
          { error: 'Account disabled. Contact administrator.', code: 'ACCOUNT_DISABLED' },
          { status: 403 }
        );
      }

      // Quota is 0: exact message requested by the user
      return NextResponse.json(
        {
          error: 'limit reached contact admin for more limit',
          code: 'LIMIT_REACHED',
          lookupsRemaining: 0,
          lookupsTotal: checkUser.lookupsTotal,
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      lookupsRemaining: updatedUser.lookupsRemaining,
      lookupsTotal: updatedUser.lookupsTotal,
      totalLookupsUsed: updatedUser.totalLookupsUsed,
    });
  } catch (error) {
    console.error('Quota consume error:', error);
    return NextResponse.json({ error: 'Failed to verify lookup credits' }, { status: 500 });
  }
}
`);

// 8. src/app/api/admin/users/route.js
writeFile('src/app/api/admin/users/route.js', `
import { NextResponse } from 'next/server';
import { getAuthUser, hashPassword } from '@/lib/auth';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/models/User';

export async function GET(req) {
  try {
    const admin = await getAuthUser(req);
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    await connectToDatabase();
    const users = await User.find({})
      .select('-password')
      .sort({ createdAt: -1 });

    return NextResponse.json({ success: true, users });
  } catch (error) {
    console.error('Admin GET users error:', error);
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const admin = await getAuthUser(req);
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { username, password, displayName, planName, lookupLimit, notes } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    await connectToDatabase();
    const cleanUsername = String(username).trim().toLowerCase();

    const existing = await User.findOne({ username: cleanUsername });
    if (existing) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
    }

    const limit = Math.max(0, parseInt(lookupLimit, 10) || 100);
    const hashedPassword = await hashPassword(password);

    const newUser = await User.create({
      username: cleanUsername,
      password: hashedPassword,
      displayName: displayName || cleanUsername,
      planName: planName || 'Standard',
      lookupsTotal: limit,
      lookupsRemaining: limit,
      totalLookupsUsed: 0,
      isActive: true,
      notes: notes || '',
    });

    const userObj = newUser.toObject();
    delete userObj.password;

    return NextResponse.json({ success: true, user: userObj }, { status: 201 });
  } catch (error) {
    console.error('Admin create user error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create user' }, { status: 500 });
  }
}
`);

// 9. src/app/api/admin/users/[id]/route.js
writeFile('src/app/api/admin/users/[id]/route.js', `
import { NextResponse } from 'next/server';
import { getAuthUser, hashPassword } from '@/lib/auth';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/models/User';

export async function PATCH(req, context) {
  try {
    const admin = await getAuthUser(req);
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const params = await context.params;
    const { id } = params;
    const body = await req.json();

    await connectToDatabase();
    const user = await User.findById(id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (body.password) {
      user.password = await hashPassword(body.password);
    }
    if (typeof body.isActive === 'boolean') {
      user.isActive = body.isActive;
    }
    if (body.displayName !== undefined) {
      user.displayName = body.displayName;
    }
    if (body.planName !== undefined) {
      user.planName = body.planName;
    }
    if (body.notes !== undefined) {
      user.notes = body.notes;
    }
    // Set absolute remaining or add credits
    if (typeof body.addLookups === 'number') {
      user.lookupsRemaining = Math.max(0, user.lookupsRemaining + body.addLookups);
      user.lookupsTotal = Math.max(user.lookupsRemaining, user.lookupsTotal + body.addLookups);
    } else if (typeof body.lookupsRemaining === 'number') {
      user.lookupsRemaining = Math.max(0, body.lookupsRemaining);
      if (body.lookupsTotal !== undefined) {
        user.lookupsTotal = Math.max(0, body.lookupsTotal);
      }
    }

    await user.save();

    const userObj = user.toObject();
    delete userObj.password;

    return NextResponse.json({ success: true, user: userObj });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(req, context) {
  try {
    const admin = await getAuthUser(req);
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const params = await context.params;
    const { id } = params;

    await connectToDatabase();
    const user = await User.findById(id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.role === 'admin' && user.username === 'muadmin') {
      return NextResponse.json({ error: 'Cannot delete primary admin account' }, { status: 400 });
    }

    await User.findByIdAndDelete(id);
    return NextResponse.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
`);

console.log('✅ Backend API files created successfully!');
