import request from "supertest"
import { describe, it, expect } from "vitest"
import createKoaApp from "../src/app"

type Rec = { id: number; gid: string; name: string; tag_count: number }
type RecTag = { tag_id: number; count: number }

const recordings: Rec[] = [
  { id: 1, gid: "MBID_1", name: "Song A", tag_count: 3 },
  { id: 2, gid: "MBID_2", name: "Song B", tag_count: 2 },
  { id: 3, gid: "MBID_3", name: "Best Match", tag_count: 2 },
]

const recById = new Map(recordings.map(r => [r.id, r]))
const recByName = new Map(recordings.map(r => [r.name, r]))
const recByGid = new Map(recordings.map(r => [r.gid, r]))

const tagNames = new Map<number, string>([
  [1, "rock"],
  [2, "indie"],
  [3, "90s"],
  [4, "shoegaze"],
])

const recTags = new Map<number, RecTag[]>([
  [1, [ { tag_id: 1, count: 50 }, { tag_id: 2, count: 30 }, { tag_id: 3, count: 20 } ]],
  [2, [ { tag_id: 1, count: 45 }, { tag_id: 4, count: 25 } ]],
  [3, [ { tag_id: 2, count: 40 }, { tag_id: 4, count: 35 } ]],
])

class FakePool {
  async query(sql: string, params: any[] = []): Promise<[any[], any[]]> {
    const q = sql.replace(/\s+/g, " ").trim()

    if (q.includes("FROM recording_min") && q.includes("WHERE name = ?")) {
      const title = params[0]
      const rec = recByName.get(title)
      return [[...(rec ? [rec] : [])], []]
    }

    if (q.includes("FROM recording_tag rt JOIN tag t ON t.id = rt.tag_id")
        && q.includes("ORDER BY rt.count DESC")
        && q.includes("LIMIT 50")) {
      const recId = Number(params[0])
      const tags = recTags.get(recId) ?? []
      const rows = tags.map(t => ({ tag: tagNames.get(t.tag_id)!, weight: t.count }))
      return [rows, []]
    }

    if (q.startsWith("SELECT id FROM recording_min WHERE gid IN (?)")) {
      const gids: string[] = params[0] ?? []
      const rows = gids
        .map(g => recByGid.get(g))
        .filter(Boolean)
        .map(r => ({ id: (r as Rec).id }))
      return [rows, []]
    }

    if (q.startsWith("SELECT DISTINCT rt.tag_id FROM recording_tag rt WHERE rt.recording_id IN (?)")) {
      const recIds: number[] = params[0] ?? []
      if (!recIds.length) return [[], []]
      const s = new Set<number>()
      recIds.forEach(id => (recTags.get(id) ?? []).forEach(t => s.add(t.tag_id)))
      return [[...s].map(tag_id => ({ tag_id })), []]
    }

    if (q.startsWith("SELECT rt.recording_id, COUNT(*) AS overlap FROM recording_tag rt WHERE rt.tag_id IN (?)")) {
      const p: number[] = params[0] ?? []
      const exclude: number[] = params[1] ?? []
      if (!p.length) return [[], []]
      const pSet = new Set(p)
      const rows = recordings
        .filter(r => !exclude.includes(r.id))
        .map(r => {
          const overlap = (recTags.get(r.id) ?? []).filter(t => pSet.has(t.tag_id)).length
          return { recording_id: r.id, overlap }
        })
        .filter(x => x.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, 1000)
      return [rows, []]
    }

    if (q.startsWith("SELECT id, gid, name, tag_count FROM recording_min WHERE id IN (?)")) {
      const ids: number[] = params[0] ?? []
      const rows = ids.map(id => recById.get(id)).filter(Boolean)
      return [rows, []]
    }

    if (q.startsWith("SELECT t.name AS tag FROM recording_tag rt JOIN tag t ON t.id = rt.tag_id")) {
      const recId = Number(params[0])
      const p: number[] = params[1] ?? []
      const pSet = new Set(p)
      const rows = (recTags.get(recId) ?? [])
        .filter(t => pSet.has(t.tag_id))
        .map(t => ({ tag: tagNames.get(t.tag_id)! }))
      return [rows, []]
    }

    return [[], []]
  }
}

const client = () => {
  const app = createKoaApp(new FakePool() as any)
  return request(app.callback())
}

describe("GET /health-check", () => {
  it("returns OK", async () => {
    const res = await client().get("/health-check")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: "OK" })
  })
})

describe("GET /resolve", () => {
  it("400 when title is missing", async () => {
    const res = await client().get("/resolve")
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Title is required/i)
  })

  it("404 when title not found", async () => {
    const res = await client().get("/resolve").query({ title: "Unknown Title" })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/No recording is found/i)
  })

  it("200 with MBID and tags when title matches exactly", async () => {
    const res = await client().get("/resolve").query({ title: "Song A" })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("OK")
    expect(res.body.mbid).toBe("MBID_1")
    expect(res.body.title).toBe("Song A")
    expect(Array.isArray(res.body.tags)).toBe(true)
    expect(res.body.tags.length).toBeGreaterThan(0)
    expect(res.body.tags[0]).toHaveProperty("tag")
    expect(res.body.tags[0]).toHaveProperty("weight")
  })
})

describe("POST /recommendations", () => {
  it("400 when mbids is missing", async () => {
    const res = await client().post("/recommendations").send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Missing mbids/i)
  })

  it("404 when no candidate recordings are found (e.g., unknown MBID)", async () => {
    const res = await client().post("/recommendations").send({ mbids: ["UNKNOWN"] })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/No candidate recordings found/i)
  })

  it("200 with deterministic recommendation and explanation", async () => {
    const res = await client()
      .post("/recommendations")
      .send({ mbids: ["MBID_1", "MBID_2"] })
    expect(res.status).toBe(200)
    expect(res.body.track.title).toBe("Best Match")
    expect(res.body.track.mbid).toBe("MBID_3")
    expect(res.body.score).toBe(0.5)
    expect(new Set(res.body.matchedTags)).toEqual(new Set(["indie", "shoegaze"]))
    expect(res.body.union).toBe(4)
  })
})