module.exports = {
    apps: [
        {
            name: "abs-backend",
            script: "./dist/src/main.js",
            env_file: ".env",
            instances: 1,
            exec_mode: "fork",
            autorestart: true,
            watch: false,
            max_memory_restart: "512M"
        }
    ]
};
