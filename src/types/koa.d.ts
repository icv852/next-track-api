import * as Koa from "koa"
import mysql from "mysql2/promise"

declare module "koa" {
    interface BaseContext {
        pool: mysql.Pool
    }
}