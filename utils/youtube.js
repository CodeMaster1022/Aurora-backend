const { google } = require('googleapis');

const DEFAULT_SEARCH_QUERY = 'feel good pop songs';

/**
 * Search for YouTube videos using the Data API v3.
 * Falls back to an empty array if the API key is missing.
 *
 * @param {Object} options
 * @param {string} [options.query] - Search query to send to YouTube.
 * @param {number} [options.maxResults=25] - Number of results to fetch (max 50).
 * @returns {Promise<Array<{ id: string, title: string }>>}
 */
const searchYouTubeVideos = async (options = {}) => {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    throw new Error('YouTube API key is not configured');
  }

  const {
    query = DEFAULT_SEARCH_QUERY,
    maxResults = 25
  } = options;

  try {
    const youtube = google.youtube({
      version: 'v3',
      auth: apiKey
    });

    const response = await youtube.search.list({
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: Math.min(Math.max(parseInt(maxResults, 10) || 25, 1), 50),
      safeSearch: 'moderate',
      videoEmbeddable: 'true',
      order: 'relevance'
    });

    const items = response.data.items || [];

    if (items.length === 0) {
      console.warn('YouTube API returned no results for query:', query);
      return [];
    }

    return items
      .filter(item => item.id && item.id.videoId)
      .map(item => ({
        id: item.id.videoId,
        title: item.snippet?.title || 'YouTube Video'
      }));
  } catch (error) {
    console.error('YouTube API error:', {
      message: error.message,
      code: error.code,
      errors: error.errors
    });
    
    // Re-throw with more context
    if (error.code === 403) {
      throw new Error('YouTube API quota exceeded or access denied');
    } else if (error.code === 400) {
      throw new Error('Invalid YouTube API request');
    } else {
      throw new Error(`YouTube API error: ${error.message || 'Unknown error'}`);
    }
  }
};

module.exports = {
  searchYouTubeVideos
};

