from langchain_community.utilities import GoogleSerperAPIWrapper
import requests
import logging
import config

logger = logging.getLogger("ai_core.tools")


def search_trends(query: str) -> str:
    wrapper = GoogleSerperAPIWrapper(serper_api_key=config.SERPER_API_KEY)
    return wrapper.run(query)


def fetch_reddit_trends(subreddits=None) -> str:
    """Reddit public JSON feed crawler with browser User-Agent fallback."""
    if subreddits is None:
        subreddits = ["DigitalArt", "StableDiffusion", "Midjourney"]

    combined_texts = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }

    for sub in subreddits:
        try:
            url = f"https://www.reddit.com/r/{sub}/hot.json?limit=10"
            logger.info(f"Crawling Reddit r/{sub} trends: {url}")
            res = requests.get(url, headers=headers, timeout=10)
            if res.status_code == 200:
                data = res.json()
                posts = data.get("data", {}).get("children", [])
                sub_texts = []
                for p in posts:
                    p_data = p.get("data", {})
                    title = p_data.get("title", "")
                    selftext = p_data.get("selftext", "")
                    sub_texts.append(f"Title: {title}\nContent: {selftext[:150]}")
                combined_texts.append(f"=== Subreddit: r/{sub} ===\n" + "\n\n".join(sub_texts))
                logger.info(f"Successfully crawled Reddit r/{sub}")
            else:
                logger.warning(f"Failed to crawl Reddit r/{sub}: HTTP {res.status_code}")
        except Exception as e:
            logger.error(f"Error crawling Reddit r/{sub}: {e}")

    return "\n\n".join(combined_texts)

