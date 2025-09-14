const axios = require('axios');
const dbTokens = require('../database/saveUpdateTokens');
const pool = require('../database/db');
const setHsAccountDetails = require('./setHsAccountDetails');

async function appInstalation(req, res) {
    const code = req.query.code; // Extract the authorization code from the query
  
    if (!code) {
        console.error('Authorization code missing here!');
        return res.status(400).send('Authorization code is required.');
    }
  
    try {
        // Prepare data for token exchange
        const formData = {
            grant_type: 'authorization_code',
            client_id: process.env.HUBSPOT_CLIENT_ID,
            client_secret: process.env.HUBSPOT_CLIENT_SECRET,
            redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
            code: code,
        };
  
        // Exchange authorization code for tokens
        const tokenResponse = await axios.post('https://api.hubapi.com/oauth/v1/token', new URLSearchParams(formData), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
  
        console.log('Access Token:', access_token);
        console.log('Refresh Token:', refresh_token);
        console.log('Expires In:', expires_in);
  
        // Fetch accountId, userId, userEmail, and appId using the access token
        const tokenInfoUrl = `https://api.hubapi.com/oauth/v1/access-tokens/${access_token}`;
        const tokenInfoResponse = await axios.get(tokenInfoUrl, {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });
  
        const { hub_id, app_id, user, user_id } = tokenInfoResponse.data;
  
        console.log('Token Info:');
        console.log(`Account ID (Hub ID): ${hub_id}`);
        console.log(`App ID: ${app_id}`);
        console.log(`User Email: ${user}`);
        console.log(`User ID: ${user_id}`);
  
        // Save tokens to the database with accountId
        await dbTokens.saveTokens(hub_id, app_id, access_token, refresh_token, expires_in);
        console.log('Tokens saved to the database.');
        // Insert Time Zone and UI Domain in app table
        await setHsAccountDetails(hub_id, access_token);
        // Query the ui_domain from DB
        const uiDomainResult = await pool.query(`SELECT ui_domain FROM sa_application WHERE portal_id = $1 LIMIT 1`, [hub_id]);
        const uiDomain = uiDomainResult.rows?.[0]?.ui_domain || 'app.hubspot.com';


        // Redirect to HubSpot integrations settings page with the hub_id
        console.log('Should redirect to:');
        console.log(`https://${uiDomain}/integrations-settings/${hub_id}/installed`);
        res.redirect(`https://${uiDomain}/integrations-settings/${hub_id}/installed`);

    } catch (error) {
        console.error('Error exchanging authorization code:', error.response ? error.response.data : error.message);
        res.status(500).send('Error exchanging authorization code.');
    }
}

module.exports = appInstalation;