module.exports = {
    apps: [
        {
            name: "abs-backend",
            script: "dist/src/main.js",
            env: {
                PORT: 5000,
                NODE_ENV: "production",
                DB_HOST: "localhost",
                DB_PORT: 3306,
                DB_USERNAME: "absteqwc_rhp",
                DB_PASSWORD: "absteqwc_rhp",
                DB_DATABASE: "absteqwc_absservice",
                JWT_SECRET: "abs-technologies-jwt-secret-change-in-production-2024",
                ENCRYPTION_KEY: "abs-technologies-encryption-key-change-in-production-2024"
            },
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "512M"
        }
    ]
};
