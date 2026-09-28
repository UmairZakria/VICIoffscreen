const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '..', 'dnc-portal', '.env.local');

const content = [
  'MONGODB_URI=mongodb+srv://umairzakria6:4orpLINMatjQ6Fra@cluster0.5dcfg.mongodb.net/movielab?retryWrites=true&w=majority&appName=Cluster0',
  'JWT_SECRET=dnc_ultra_secure_jwt_token_secret_key_2026_xyz!',
  'ADMIN_USERNAME=MUadmin',
  'ADMIN_PASSWORD=umadmin',
  'PORT=3000'
].join('\n') + '\n';

fs.writeFileSync(envPath, content, 'utf8');
console.log('Restored .env.local successfully');
