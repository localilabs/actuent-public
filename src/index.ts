import "dotenv/config"
import express from "express"
import cors from "cors"
import fetch from "node-fetch"

const app = express()

app.use(cors())
app.use(express.json())

const PRIVATE_API_URL = "http://localhost:3001/mcp"

// 🔥 MAIN ENDPOINT (this connects everything)
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body

    const response = await fetch(`${PRIVATE_API_URL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: message
      })
    })

    const data = await response.json()

    res.json(data)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Something broke" })
  }
})

// Optional routes
import searchRoute from "./routes/search"
import searchPage from "./routes/searchPage"

app.use("/search", searchRoute)
app.use("/search-page", searchPage)

const PORT = 3000

app.listen(PORT, () => {
  console.log(`🌐 Public API running on http://localhost:${PORT}`)
})