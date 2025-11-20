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

/**
 * Get all videos from a YouTube playlist using the Data API v3.
 * 
 * @param {Object} options
 * @param {string} options.playlistId - The YouTube playlist ID.
 * @param {number} [options.maxResults=50] - Maximum number of results per page (max 50).
 * @returns {Promise<Array<{ id: string, title: string }>>}
 */
const getPlaylistVideos = async (options = {}) => {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    throw new Error('YouTube API key is not configured');
  }

  const { playlistId, maxResults = 50 } = options;

  if (!playlistId) {
    throw new Error('Playlist ID is required');
  }

  try {
    const youtube = google.youtube({
      version: 'v3',
      auth: apiKey
    });

    const allVideos = [];
    let nextPageToken = null;

    do {
      const response = await youtube.playlistItems.list({
        part: 'snippet,contentDetails',
        playlistId: playlistId,
        maxResults: Math.min(Math.max(parseInt(maxResults, 10) || 50, 1), 50),
        pageToken: nextPageToken || undefined
      });

      const items = response.data.items || [];

      const videos = items
        .filter(item => item.contentDetails && item.contentDetails.videoId)
        .map(item => ({
          id: item.contentDetails.videoId,
          title: item.snippet?.title || 'YouTube Video'
        }));

      allVideos.push(...videos);
      nextPageToken = response.data.nextPageToken || null;

      // Limit to prevent infinite loops (safety measure)
      if (allVideos.length > 500) {
        console.warn('Playlist has more than 500 videos, limiting results');
        break;
      }
    } while (nextPageToken);

    if (allVideos.length === 0) {
      console.warn('YouTube API returned no videos for playlist:', playlistId);
      return [];
    }

    return allVideos;
  } catch (error) {
    console.error('YouTube Playlist API error:', {
      message: error.message,
      code: error.code,
      errors: error.errors
    });
    
    // Re-throw with more context
    if (error.code === 403) {
      throw new Error('YouTube API quota exceeded or access denied');
    } else if (error.code === 404) {
      throw new Error('YouTube playlist not found');
    } else if (error.code === 400) {
      throw new Error('Invalid YouTube API request');
    } else {
      throw new Error(`YouTube API error: ${error.message || 'Unknown error'}`);
    }
  }
};

module.exports = {
  searchYouTubeVideos,
  getPlaylistVideos
};

