import Router from "@koa/router"

const router = new Router()

router.get("/health-check", async (ctx) => {
    ctx.body = { status: "OK" }
})

export default router