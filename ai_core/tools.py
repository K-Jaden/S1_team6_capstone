from langchain_community.utilities import GoogleSerperAPIWrapper
import config


def search_trends(query: str) -> str:
    wrapper = GoogleSerperAPIWrapper(serper_api_key=config.SERPER_API_KEY)
    return wrapper.run(query)
