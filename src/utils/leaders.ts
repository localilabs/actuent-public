// Broad searches for a kind of product or service ("project management tool", "best crm", "vpn")
// put the category's best-known options first. Plain text matching favours small sites that repeat
// the words most ("bubbleplan.net" for "project management"). Hand-checked and editorial, never paid:
// a site can't buy its way onto this list. Only the leaders Actuent has indexed are shown.

const LEADERS: [RegExp, string[]][] = [
  [/\bproject management\b|\btask management\b|\bkanban\b/, ["asana.com", "trello.com", "monday.com", "clickup.com", "notion.so", "linear.app", "basecamp.com", "atlassian.com"]],
  [/\bcrm\b/, ["hubspot.com", "salesforce.com", "pipedrive.com", "attio.com", "zoho.com", "folk.app", "close.com"]],
  [/\bpassword manager/, ["1password.com", "bitwarden.com", "dashlane.com", "proton.me", "keepersecurity.com", "nordpass.com"]],
  [/\bvpn\b/, ["nordvpn.com", "expressvpn.com", "protonvpn.com", "mullvad.net", "surfshark.com"]],
  [/\bemail marketing\b|\bnewsletter (tool|platform|software)\b/, ["mailchimp.com", "klaviyo.com", "kit.com", "brevo.com", "beehiiv.com", "mailerlite.com", "campaignmonitor.com"]],
  [/\bnote[- ]?taking\b|\bnotes app\b/, ["notion.so", "obsidian.md", "evernote.com", "bear.app", "craft.do", "goodnotes.com"]],
  [/\bvideo (call|calls|conferencing|meetings?)\b/, ["zoom.us", "zoom.com", "meet.google.com", "teams.microsoft.com", "whereby.com", "webex.com"]],
  [/\bwebsite builder\b|\bbuild a website\b/, ["squarespace.com", "wix.com", "webflow.com", "framer.com", "wordpress.com", "shopify.com"]],
  [/\b(online store|ecommerce|e-commerce) (platform|builder|software)\b|\bsell online\b/, ["shopify.com", "woocommerce.com", "bigcommerce.com", "squarespace.com", "wix.com"]],
  [/\baccounting (software|app|tool)\b|\bbookkeeping\b|\binvoicing\b/, ["quickbooks.intuit.com", "intuit.com", "xero.com", "freshbooks.com", "wave.com", "dinero.dk", "e-conomic.dk"]],
  [/\bdesign tool\b|\bgraphic design\b|\bui design\b/, ["figma.com", "canva.com", "adobe.com", "framer.com", "sketch.com"]],
  [/\bcloud storage\b|\bfile sharing\b/, ["dropbox.com", "drive.google.com", "google.com", "onedrive.live.com", "box.com", "icloud.com"]],
  [/\bform builder\b|\bonline forms?\b|\bsurvey tool\b/, ["tally.so", "typeform.com", "jotform.com", "forms.google.com", "surveymonkey.com"]],
  [/\b(scheduling|booking|appointment) (tool|software|app)\b|\bcalendar app\b/, ["calendly.com", "cal.com", "savvycal.com", "acuityscheduling.com", "doodle.com"]],
  [/\bai (chatbot|assistant|chat)\b|\bchatbots?\b/, ["claude.ai", "anthropic.com", "chatgpt.com", "openai.com", "gemini.google.com", "perplexity.ai"]],
  [/\bcode editor\b|\bide\b|\bai coding\b/, ["cursor.com", "code.visualstudio.com", "jetbrains.com", "zed.dev", "windsurf.com"]],
  [/\bweb hosting\b|\bhosting\b|\bdeploy (a )?(website|app)\b/, ["vercel.com", "netlify.com", "cloudflare.com", "render.com", "fly.io", "digitalocean.com"]],
  [/\b(web|website) analytics\b|\banalytics tool\b/, ["plausible.io", "posthog.com", "analytics.google.com", "matomo.org", "fathom.com", "mixpanel.com"]],
  [/\b(payment|payments) (provider|platform|processor|gateway)\b|\baccept payments\b/, ["stripe.com", "paypal.com", "adyen.com", "squareup.com", "mollie.com"]],
  [/\blanguage learning\b|\blearn (a )?language\b/, ["duolingo.com", "babbel.com", "busuu.com", "italki.com", "memrise.com"]],
  [/\bmusic streaming\b/, ["spotify.com", "music.apple.com", "tidal.com", "deezer.com", "music.youtube.com"]],
  [/\b(video )?streaming service\b/, ["netflix.com", "disneyplus.com", "max.com", "primevideo.com", "hulu.com"]],
  [/\bfood delivery\b/, ["doordash.com", "ubereats.com", "grubhub.com", "wolt.com", "just-eat.com"]],
  [/\bflight (search|booking)\b|\bcheap flights\b/, ["google.com", "skyscanner.net", "kayak.com", "momondo.com", "expedia.com"]],
  [/\bhotel booking\b|\bbook (a )?hotel\b/, ["booking.com", "expedia.com", "hotels.com", "airbnb.com", "agoda.com"]],
  [/\bonline courses?\b|\blearn to code\b/, ["coursera.org", "udemy.com", "edx.org", "khanacademy.org", "codecademy.com"]],
  [/\bhelp ?desk\b|\bcustomer support (tool|software)\b/, ["zendesk.com", "intercom.com", "freshdesk.com", "helpscout.com", "front.com"]],
  [/\bteam chat\b|\bteam messaging\b/, ["slack.com", "teams.microsoft.com", "discord.com", "chat.google.com"]],
  [/\bphoto editing\b|\bphoto editor\b/, ["adobe.com", "canva.com", "pixlr.com", "affinity.serif.com", "photopea.com"]]
]

// Broad means: the kind of thing, maybe with "best"/"tool"/"app", but no brand or city of its own.
export function categoryLeaders(query: string): string[] | null {
  const q = query.toLowerCase().trim()
  if (q.split(/\s+/).length > 6 || /\.[a-z]{2,}\b| vs\.? | versus /.test(q)) return null
  for (const [re, domains] of LEADERS) if (re.test(q)) return domains
  return null
}
