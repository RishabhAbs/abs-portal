module.exports = {
    apps: [
        {
            name: "abs-backend",
            cwd: "./backend",
            script: "npm",
            args: "run start",
            env: {
                PORT: 5000,
                NODE_ENV: "production",
                DB_HOST: "localhost",
                DB_PORT: 3306,
                DB_USERNAME: "root",
                DB_PASSWORD: "",
                DB_DATABASE: "abs_cloud"
            }
        },
        {
            name: "abs-frontend",
            cwd: "./",
            script: "npm",
            args: "start",
            env: {
                PORT: 3000
            }
        }
    ]
};
