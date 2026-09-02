import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import Groq from 'groq-sdk'

const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

app.post('/api/structure-ddr', async (req, res) => {
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'GROQ_API_KEY is not configured on the local server.' })
  const text = String(req.body?.text || '').slice(0, 30000)
  if (!text.trim()) return res.status(400).json({ error: 'No OCR text supplied.' })
  try {
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY })
    const completion = await client.chat.completions.create({
      model: 'qwen/qwen3.8-27b', temperature: 0.2, max_completion_tokens: 1600,
      messages: [{ role: 'user', content: `Extract this drilling report into JSON only. Schema: {well_name, latitude, longitude, current_md, formation, mud_weight, events:[{type,depth,severity,mitigation}], sections:[{label,summary}]}. OCR text:\n${text}` }],
    })
    const raw = completion.choices[0]?.message?.content || '{}'
    const match = raw.match(/\{[\s\S]*\}/)
    res.json({ structured: JSON.parse(match?.[0] || raw), raw })
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : 'Groq structuring failed' }) }
})

app.listen(process.env.PORT || 8787, () => console.log('NWIS OCR structuring server on http://localhost:8787'))
