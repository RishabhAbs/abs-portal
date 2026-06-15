const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = __dirname;
const TMP  = path.join(BASE, '_deploy_tmp');
const OUT  = path.join(BASE, 'abscloud-deploy.zip');

// Clean tmp + old zip
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
if (fs.existsSync(OUT)) fs.rmSync(OUT, { force: true });

fs.mkdirSync(path.join(TMP, 'backend', 'dist'), { recursive: true });

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dest, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ─── 1. Frontend build → root (TMP/) ───
copyDir(path.join(BASE, 'frontend', 'build'), TMP);

// ─── 2. .htaccess at root ───
fs.copyFileSync(path.join(BASE, '.htaccess'), path.join(TMP, '.htaccess'));

// ─── 3. Frontend .env at root ───
const frontendEnvContent = `# Security - enable protections even in development
REACT_APP_ENABLE_SECURITY=true
DANGEROUSLY_DISABLE_HOST_CHECK=true
HOST=0.0.0.0
`;
fs.writeFileSync(path.join(TMP, '.env'), frontendEnvContent);

// ─── 4. Backend dist ───
copyDir(path.join(BASE, 'backend', 'dist'), path.join(TMP, 'backend', 'dist'));

// ─── 5. Backend package.json (prod only, no devDependencies) ───
const pkg = JSON.parse(fs.readFileSync(path.join(BASE, 'backend', 'package.json'), 'utf8'));
delete pkg.devDependencies;
pkg.scripts = { start: 'node dist/src/main.js' };
fs.writeFileSync(path.join(TMP, 'backend', 'package.json'), JSON.stringify(pkg, null, 2));

// ─── 6. Backend package-lock for npm ci ───
fs.copyFileSync(path.join(BASE, 'backend', 'package-lock.json'), path.join(TMP, 'backend', 'package-lock.json'));

// ─── 7. Backend .env — production credentials ───
const backendEnvContent = `PORT=5000
NODE_ENV=production
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=absteqwc_rhp
DB_PASSWORD=absteqwc_rhp
DB_DATABASE=absteqwc_absservice
DB_SYNC=false
DB_LOGGING=false
JWT_SECRET=abs-technologies-jwt-secret-change-in-production-2024
JWT_EXPIRES_IN=24h
ENCRYPTION_KEY=abs-technologies-encryption-key-change-in-production-2024
VAPID_PUBLIC_KEY=BMgi27m-uRG-WZOGjgnjI1D0SGairDnkOvjnQ-NlGXQWGhHoDAqockQTp3N4oExkn5WV5mQBKcTIVgU1gAEb1qI
VAPID_PRIVATE_KEY=zQM0QbmAg-ku2TmrIpP3ltVv18sM6J__mOl9rAN_DGw
VAPID_SUBJECT=mailto:admin@abstechnologies.in
`;
fs.writeFileSync(path.join(TMP, 'backend', '.env'), backendEnvContent);

// ─── 8. Backend ecosystem.config.js — PM2 config with inlined env ───
const ecosystemContent = `module.exports = {
  apps: [
    {
      name: "abs-backend",
      script: "./dist/src/main.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        PORT: 5000,
        NODE_ENV: "production",
        DB_HOST: "localhost",
        DB_PORT: 3306,
        DB_USERNAME: "absteqwc_rhp",
        DB_PASSWORD: "absteqwc_rhp",
        DB_DATABASE: "absteqwc_absservice",
        DB_SYNC: "false",
        DB_LOGGING: "false",
        JWT_SECRET: "abs-technologies-jwt-secret-change-in-production-2024",
        JWT_EXPIRES_IN: "24h",
        ENCRYPTION_KEY: "abs-technologies-encryption-key-change-in-production-2024",
        VAPID_PUBLIC_KEY: "BMgi27m-uRG-WZOGjgnjI1D0SGairDnkOvjnQ-NlGXQWGhHoDAqockQTp3N4oExkn5WV5mQBKcTIVgU1gAEb1qI",
        VAPID_PRIVATE_KEY: "zQM0QbmAg-ku2TmrIpP3ltVv18sM6J__mOl9rAN_DGw",
        VAPID_SUBJECT: "mailto:admin@abstechnologies.in"
      }
    }
  ]
};
`;
fs.writeFileSync(path.join(TMP, 'backend', 'ecosystem.config.js'), ecosystemContent);

// ─── 9. Create ZIP via PowerShell ───
const zipCmd = `powershell -Command "Compress-Archive -Path '${TMP}\\*' -DestinationPath '${OUT}' -Force"`;
execSync(zipCmd, { stdio: 'inherit' });

// ─── 10. Cleanup tmp ───
fs.rmSync(TMP, { recursive: true, force: true });

const size = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`\nDone! ZIP saved to: ${OUT} (${size} MB)`);
console.log('Structure:');
console.log('  / (root)   → index.html, static/, .htaccess, .env (frontend)');
console.log('  /backend/  → dist/, package.json, package-lock.json, .env, ecosystem.config.js');
