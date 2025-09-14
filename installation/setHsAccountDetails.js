const pool = require('../database/db');
const https = require("https");

const setHsAccountDetails = async (hub_id, access_token) => {
  const portalId = String(hub_id || '');
  if (!portalId || !access_token) {
    console.error("Portal ID and/or Access Token not found or invalid.");
    return;
  }

  try {
    const accountDetails = await new Promise((resolve, reject) => {
      const options = {
        method: "GET",
        hostname: "api.hubapi.com",
        path: "/account-info/v3/details",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${access_token}`,
        },
      };

      const req = https.request(options, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          try {
            const parsed = JSON.parse(body);
            resolve(parsed);
          } catch (err) {
            console.error("Failed to parse JSON:", body);
            reject(err);
          }
        });
      });

      req.on("error", reject);
      req.end();
    });

    const getUiDomain = String(accountDetails.uiDomain || '');

    const updateQuery = `
      UPDATE sa_application
      SET 
        ui_domain = $2
      WHERE portal_id = $1
    `;

    const updateResult = await pool.query(updateQuery, [portalId, getUiDomain]);

    if (updateResult.rowCount > 0) {
      console.log(`Time Zone and UI Domain successfully updated for account ID: ${portalId}`);
    } else {
      console.warn(`No rows found to update for account ID: ${portalId}`);
    }
  } catch (err) {
    console.error("Error setting HubSpot account details:", err.message);
  }
};

module.exports = setHsAccountDetails;