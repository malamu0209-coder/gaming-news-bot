const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const cron = require("node-cron");
const RSSParser = require("rss-parser");
const http = require("http");

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

if (!TOKEN) {
  console.error("[ERROR] Missing TOKEN environment variable. Exiting.");
  process.exit(1);
}
if (!CHANNEL_ID) {
  console.error("[ERROR] Missing CHANNEL_ID environment variable. Exiting.");
  process.exit(1);
}

const RSS_FEED_URL = "https://gamerant.com/feed/";
const TOP_ARTICLES = 5;

const GAMING_KEYWORDS = [
  "game",
  "games",
  "gaming",
  "playstation",
  "xbox",
  "nintendo",
  "pc",
  "steam",
  "esports",
  "rpg",
  "fps",
  "release",
  "review",
  "dlc",
  "patch",
  "update",
  "trailer",
  "announcement",
  "launch",
  "console",
  "developer",
  "studio",
  "sequel",
];

const parser = new RSSParser();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function isGamingRelated(item) {
  const text = `${item.title || ""} ${item.contentSnippet || ""} ${
    item.categories?.join(" ") || ""
  }`.toLowerCase();
  return GAMING_KEYWORDS.some((keyword) => text.includes(keyword));
}

async function fetchGamingNews() {
  console.log("[INFO] Fetching gaming news from IGN RSS feed...");
  try {
    const feed = await parser.parseURL(RSS_FEED_URL);
    console.log(`[INFO] Fetched ${feed.items.length} total articles from feed`);

    const gamingArticles = feed.items.filter(isGamingRelated);
    console.log(
      `[INFO] ${gamingArticles.length} articles passed gaming filter`
    );

    return gamingArticles.slice(0, TOP_ARTICLES);
  } catch (error) {
    console.error("[ERROR] Failed to fetch RSS feed:", error.message);
    return [];
  }
}

function buildEmbed(articles, requestedBy = null) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const footerText = requestedBy
    ? `Requested by ${requestedBy} • Powered by Game Rant`
    : "Powered by Game Rant • Updates every hour";

  const embed = new EmbedBuilder()
    .setTitle("🎮 Gaming News Today")
    .setColor(0x5865f2)
    .setDescription(`**Top ${articles.length} gaming stories — ${dateStr}**`)
    .setTimestamp()
    .setFooter({ text: footerText });

  articles.forEach((article, index) => {
    const title = article.title || "Untitled";
    const link = article.link || "";
    const snippet = article.contentSnippet
      ? article.contentSnippet.slice(0, 120) + "..."
      : "No description available.";

    embed.addFields({
      name: `${index + 1}. ${title}`,
      value: `${snippet}\n[Read more](${link})`,
      inline: false,
    });
  });

  return embed;
}

async function postGamingNews() {
  console.log("[INFO] Starting news post cycle...");

  const channel = await client.channels.fetch(CHANNEL_ID).catch((err) => {
    console.error("[ERROR] Could not fetch channel:", err.message);
    return null;
  });

  if (!channel) {
    console.error("[ERROR] Channel not found. Check your CHANNEL_ID.");
    return;
  }

  const articles = await fetchGamingNews();

  if (articles.length === 0) {
    console.warn("[WARN] No gaming articles found, skipping post.");
    return;
  }

  const embed = buildEmbed(articles);
  await channel.send({ embeds: [embed] });
  console.log(
    `[INFO] Successfully posted ${articles.length} articles to #${channel.name}`
  );
}

async function registerSlashCommands(clientId) {
  const commands = [
    new SlashCommandBuilder()
      .setName("news")
      .setDescription("Fetch and post the latest gaming news right now")
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    console.log("[INFO] Registering /news slash command...");
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log("[INFO] /news slash command registered globally");
  } catch (error) {
    console.error("[ERROR] Failed to register slash commands:", error.message);
  }
}

client.once("ready", async () => {
  console.log(`[INFO] Bot logged in as ${client.user.tag}`);
  console.log(`[INFO] Posting to channel ID: ${CHANNEL_ID}`);

  await registerSlashCommands(client.user.id);

  console.log("[INFO] Running initial news post on startup...");
  await postGamingNews();

  console.log("[INFO] Scheduling hourly news posts with node-cron...");
  cron.schedule("0 * * * *", async () => {
    console.log("[CRON] Hourly trigger fired");
    await postGamingNews();
  });

  console.log("[INFO] Bot is running. News will post every hour at :00");
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "news") {
    console.log(
      `[INFO] /news triggered by ${interaction.user.tag} in #${interaction.channel?.name}`
    );

    await interaction.deferReply();

    const articles = await fetchGamingNews();

    if (articles.length === 0) {
      await interaction.editReply(
        "⚠️ No gaming articles found right now. Try again in a moment!"
      );
      return;
    }

    const embed = buildEmbed(articles, interaction.user.username);
    await interaction.editReply({ embeds: [embed] });

    console.log(
      `[INFO] /news responded with ${articles.length} articles to ${interaction.user.tag}`
    );
  }
});

client.on("error", (error) => {
  console.error("[ERROR] Discord client error:", error.message);
});

process.on("SIGTERM", () => {
  console.log("[INFO] Received SIGTERM, shutting down gracefully...");
  client.destroy();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[INFO] Received SIGINT, shutting down gracefully...");
  client.destroy();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
const healthServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/api/healthz" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", bot: client.isReady() ? "connected" : "connecting" }));
  } else if (req.url === "/api/articles") {
    try {
      const articles = await fetchGamingNews();
      const payload = articles.map((item) => ({
        title: item.title ?? "Untitled",
        link: item.link ?? "",
        snippet: item.contentSnippet ? item.contentSnippet.slice(0, 150) + "..." : "",
        pubDate: item.pubDate ?? null,
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ articles: payload }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ articles: [], error: "Failed to fetch articles" }));
    }
  } else {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Discord Gaming Bot is running.");
  }
});
healthServer.listen(PORT, () => {
  console.log(`[INFO] Health server listening on port ${PORT}`);
});

console.log("[INFO] Connecting to Discord...");
client.login(TOKEN).catch((err) => {
  console.error("[ERROR] Failed to login to Discord:", err.message);
  process.exit(1);
});
