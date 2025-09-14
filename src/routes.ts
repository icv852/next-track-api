import Router from "@koa/router"
import { query } from "./helpers"

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

    const rows = await query(
        ctx.pool,
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

    const tags = await query(
        ctx.pool,
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

router.post("/recommendations", async (ctx) => {
    const body = ctx.request.body as any
    if (!("mbids" in body) || !Array.isArray(body.mbids) || body.mbids.length < 1) {
        ctx.status = 400
        ctx.body = { error: `Missing mbids.` }
        return
    }

    const mbids = body.mbids

    const idRows = await query(
        ctx.pool,
        `SELECT id FROM recording_min WHERE gid IN (?)`,
        [mbids]
    )
    const inputIds = idRows.map(r => r.id)
    
    const pRows = await query(
        ctx.pool,
        `SELECT DISTINCT rt.tag_id
        FROM recording_tag rt
        WHERE rt.recording_id IN (?)`,
        [inputIds]
    )
    const P = pRows.map(r => r.tag_id)
    const Psize = P.length

    const overlapRows = await query(
        ctx.pool,
        `SELECT rt.recording_id, COUNT(*) AS overlap
        FROM recording_tag rt
        WHERE rt.tag_id IN (?)
            AND rt.recording_id NOT IN (?)
        GROUP BY rt.recording_id
        ORDER BY overlap DESC
        LIMIT 1000`,
        [P, inputIds]
    )
    if (overlapRows.length === 0) {
        ctx.status = 404
        ctx.body = { error: "No candidate recordings found." }
        return
    }

    const candidateIds = overlapRows.map(r => r.recording_id)
    const metaRows = await query(
        ctx.pool,
        `SELECT id, gid, name, tag_count
        FROM recording_min
        WHERE id IN (?)`,
        [candidateIds]
    )
    const metaById = new Map(metaRows.map((m) => [m.id, m]))

    let best = null
    for (const row of overlapRows) {
        const m = metaById.get(row.recording_id)
        if (!m) continue
        const overlap = Number(row.overlap)
        const union = m.tag_count + Psize - overlap
        const score = union > 0 ? overlap / union : 0
        if (!best || score > best.score) {
            best = { id: m.id, gid: m.gid, name: m.name, overlap, union, score }
        }
    }

    if (!best) {
        ctx.status = 404
        ctx.body = { error: "No candidates after scoring" }
        return
    }

    const matchedRows = await query(
        ctx.pool,
        `SELECT t.name AS tag
        FROM recording_tag rt
        JOIN tag t ON t.id = rt.tag_id
        WHERE rt.recording_id = ?
            AND rt.tag_id IN (?)`,
        [best.id, P]
    )
    const matchedTags = matchedRows.map((r) => r.tag)

    ctx.body = {
        track: { id: best.id, mbid: best.gid, title: best.name },
        score: Number(best.score.toFixed(3)),
        matchedTags,
        union: best.union
    }
})

export default router