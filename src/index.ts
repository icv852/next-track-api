import createKoaApp from './app'
import http from 'http'
import mysql = require('mysql2/promise')
import 'dotenv/config'

const PORT = process.env.PORT || 4000

const main = (): void => {
    try {
        const pool = mysql.createPool({
            host: process.env.DB_HOST || "127.0.0.1",
            user: process.env.DB_USER || "admin",
            password: process.env.DB_PASSWORD || "",
            database: process.env.DB_DATABASE || "mb_min",
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            charset: "utf8mb4"
        });

        const app = createKoaApp(pool)
        const server = http.createServer(app.callback())

        server.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}.`)
        })
    } catch (e) {
        console.error(`Failed to start server. Error: ${e}`)
    }
}

main()