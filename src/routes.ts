import Router from "@koa/router"

const router = new Router()

router.get("/health-check", async (ctx) => {
    ctx.body = { status: "OK" }
})

router.get("/resolve", async (ctx) => {
    const title = String(ctx.query.title || "").trim()
    if (!title) {
        ctx.status = 400
        ctx.body = { error: "Title is required." }
        return
    }

    const [rows]: [any[], any] = await ctx.pool.query(
        `SELECT id, gid, name, tag_count
        FROM recording_min
        WHERE name = ?
        ORDER BY tag_count DESC
        LIMIT 1`,
        [title]
    )

    if (rows.length < 1) {
        ctx.status = 404
        ctx.body = { error: "No recording is found." }
        return
    }

    const recording = rows[0] as any

    const [tags]: [any[], any] = await ctx.pool.query(
        `SELECT t.name AS tag, rt.count AS weight
        FROM recording_tag rt
        JOIN tag t ON t.id = rt.tag_id
        WHERE rt.recording_id = ?
        ORDER BY rt.count DESC
        LIMIT 50`,
        [recording.id]
    )

    ctx.body = {
        status: "OK",
        mbid: recording.gid,
        title: recording.name,
        tags: tags.map((r: { tag: any, weight: any }) => ({ tag: r.tag, weight: r.weight }))
    }
})

export default router