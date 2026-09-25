// A field of a structured action input (LAWP 0.3) — https://github.com/localilabs/lawp/blob/main/LAWP.md#structured-inputs-v03
export type InputField = {
  name: string
  type?: "string" | "number" | "integer" | "boolean" | "date" | "time" | "datetime" | "email" | "phone" | "url" | "enum"
  required?: boolean
  description?: string
  options?: string[]
  example?: unknown
}

export type Action = {
  id: string
  name: string
  description: string
  intent: string[]
  input: {
    type: "text" | "number" | "none" | "object"
    required: boolean
    // LAWP 0.3: the named fields of an "object" input, e.g. date, time, email
    fields?: InputField[]
  }
  endpoint?: { url: string, method?: "POST" | "GET" }
}

export type Page = {
  title: string
  content: string
}

export type Site = {
  domain: string
  name: string
  pages: Record<string, Page>
  actions: Action[]
  // True when the LAWP comes from the site's own /.well-known/lawp.json
  native?: boolean
  // When this LAWP was last crawled/updated (ISO), and the site's original language (LAWP text is English)
  updated_at?: string
  language?: string
  // The site's owner has claimed it on Actuent and edits it themselves
  verified_owner?: boolean
  // Address, phone, opening hours etc. from the site's schema.org data
  business?: any
}

export const sites: Record<string, Site> = {}

sites["rejn.app"] = {
  domain: "rejn.app",
  name: "Rejn",
  pages: {
    "/": {
      title: "Rejn — Weather for Runners",
      content: "Real-time weather app built for runners and outdoor athletes. Know before you go."
    },
    "/forecast": {
      title: "Forecast",
      content: "Hourly and daily weather forecasts with runner-specific insights. Rain, wind, temperature."
    }
  },
  actions: [
    {
      id: "weather",
      name: "Get weather",
      description: "Get live weather data for a location",
      intent: ["weather", "temperature", "forecast", "rain", "wind", "running", "outdoor"],
      input: { type: "text", required: false }
    }
  ]
}

sites["abdisbarber.com"] = {
  domain: "abdisbarber.com",
  name: "Abdi's Barber",
  pages: {
    "/": {
      title: "Abdi's Barber — Amsterdam",
      content: "Premier barbershop in the heart of Amsterdam. Walk-ins welcome."
    },
    "/services": {
      title: "Services",
      content: "Haircut 25€. Beard trim 15€. Full groom 35€."
    },
    "/about": {
      title: "About",
      content: "Family run since 2012. Specialists in fades and traditional cuts."
    }
  },
  actions: [
    {
      id: "book",
      name: "Book appointment",
      description: "Book a haircut at Abdi's Barber",
      intent: ["book", "appointment", "haircut", "barber", "fade", "trim", "amsterdam"],
      input: { type: "text", required: false }
    }
  ]
}

sites["actuent.ai"] = {
  domain: "actuent.ai",
  name: "Actuent",
  pages: {
    "/": {
      title: "Actuent — The Internet for AI",
      content: "A search engine built for AI agents. Search the web and get back structured LAWP data — clean JSON every AI can read and act on."
    }
  },
  actions: [
    {
      id: "search",
      name: "Search",
      description: "Search the AI web layer for structured site data",
      intent: ["search", "find", "look up", "browse", "discover"],
      input: { type: "text", required: true }
    }
  ]
}
