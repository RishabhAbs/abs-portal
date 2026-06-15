module.exports = {
    apps: [{
        name: "abs-cloud-backend",
        script: "./backend/dist/main.js",
        cwd: "./backend",
        env: {
            NODE_ENV: "production",
            PORT: 5000
        }
    }]
};
