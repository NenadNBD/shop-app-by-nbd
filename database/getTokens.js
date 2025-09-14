const axios = require('axios');
const pool = require('./db');

// Environment Variables
const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;

// Function to get HubSpot token from the database
const setHubSpotToken = async (getPortalId) => {

    try {
        const query = `
        SELECT portal_id, access_token, refresh_token, expires_at
        FROM sa_application
        WHERE portal_id = $1
        LIMIT 1;
    `;
        const result = await pool.query(query, [getPortalId]);
        if (result.rows.length === 0) {
            throw new Error('No HubSpot token found in the database.');
        }

        const tokenInfo = result.rows[0];
        const now = new Date();

        // If the token is expired, refresh it
        if (new Date(tokenInfo.expires_at) <= now) {
            console.log('HubSpot token expired. Refreshing...');
            return await refreshHubSpotToken(tokenInfo.refresh_token, tokenInfo.portal_id);
        }

        return tokenInfo; // Return valid token
    } catch (err) {
        console.error('Error fetching HubSpot token:', err.message);
        throw new Error('Database fetch operation failed.');
    }
};

// Function to refresh the HubSpot access token
const refreshHubSpotToken = async (refresh_token, portal_id) => {
    try {
        const formData = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: HUBSPOT_CLIENT_ID,
            client_secret: HUBSPOT_CLIENT_SECRET,
            refresh_token,
        });

        const response = await axios.post('https://api.hubapi.com/oauth/v1/token', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const { access_token, expires_in, refresh_token: new_refresh_token } = response.data;
        const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

        // Update the refreshed token in the database
        await pool.query(
            `UPDATE sa_application
             SET access_token = $1, refresh_token = $2, expires_at = $3
             WHERE portal_id = $4`,
            [access_token, new_refresh_token, expiresAt, portal_id]
        );

        console.log(`HubSpot token refreshed successfully.`);
        return { access_token, refresh_token: new_refresh_token, expires_at: expiresAt };
    } catch (error) {
        console.error("Error refreshing HubSpot access token:", error.response?.data || error.message);
        throw new Error('Unable to refresh HubSpot access token');
    }
};

module.exports = setHubSpotToken;