import Koa from "koa"
import bodyParser from "koa-bodyparser"
import router from "./routes"
import cors from "@koa/cors"
import mysql = require('mysql2/promise')

const createKoaApp = (pool: mysql.Pool): Koa => {
    const app = new Koa()

    app
        .use(cors())
        .use(async (ctx, next) => {
            ctx.pool = pool
            await next()
        })
        .use(bodyParser())
        .use(router.routes())
        .use(router.allowedMethods())

    return app
}

export default createKoaApp